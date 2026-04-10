// src/lib/alia/agents/ordem-dia.agent.ts
// ALIA Agent: Ordem do Dia — verifica sessões plenárias ativas e matérias pautadas.

import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

// ── Types ────────────────────────────────────────────────────────────────────

interface SessaoItem {
  data_inicio?: string;
  numero?: string | number;
  tipo?: string;
  [key: string]: unknown;
}

// ── Agent export ─────────────────────────────────────────────────────────────

export const ordemDiaAgent: AliaAgent = {
  name: 'ordem_dia',
  description: 'Verifica se há sessão plenária publicada, retorna ordens ativas e próximas sessões com quantidade de matérias pautadas.',

  async execute({ action: _action, data }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const dataFiltro = data.data as string | undefined;

      const [resOrdens, resSessoes] = await Promise.all([
        fetch(`${INTERNAL_BASE}/api/pareceres/ordens-ativas`),
        fetch(`${INTERNAL_BASE}/api/pareceres/sessoes`),
      ]);

      const ordensJson = resOrdens.ok
        ? ((await resOrdens.json() as { results?: SessaoItem[] }).results ?? [])
        : [];
      const sessoesJson = resSessoes.ok
        ? ((await resSessoes.json() as { results?: SessaoItem[] }).results ?? [])
        : [];

      const filtrar = (list: SessaoItem[]) =>
        dataFiltro
          ? list.filter(s => s.data_inicio === dataFiltro)
          : list.slice(0, 5);

      const ordens  = filtrar(ordensJson);
      const sessoes = filtrar(sessoesJson);

      if (ordens.length === 0 && sessoes.length === 0) {
        return {
          success: true,
          content: dataFiltro
            ? `Nenhuma sessão ou ordem do dia encontrada para ${dataFiltro}.`
            : 'Não há sessões plenárias ativas no momento. Verifique mais tarde ou acesse a aba "Pareceres" → "Ordem do Dia".',
          structured: { ordens_ativas: [], proximas_sessoes: [] },
        };
      }

      const linhasOrdens = ordens.map(o => {
        const dt = o.data_inicio
          ? new Date(o.data_inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
          : 'N/I';
        return `• Sessão ${o.numero ?? ''} — ${dt}${o.tipo ? ` (${o.tipo})` : ''}`;
      });

      const linhasSessoes = sessoes.map(s => {
        const dt = s.data_inicio
          ? new Date(s.data_inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
          : 'N/I';
        return `• ${dt}${s.tipo ? ` — ${s.tipo}` : ''}`;
      });

      const partes: string[] = [];
      if (linhasOrdens.length) {
        partes.push(`**Ordens do Dia Ativas (${linhasOrdens.length}):**\n${linhasOrdens.join('\n')}`);
      }
      if (linhasSessoes.length) {
        partes.push(`**Próximas Sessões (${linhasSessoes.length}):**\n${linhasSessoes.join('\n')}`);
      }
      partes.push(`\n_Para gerar o parecer completo, acesse a aba "Pareceres" → "Ordem do Dia" e selecione a sessão._`);

      return {
        success: true,
        content: partes.join('\n\n'),
        structured: {
          ordens_ativas: ordens,
          proximas_sessoes: sessoes,
          dica: 'Para gerar o parecer completo, acesse a aba "Pareceres" → "Ordem do Dia" e selecione a sessão.',
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro ao verificar ordem do dia: ${msg}` };
    }
  },
};
