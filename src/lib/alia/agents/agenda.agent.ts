// src/lib/alia/agents/agenda.agent.ts
// ALIA Agent: Agenda — cria eventos e compromissos para a Vereadora Carol Dantas.

import { createClient } from '@supabase/supabase-js';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const GABINETE_ID = process.env.GABINETE_ID!;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Agent export ─────────────────────────────────────────────────────────────

export const agendaAgent: AliaAgent = {
  name: 'agenda',
  description: 'Marca eventos, reuniões e compromissos na agenda da Vereadora Carol Dantas.',

  async execute({ action: _action, data, context }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const {
        titulo,
        data_inicio,
        data_fim,
        local,
        descricao,
        tipo = 'reuniao',
      } = data as {
        titulo: string;
        data_inicio: string;
        data_fim?: string;
        local?: string;
        descricao?: string;
        tipo?: string;
      };

      if (!titulo || !data_inicio) {
        return {
          success: false,
          content: 'Para marcar na agenda, informe pelo menos o título e a data/hora de início (formato ISO: 2026-03-20T14:00:00).',
        };
      }

      const supabase = getSupabase();
      const senderName = (data.sender_name as string) || context.sessionId || 'Equipe';

      const { data: evento, error } = await supabase
        .from('eventos')
        .insert({
          gabinete_id: GABINETE_ID,
          titulo,
          descricao: descricao || `Marcado via ${context.channel} por ${senderName}`,
          tipo,
          data_inicio,
          data_fim: data_fim || null,
          local: local || null,
        })
        .select('id, data_inicio')
        .single();

      if (error || !evento) {
        return { success: false, content: `Falha ao criar evento na agenda: ${error?.message ?? 'erro desconhecido'}` };
      }

      const dataFmt = new Date(evento.data_inicio as string).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });

      return {
        success: true,
        content: `✅ Evento criado na agenda!\n**${titulo}**\nData: ${dataFmt}${local ? `\nLocal: ${local}` : ''}`,
        structured: {
          id: evento.id,
          titulo,
          data_formatada: dataFmt,
          local: local || null,
          tipo,
        },
        actions_taken: [`evento_criado:${evento.id}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro ao marcar agenda: ${msg}` };
    }
  },
};
