// src/lib/alia/telemetry.ts
// Wrapper não-invasivo que instrumenta qualquer AliaAgent com telemetria
// persistida em alia_agent_runs. Não altera comportamento do agent.

import type { AliaAgent, AgentContext, AgentResult } from './agents/agent.interface';
import { createAdminClient } from '@/lib/supabase/admin';
import { estimateCostUsd } from './pricing';

export interface TelemetryContext {
  gabinete_id: string;
  session_id?: string | null;
  triggered_by: 'chat' | 'whatsapp' | 'cron' | 'test-isolated';
  intent_tag?: string | null;
}

/**
 * Envolve um AliaAgent com telemetria persistida em alia_agent_runs.
 * Não modifica o comportamento do agent; apenas instrumenta.
 *
 * Erros de telemetria NUNCA propagam — falha silenciosa pra não quebrar
 * o fluxo de resposta ao usuário. console.warn em caso de falha de DB.
 */
export function withTelemetry(
  agent: AliaAgent,
  context: TelemetryContext,
): AliaAgent {
  return {
    name: agent.name,
    description: agent.description,

    async execute(params: {
      action: string;
      data: Record<string, unknown>;
      context: AgentContext;
      model: string;
    }): Promise<AgentResult> {
      const startedAt = new Date();
      const inputPreview = previewOf(params.data);
      const model = params.model ?? 'unknown';

      const runId = await insertRunStart({
        gabinete_id: context.gabinete_id,
        agent_name: agent.name,
        session_id: context.session_id ?? null,
        triggered_by: context.triggered_by,
        started_at: startedAt.toISOString(),
        status: 'running',
        input_preview: inputPreview,
        model,
        intent_tag: context.intent_tag ?? null,
      });

      try {
        const result = await agent.execute(params);
        const endedAt = new Date();

        const { tokensInput, tokensOutput } = extractTokens(result);
        const costUsd = estimateCostUsd(model, tokensInput, tokensOutput);

        await updateRunEnd(runId, {
          ended_at: endedAt.toISOString(),
          status: result.success ? 'ok' : 'error',
          error_message: result.success
            ? null
            : result.content.slice(0, 500),
          output_preview: previewOf(result.content),
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          cost_usd: costUsd,
        }).catch(() => { /* telemetria não pode derrubar resposta ao usuário */ });

        return result;
      } catch (err) {
        const endedAt = new Date();
        const errMsg = err instanceof Error ? err.message : String(err);

        await updateRunEnd(runId, {
          ended_at: endedAt.toISOString(),
          status: 'error',
          error_message: errMsg.slice(0, 500),
          output_preview: null,
          tokens_input: null,
          tokens_output: null,
          cost_usd: null,
        }).catch(() => { /* swallow telemetry errors */ });

        throw err;
      }
    },
  };
}

// =========================================================================
// Helpers privados
// =========================================================================

function previewOf(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return (s ?? '').slice(0, 500);
}

interface RunStartFields {
  gabinete_id: string;
  agent_name: string;
  session_id: string | null;
  triggered_by: string;
  started_at: string;
  status: 'running';
  input_preview: string;
  model: string;
  intent_tag: string | null;
}

async function insertRunStart(fields: RunStartFields): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('alia_agent_runs')
      .insert(fields)
      .select('id')
      .single();
    if (error) {
      console.warn('[telemetry] insertRunStart failed:', error.message);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn('[telemetry] insertRunStart exception:', err);
    return null;
  }
}

interface RunEndFields {
  ended_at: string;
  status: 'ok' | 'error';
  error_message: string | null;
  output_preview: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
}

async function updateRunEnd(runId: string | null, fields: RunEndFields): Promise<void> {
  if (!runId) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('alia_agent_runs')
      .update(fields)
      .eq('id', runId);
    if (error) console.warn('[telemetry] updateRunEnd failed:', error.message);
  } catch (err) {
    console.warn('[telemetry] updateRunEnd exception:', err);
  }
}

/**
 * Extrai tokens do AgentResult.
 * Convenção: agents que rodam Gemini/Claude devem popular `result.structured.usage`
 * com `{ input: number, output: number }`. Se ausente, retorna null.
 *
 * Migração futura: instrumentar cada agent pra popular esse campo (não bloqueia F1a).
 */
function extractTokens(result: AgentResult): {
  tokensInput: number | null;
  tokensOutput: number | null;
} {
  const usage = (
    result.structured as { usage?: { input?: number; output?: number } } | undefined
  )?.usage;
  return {
    tokensInput: usage?.input ?? null,
    tokensOutput: usage?.output ?? null,
  };
}
