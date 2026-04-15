// src/lib/alia/agents/ordem-dia.agent.ts
// ALIA Agent: Ordem do Dia — verifica sessões plenárias ativas e matérias pautadas.
// Também enfileira geração autônoma de pareceres quando solicitado.

import { createClient } from '@supabase/supabase-js';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

// ── Supabase ──────────────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface SessaoItem {
  id?: string | number;
  data_inicio?: string;
  numero?: string | number;
  tipo?: string;
  [key: string]: unknown;
}

interface MateriaItem {
  id?: string | number;
  tipo?: string;
  numero?: string | number;
  ano?: number;
  ementa?: string;
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Verifica se a ação/texto solicita geração de pareceres.
 */
function isGerarParecer(action: string, text: string): boolean {
  if (action === 'gerar_parecer_ordem_dia') return true;
  return /gera[r]?\s*(os\s*)?parecer/i.test(text ?? '');
}

// ── Agent export ─────────────────────────────────────────────────────────────

export const ordemDiaAgent: AliaAgent = {
  name: 'ordem_dia',
  description:
    'Verifica se há sessão plenária publicada, retorna ordens ativas e próximas sessões com quantidade de matérias pautadas. Também enfileira geração autônoma de pareceres.',

  async execute({
    action,
    data,
    context,
  }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    const text = (data.text as string | undefined) ?? '';

    // ── Caminho: geração de pareceres ─────────────────────────────────────────
    if (isGerarParecer(action, text)) {
      return await enfileirarGeracaoParecer(data, context);
    }

    // ── Caminho padrão: consulta de ordem do dia ──────────────────────────────
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
          ? list.filter((s) => s.data_inicio === dataFiltro)
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

      const linhasOrdens = ordens.map((o) => {
        const dt = o.data_inicio
          ? new Date(o.data_inicio).toLocaleString('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : 'N/I';
        return `• Sessão ${o.numero ?? ''} — ${dt}${o.tipo ? ` (${o.tipo})` : ''}`;
      });

      const linhasSessoes = sessoes.map((s) => {
        const dt = s.data_inicio
          ? new Date(s.data_inicio).toLocaleString('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : 'N/I';
        return `• ${dt}${s.tipo ? ` — ${s.tipo}` : ''}`;
      });

      const partes: string[] = [];
      if (linhasOrdens.length) {
        partes.push(
          `**Ordens do Dia Ativas (${linhasOrdens.length}):**\n${linhasOrdens.join('\n')}`,
        );
      }
      if (linhasSessoes.length) {
        partes.push(
          `**Próximas Sessões (${linhasSessoes.length}):**\n${linhasSessoes.join('\n')}`,
        );
      }
      partes.push(
        `\n_Para gerar o parecer completo, acesse a aba "Pareceres" → "Ordem do Dia" e selecione a sessão._`,
      );

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

// ── Enfileirar geração de pareceres ──────────────────────────────────────────

async function enfileirarGeracaoParecer(
  data: Record<string, unknown>,
  context: AgentContext,
): Promise<AgentResult> {
  try {
    // 1. Buscar sessão mais recente com pauta
    const resSessoes = await fetch(`${INTERNAL_BASE}/api/pareceres/sessoes`);
    if (!resSessoes.ok) {
      return {
        success: false,
        content: 'Não foi possível consultar as sessões plenárias. Tente novamente mais tarde.',
      };
    }

    const sessoesJson = await resSessoes.json() as { results?: SessaoItem[] };
    const sessoes: SessaoItem[] = sessoesJson.results ?? [];

    const sessao = sessoes[0];
    if (!sessao) {
      return {
        success: true,
        content:
          'Não encontrei nenhuma sessão com pauta disponível no momento. Verifique em breve na aba "Pareceres".',
      };
    }

    const sessaoId = sessao.id ? String(sessao.id) : '';

    // 2. Buscar matérias da sessão
    let materias: MateriaItem[] = [];
    if (sessaoId) {
      const resOrdem = await fetch(
        `${INTERNAL_BASE}/api/pareceres/ordem-dia?sessao_id=${encodeURIComponent(sessaoId)}`,
      );
      if (resOrdem.ok) {
        const ordemJson = await resOrdem.json() as { results?: MateriaItem[] } | MateriaItem[];
        materias = Array.isArray(ordemJson)
          ? ordemJson
          : (ordemJson.results ?? []);
      }
    }

    const materiaIds = materias
      .map((m) => (m.id ? String(m.id) : null))
      .filter((id): id is string => !!id);

    // 3. Ler modelo do config do gabinete
    const { data: configRow } = await db()
      .from('gabinete_alia_config')
      .select('parecer_model')
      .eq('gabinete_id', context.gabineteId)
      .maybeSingle();

    const modelo = (configRow?.parecer_model as string | undefined) ?? 'gemini-2.0-flash';

    // 4. Obter informações do solicitante
    const sender = data.sender as { phone?: string; name?: string } | undefined;
    const solicitantePhone = sender?.phone ?? '';
    const solicitanteNome  = sender?.name  ?? 'Assessora';

    // 5. Inserir tarefa na fila
    const { error: insertError } = await db()
      .from('alia_task_queue')
      .insert({
        gabinete_id: context.gabineteId,
        tipo: 'gerar_parecer_ordem_dia',
        status: 'pendente',
        payload: {
          sessao_id: sessaoId,
          materia_ids: materiaIds,
          modelo,
          solicitante_phone: solicitantePhone,
          solicitante_nome: solicitanteNome,
        },
      });

    if (insertError) {
      console.error('[ordem-dia.agent] erro ao inserir tarefa:', insertError);
      return {
        success: false,
        content: 'Não foi possível agendar a geração dos pareceres. Tente novamente.',
      };
    }

    // 6. Montar data da sessão formatada
    const dataSessao = sessao.data_inicio
      ? new Date(sessao.data_inicio).toLocaleDateString('pt-BR')
      : 'próxima sessão';

    const total = materiaIds.length;

    return {
      success: true,
      content:
        `✅ Entendido! Sessão de ${dataSessao} com *${total} matéria${total !== 1 ? 's' : ''}*. ` +
        `Gerando pareceres agora... você receberá uma notificação quando estiverem prontos. 📄`,
      structured: {
        task_enqueued: true,
        sessao_id: sessaoId,
        materia_count: total,
        modelo,
      },
      actions_taken: ['tarefa_enfileirada'],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ordem-dia.agent] enfileirarGeracaoParecer error:', msg);
    return {
      success: false,
      content: `Erro ao agendar geração de pareceres: ${msg}`,
    };
  }
}
