// src/lib/alia/agents/comissao.agent.ts
// ALIA Agent: Comissão — composição, pendências, prazos e relatórios das comissões da CMBV.

import { createClient } from '@supabase/supabase-js';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const GABINETE_ID = process.env.GABINETE_ID!;
const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

// ── 10 comissões permanentes da CMBV ─────────────────────────────────────────

const SIGLAS_CMBV = [
  'CLJRF',
  'COF',
  'COUTH',
  'CECEJ',
  'CSASM',
  'CDCDHAISU',
  'CEDP',
  'CASP',
  'CPMAIPD',
  'CAG',
] as const;

type SiglaCMBV = (typeof SIGLAS_CMBV)[number];

// ── Supabase helper ───────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Type definitions ──────────────────────────────────────────────────────────

interface ComissaoItem {
  id?: number;
  nome?: string;
  sigla?: string;
  ativa?: boolean;
  membros?: Array<{ nome: string; cargo: string }>;
  [key: string]: unknown;
}

interface PlItem {
  id?: number;
  numero?: number;
  ano?: number;
  tipo_sigla?: string;
  ementa?: string;
  comissao_atual?: string | null;
  pareceres_existentes?: number;
  ultima_tramitacao?: {
    data?: string;
    status?: string;
    texto?: string;
  };
  [key: string]: unknown;
}

interface MembroItem {
  nome: string;
  cargo: string;
}

// ── Regex / keyword extractor ─────────────────────────────────────────────────

/**
 * Tries to extract a known CMBV commission sigla from free text.
 * Longer siglas are tested first to avoid partial matches (e.g. "COF" inside "CDCDHAISU").
 */
function extrairSigla(text: string): SiglaCMBV | null {
  if (!text) return null;
  const upper = text.toUpperCase();

  // Sort by length descending so longer siglas match before shorter ones
  const sorted = [...SIGLAS_CMBV].sort((a, b) => b.length - a.length);
  for (const sigla of sorted) {
    if (upper.includes(sigla)) return sigla;
  }
  return null;
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { data: null, error: body.error ?? `HTTP ${res.status}` };
    }
    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Action: consultarComissao ─────────────────────────────────────────────────

async function consultarComissao(data: Record<string, unknown>): Promise<AgentResult> {
  const texto = (data.text as string) ?? '';
  const sigla = extrairSigla(texto);

  // Fetch all commissions from internal API
  const { data: listaData, error: listaErr } = await apiFetch<{ results: ComissaoItem[]; total?: number }>(
    `${INTERNAL_BASE}/api/comissoes/sapl/comissoes`,
  );

  if (listaErr || !listaData) {
    return {
      success: false,
      content: `Não foi possível buscar as comissões no momento. Tente novamente mais tarde.\n_Detalhe: ${listaErr ?? 'sem dados'}_`,
    };
  }

  const todasComissoes = listaData.results ?? [];

  // Filter by sigla when provided
  const comissoes = sigla
    ? todasComissoes.filter(c => c.sigla?.toUpperCase() === sigla)
    : todasComissoes;

  if (comissoes.length === 0) {
    const mensagem = sigla
      ? `Comissão *${sigla}* não encontrada no SAPL. Verifique a sigla e tente novamente.`
      : 'Nenhuma comissão permanente encontrada no SAPL.';
    return { success: false, content: mensagem };
  }

  // When a specific commission is found, also fetch members from pareceres API
  if (sigla && comissoes.length === 1) {
    const comissao = comissoes[0];

    // Fetch members via pareceres API (uses comissao_id from SAPL)
    const membrosUrl = comissao.id
      ? `${INTERNAL_BASE}/api/pareceres/comissao/membros?comissao_id=${comissao.id}`
      : null;

    let membros: MembroItem[] = comissao.membros ?? [];

    if (membrosUrl) {
      const { data: membrosData } = await apiFetch<{ membros: MembroItem[] }>(membrosUrl);
      if (membrosData?.membros?.length) {
        membros = membrosData.membros;
      }
    }

    const presidente = membros.find(m => m.cargo === 'presidente');
    const vicePres = membros.find(m => m.cargo === 'vice-presidente');
    const outrosMembros = membros.filter(m => m.cargo !== 'presidente' && m.cargo !== 'vice-presidente');

    const linhasMembros: string[] = [];
    if (presidente) linhasMembros.push(`👤 *Presidente:* ${presidente.nome}`);
    if (vicePres)   linhasMembros.push(`👤 *Vice-presidente:* ${vicePres.nome}`);
    if (outrosMembros.length) {
      linhasMembros.push(`👥 *Membros:* ${outrosMembros.map(m => m.nome).join(', ')}`);
    }
    if (membros.length === 0) {
      linhasMembros.push('_Composição ainda não disponível._');
    }

    // Quick pending count via PLs API
    const { data: plsData } = await apiFetch<{ total?: number; pls?: PlItem[] }>(
      `${INTERNAL_BASE}/api/comissoes/sapl/pls?comissao=${sigla}`,
    );
    const pendentes = plsData?.pls?.filter(p => (p.pareceres_existentes ?? 0) === 0).length ?? 0;

    const content = [
      `📋 *Comissão ${comissao.nome ?? sigla} (${sigla})*`,
      ...linhasMembros,
      `📊 *Status:* ${pendentes} matéria${pendentes !== 1 ? 's' : ''} pendente${pendentes !== 1 ? 's' : ''}`,
    ].join('\n');

    return {
      success: true,
      content,
      structured: {
        sigla,
        nome: comissao.nome,
        membros,
        pendentes,
      },
      actions_taken: [`consulta_comissao:${sigla}`],
    };
  }

  // Multiple commissions — list all with brief info
  const linhas = todasComissoes.map(c => {
    const pendentes = 0; // no per-commission pending count in bulk mode
    return `• *${c.sigla ?? '?'}* — ${c.nome ?? 'sem nome'}${pendentes > 0 ? ` (${pendentes} pendentes)` : ''}`;
  });

  return {
    success: true,
    content: `📋 *Comissões Permanentes da CMBV (${todasComissoes.length}):*\n${linhas.join('\n')}\n\n_Para detalhes, mencione a sigla desejada (ex: "COF", "CLJRF")._`,
    structured: { comissoes: todasComissoes.map(c => ({ sigla: c.sigla, nome: c.nome })) },
  };
}

// ── Action: listarPendencias ──────────────────────────────────────────────────

async function listarPendencias(data: Record<string, unknown>): Promise<AgentResult> {
  const texto = (data.text as string) ?? '';
  const sigla = extrairSigla(texto);

  const url = sigla
    ? `${INTERNAL_BASE}/api/comissoes/sapl/pls?comissao=${sigla}`
    : `${INTERNAL_BASE}/api/comissoes/sapl/pls`;

  const { data: plsData, error: plsErr } = await apiFetch<{ total?: number; pls?: PlItem[] }>(url);

  if (plsErr || !plsData) {
    return {
      success: false,
      content: `Não foi possível buscar as pendências${sigla ? ` da comissão ${sigla}` : ''}.\n_Detalhe: ${plsErr ?? 'sem dados'}_`,
    };
  }

  const pls = plsData.pls ?? [];

  if (pls.length === 0) {
    return {
      success: true,
      content: sigla
        ? `✅ Nenhuma matéria pendente encontrada para a comissão *${sigla}*.`
        : '✅ Nenhuma matéria pendente encontrada nas comissões.',
      structured: { pendencias: [], total: 0 },
    };
  }

  const hoje = new Date();

  const linhas = pls.map(pl => {
    const ref = `${pl.tipo_sigla ?? 'PL'} ${pl.numero ?? '?'}/${pl.ano ?? '?'}`;
    const semParecer = (pl.pareceres_existentes ?? 0) === 0;

    // Try to infer a rough deadline from last tramitação date + 15 days
    let prazoInfo = '';
    if (pl.ultima_tramitacao?.data) {
      const dataEntrada = new Date(pl.ultima_tramitacao.data);
      const prazo = new Date(dataEntrada);
      prazo.setDate(prazo.getDate() + 15);
      const diasAtraso = Math.floor((hoje.getTime() - prazo.getTime()) / 86_400_000);

      if (diasAtraso > 0) {
        prazoInfo = ` — parecer atrasado ${diasAtraso} dia${diasAtraso !== 1 ? 's' : ''} ⚠️`;
      } else if (diasAtraso > -4) {
        const prazoFmt = prazo.toLocaleDateString('pt-BR');
        prazoInfo = ` (prazo: ${prazoFmt}) ⚠️`;
      } else {
        const prazoFmt = prazo.toLocaleDateString('pt-BR');
        prazoInfo = ` (prazo: ${prazoFmt})`;
      }
    }

    const status = semParecer ? 'sem parecer' : `${pl.pareceres_existentes} parecer(es) emitido(s)`;
    return `• ${ref} — ${status}${prazoInfo}`;
  });

  const titulo = sigla
    ? `📋 *Pendências da comissão ${sigla} (${pls.length}):*`
    : `📋 *Pendências nas comissões (${pls.length}):*`;

  return {
    success: true,
    content: `${titulo}\n${linhas.join('\n')}`,
    structured: {
      sigla: sigla ?? null,
      total: pls.length,
      pendencias: pls.map(p => ({
        ref: `${p.tipo_sigla} ${p.numero}/${p.ano}`,
        pareceres_existentes: p.pareceres_existentes ?? 0,
        comissao_atual: p.comissao_atual,
        ultima_tramitacao_data: p.ultima_tramitacao?.data,
      })),
    },
    actions_taken: [`pendencias_listadas${sigla ? `:${sigla}` : ':todas'}`],
  };
}

// ── Action: gerarRelatorio ────────────────────────────────────────────────────

async function gerarRelatorio(data: Record<string, unknown>): Promise<AgentResult> {
  const periodo = ((data.periodo as string) ?? 'semanal').toLowerCase();
  const hoje = new Date();
  const periodoLabel = periodo === 'mensal' ? 'Mensal' : 'Semanal';

  // Fetch all commissions
  const { data: listaData, error: listaErr } = await apiFetch<{ results: ComissaoItem[]; total?: number }>(
    `${INTERNAL_BASE}/api/comissoes/sapl/comissoes`,
  );
  if (listaErr || !listaData) {
    return {
      success: false,
      content: `Não foi possível gerar o relatório: falha ao buscar comissões.\n_Detalhe: ${listaErr}_`,
    };
  }

  const comissoes = listaData.results ?? [];

  // Fetch all PLs in commissions
  const { data: plsData } = await apiFetch<{ total?: number; pls?: PlItem[] }>(
    `${INTERNAL_BASE}/api/comissoes/sapl/pls`,
  );
  const pls = plsData?.pls ?? [];

  // Aggregate metrics
  const totalMaterias = pls.length;
  const semParecer = pls.filter(p => (p.pareceres_existentes ?? 0) === 0).length;
  const comParecer = pls.filter(p => (p.pareceres_existentes ?? 0) > 0).length;

  // Determine overdue (more than 15 days since last tramitação with no parecer)
  const prazosVencidos = pls.filter(p => {
    if ((p.pareceres_existentes ?? 0) > 0) return false;
    if (!p.ultima_tramitacao?.data) return false;
    const entrada = new Date(p.ultima_tramitacao.data);
    const prazo = new Date(entrada);
    prazo.setDate(prazo.getDate() + 15);
    return hoje > prazo;
  }).length;

  // Per-commission breakdown
  const porComissao = comissoes.map(c => {
    const sigla = c.sigla ?? '';
    const materiasComissao = pls.filter(
      p => (p.comissao_atual ?? '').toUpperCase().includes(sigla.toUpperCase()),
    );
    const pendentes = materiasComissao.filter(p => (p.pareceres_existentes ?? 0) === 0).length;
    const com = materiasComissao.filter(p => (p.pareceres_existentes ?? 0) > 0).length;
    return { sigla, nome: c.nome ?? sigla, total: materiasComissao.length, pendentes, com };
  }).filter(c => c.total > 0);

  // Fetch pareceres count from Supabase for the period
  let pareceresEmitidosPeriodo = 0;
  try {
    const supabase = db();
    const diasAtras = periodo === 'mensal' ? 30 : 7;
    const desde = new Date(hoje);
    desde.setDate(desde.getDate() - diasAtras);

    const { count } = await supabase
      .from('pareceres')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .gte('created_at', desde.toISOString());

    pareceresEmitidosPeriodo = count ?? 0;
  } catch {
    // Supabase unavailable — proceed without this metric
    pareceresEmitidosPeriodo = -1;
  }

  // Build markdown report
  const dataFmt = hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const linhasComissao = porComissao.map(
    c => `| ${c.sigla} | ${c.total} | ${c.com} | ${c.pendentes} |`,
  );

  const pareceresLinha = pareceresEmitidosPeriodo >= 0
    ? `- **Pareceres emitidos no período:** ${pareceresEmitidosPeriodo}`
    : '- **Pareceres emitidos no período:** dado indisponível';

  const relatorio = [
    `## Relatório ${periodoLabel} das Comissões — CMBV`,
    `_Gerado em ${dataFmt}_`,
    '',
    '### Resumo Geral',
    `- **Matérias recebidas (em tramitação):** ${totalMaterias}`,
    `- **Com parecer emitido:** ${comParecer}`,
    `- **Sem parecer (pendentes):** ${semParecer}`,
    `- **Prazos vencidos (>15 dias sem parecer):** ${prazosVencidos}`,
    pareceresLinha,
    '',
    '### Por Comissão',
    '| Sigla | Matérias | Com Parecer | Pendentes |',
    '|-------|----------|-------------|-----------|',
    ...linhasComissao,
    '',
    porComissao.length === 0
      ? '_Nenhuma matéria associada a comissões identificadas._'
      : '',
    '### Atenção',
    prazosVencidos > 0
      ? `⚠️ ${prazosVencidos} matéria${prazosVencidos !== 1 ? 's' : ''} com prazo vencido. Priorize a emissão dos pareceres.`
      : '✅ Nenhum prazo vencido no momento.',
  ].filter(l => l !== undefined).join('\n');

  return {
    success: true,
    content: relatorio,
    structured: {
      periodo: periodoLabel,
      gerado_em: dataFmt,
      total_materias: totalMaterias,
      com_parecer: comParecer,
      sem_parecer: semParecer,
      prazos_vencidos: prazosVencidos,
      pareceres_emitidos_periodo: pareceresEmitidosPeriodo,
      por_comissao: porComissao,
    },
    actions_taken: [`relatorio_gerado:${periodo}`],
  };
}

// ── Agent export ──────────────────────────────────────────────────────────────

export const comissaoAgent: AliaAgent = {
  name: 'comissao',
  description: 'Consultas sobre comissões permanentes da CMBV: composição, pendências, prazos e relatórios.',

  async execute({ action, data }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    switch (action) {
      case 'consultar':  return consultarComissao(data);
      case 'pendencias': return listarPendencias(data);
      case 'relatorio':  return gerarRelatorio(data);
      default:           return consultarComissao(data);
    }
  },
};
