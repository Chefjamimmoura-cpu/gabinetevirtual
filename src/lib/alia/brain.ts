// src/lib/alia/brain.ts
// Central Orchestrator — routes all channels through a single pipeline.
// Flow: classify → recall memory → search RAG → select model → execute agent → synthesize.

import type { AliaRequest, AliaResponse } from './gateway';
import type { GabineteConfig } from './types';
import type { AliaAgent } from './agents/agent.interface';

import { classifyIntent, isMultiIntent } from './classifier';
import { selectModel } from './model-selector';
import { recall, remember } from './memory';
import { routeDominios } from './router';
import { searchHybrid, formatRagContext } from './rag';
import { buildSystemPrompt } from './persona';

import { cadinAgent }     from './agents/cadin.agent';
import { indicacaoAgent } from './agents/indicacao.agent';
import { oficioAgent }    from './agents/oficio.agent';
import { agendaAgent }    from './agents/agenda.agent';
import { parecerAgent }   from './agents/parecer.agent';
import { ordemDiaAgent }  from './agents/ordem-dia.agent';
import { generalAgent }   from './agents/general.agent';
import { cadernoPdfAgent } from './agents/caderno-pdf.agent';

// ── Gabinete config (hardcoded for now — will come from DB in multi-tenant) ───

const GABINETE_CONFIG: GabineteConfig = {
  parlamentar_nome: 'Carol Dantas',
  casa_legislativa: 'Câmara Municipal de Boa Vista',
  sigla_casa: 'CMBV',
  partido: 'MDB',
  comissoes_membro: ['CLJRF', 'COF', 'CASP'],
};

// Hardcoded gabinete ID that matches the config above
const GABINETE_ID = 'carol-dantas-cmbv';

// ── Agent registry ────────────────────────────────────────────────────────────

const AGENT_REGISTRY: Record<string, AliaAgent> = {
  cadin:      cadinAgent,
  indicacao:  indicacaoAgent,
  oficio:     oficioAgent,
  agenda:     agendaAgent,
  parecer:    parecerAgent,
  relator:    parecerAgent,   // relator uses the parecer agent
  ordem_dia:  ordemDiaAgent,
  general:    generalAgent,
  caderno_pdf: cadernoPdfAgent,
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Central brain that orchestrates all ALIA requests.
 * Single entry point regardless of channel (WhatsApp, dashboard, email, cron, api).
 */
export async function process(request: AliaRequest): Promise<AliaResponse> {
  const text = request.content.text ?? '';

  // ── Step 1: Classify intent ───────────────────────────────────────────────

  const intents = classifyIntent(text, request.page_context);
  const primaryIntent = intents[0] ?? { agent: 'general', action: 'assist', confidence: 0.5, priority: 0 };
  const multiIntent = isMultiIntent(intents);

  // ── Step 2: Resolve agent ─────────────────────────────────────────────────

  const agent: AliaAgent = AGENT_REGISTRY[primaryIntent.agent] ?? generalAgent;

  // ── Step 3: Recall memories ───────────────────────────────────────────────

  const memories = await recall(GABINETE_ID, text, { matchCount: 5 });

  // ── Step 4: Search RAG ────────────────────────────────────────────────────

  const dominios = routeDominios(text);
  const ragResult = await searchHybrid(text, {
    gabineteId: GABINETE_ID,
    dominios: dominios ?? undefined,
  });
  const ragContext = formatRagContext(ragResult);

  // ── Step 5: Select model ──────────────────────────────────────────────────

  const legalAgents = new Set(['parecer', 'relator', 'pls']);
  const model = selectModel(primaryIntent.agent as Parameters<typeof selectModel>[0], request.channel, {
    multiIntent,
    legalAnalysis: legalAgents.has(primaryIntent.agent),
    longContext: text.length > 800,
    crossModule: primaryIntent.agent === 'crossmodule',
  });

  // ── Step 6: Build system prompt (for agents that may use it) ──────────────

  const systemPrompt = buildSystemPrompt({
    agent: primaryIntent.agent as Parameters<typeof buildSystemPrompt>[0]['agent'],
    channel: request.channel,
    memories,
    gabineteConfig: GABINETE_CONFIG,
    currentDate: request.timestamp,
  });

  // ── Step 7: Execute agent ─────────────────────────────────────────────────

  const result = await agent.execute({
    action: primaryIntent.action,
    data: {
      text,
      media: request.content.media ?? [],
      sender: request.sender,
      page_context: request.page_context ?? null,
      intents,
      gabinete_config: GABINETE_CONFIG,
      system_prompt: systemPrompt,
    },
    context: {
      memories,
      ragContext: ragContext || undefined,
      gabineteId: GABINETE_ID,
      sessionId: request.session_id,
      channel: request.channel,
    },
    model,
  });

  // ── Step 8: Fire-and-forget memory persistence ────────────────────────────

  if (result.suggested_memories && result.suggested_memories.length > 0) {
    for (const mem of result.suggested_memories) {
      remember(GABINETE_ID, mem.tipo, mem.subject, mem.content, {
        sourceModule: agent.name,
      }).catch((err) => {
        console.warn('[Brain] remember failed:', err);
      });
    }
  }

  // ── Step 9: Build and return AliaResponse ─────────────────────────────────

  const responseText = result.success
    ? result.content
    : `Não foi possível processar sua solicitação. ${result.content}`;

  // Channel-specific formatting
  const channelFormat: AliaResponse['channel_format'] = {};

  if (request.channel === 'whatsapp') {
    // Strip heavy markdown for WhatsApp
    channelFormat.whatsapp = responseText
      .replace(/#{1,6}\s+/g, '*')
      .replace(/\*\*(.*?)\*\*/g, '*$1*')
      .replace(/\n{3,}/g, '\n\n');
  } else if (request.channel === 'dashboard') {
    channelFormat.dashboard = responseText;
  } else if (request.channel === 'email') {
    channelFormat.email = responseText;
  }

  const memoriesCreated = (result.suggested_memories ?? []).map(
    (m) => `${m.tipo}:${m.subject}`,
  );

  return {
    text: responseText,
    channel_format: channelFormat,
    actions: (result.actions_taken ?? []).map((label) => ({
      tool: label,
      params: {},
      result: 'executed',
    })),
    memories_created: memoriesCreated,
    agent_used: agent.name,
    model_used: model,
  };
}
