// src/lib/alia/agents/parecer.agent.ts
// ALIA Agent: Parecer — gera parecer de relator para matérias legislativas.

import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const GABINETE_ID = process.env.GABINETE_ID!;
const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

const RELATOR_NOME = 'Vereadora Carol Dantas';

// ── Agent export ─────────────────────────────────────────────────────────────

export const parecerAgent: AliaAgent = {
  name: 'parecer',
  description: 'Gera parecer de relator para comissões sobre matérias legislativas do SAPL.',

  async execute({ action: _action, data }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const {
        materia_id,
        commission_sigla,
        voto = 'FAVORÁVEL',
      } = data as {
        materia_id: number;
        commission_sigla: string;
        voto?: string;
      };

      if (!materia_id || !commission_sigla) {
        return {
          success: false,
          content: 'Para gerar o parecer, informe o ID da matéria (materia_id) e a sigla da comissão (commission_sigla).',
        };
      }

      const res = await fetch(`${INTERNAL_BASE}/api/pareceres/gerar-relator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materia_id,
          commission_sigla,
          relator_nome: RELATOR_NOME,
          voto,
          gabinete_id: GABINETE_ID,
        }),
      });

      const resData = await res.json() as {
        ok?: boolean;
        commission?: string;
        parecer_relator?: string;
        error?: string;
        details?: string;
      };

      if (!res.ok || resData.error) {
        return {
          success: false,
          content: `Falha ao gerar parecer: ${resData.error ?? resData.details ?? 'erro desconhecido'}`,
        };
      }

      return {
        success: true,
        content: `✅ Parecer gerado com sucesso para a comissão **${resData.commission ?? commission_sigla}**.\nO documento está disponível no sistema de pareceres.`,
        structured: {
          commission: resData.commission,
          voto,
          parecer_relator: resData.parecer_relator,
        },
        actions_taken: [`parecer_gerado:${commission_sigla}:materia_${materia_id}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro ao gerar parecer: ${msg}` };
    }
  },
};
