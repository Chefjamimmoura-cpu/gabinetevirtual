// src/lib/alia/agents/crossmodule.agent.ts
// ALIA Agent: Cross-Module — análise integrada cruzando dados entre todos os módulos.

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const GABINETE_ID = process.env.GABINETE_ID!;
const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CadinResult {
  nome: string | null;
  cargo: string | null;
  orgao: string | null;
  esfera: string | null;
  telefone: string | null;
}

interface IndicacaoResult {
  id_curto: string;
  logradouro: string | null;
  bairro: string | null;
  status: string | null;
}

interface ParecerResult {
  id: string;
  materia: string | null;
  status: string | null;
  created_at: string | null;
}

interface AgendaResult {
  titulo: string | null;
  data_inicio: string | null;
  local: string | null;
  tipo: string | null;
}

interface OrdemResult {
  numero: string | number | null;
  data_inicio: string | null;
  tipo: string | null;
  [key: string]: unknown;
}

// ── Search Helpers ────────────────────────────────────────────────────────────

async function searchCadin(query: string): Promise<CadinResult[]> {
  try {
    const supa = db();
    const termo = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3)[0] ?? query;

    const SELECT_FIELDS = `title,
      cadin_persons ( full_name, phone ),
      cadin_organizations ( name, sphere )`;

    const [resPessoa, resOrg, resCargo] = await Promise.all([
      supa.from('cadin_appointments').select(SELECT_FIELDS).eq('active', true).ilike('cadin_persons.full_name', `%${termo}%`).limit(5),
      supa.from('cadin_appointments').select(SELECT_FIELDS).eq('active', true).ilike('cadin_organizations.name', `%${termo}%`).limit(5),
      supa.from('cadin_appointments').select(SELECT_FIELDS).eq('active', true).ilike('title', `%${termo}%`).limit(5),
    ]);

    type ApptRow = {
      title: string;
      cadin_persons: { full_name: string; phone?: string } | { full_name: string; phone?: string }[] | null;
      cadin_organizations: { name: string; sphere?: string } | { name: string; sphere?: string }[] | null;
    };

    const combined = [
      ...((resPessoa.data ?? []) as unknown as ApptRow[]),
      ...((resOrg.data    ?? []) as unknown as ApptRow[]),
      ...((resCargo.data  ?? []) as unknown as ApptRow[]),
    ];

    const seen = new Set<string>();
    return combined
      .filter(r => {
        const p = Array.isArray(r.cadin_persons) ? r.cadin_persons[0] : r.cadin_persons;
        const o = Array.isArray(r.cadin_organizations) ? r.cadin_organizations[0] : r.cadin_organizations;
        const key = `${p?.full_name ?? ''}|${o?.name ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5)
      .map(r => {
        const p = Array.isArray(r.cadin_persons) ? r.cadin_persons[0] : r.cadin_persons;
        const o = Array.isArray(r.cadin_organizations) ? r.cadin_organizations[0] : r.cadin_organizations;
        return {
          nome:     p?.full_name ?? null,
          cargo:    r.title ?? null,
          orgao:    o?.name ?? null,
          esfera:   o?.sphere ?? null,
          telefone: p?.phone ?? null,
        };
      });
  } catch {
    return [];
  }
}

async function searchIndicacoes(query: string): Promise<IndicacaoResult[]> {
  try {
    const supa = db();
    const termo = query.split(/\s+/).filter(w => w.length >= 3)[0] ?? query;

    const [resBairro, resLogradouro] = await Promise.all([
      supa.from('indicacoes')
        .select('id, logradouro, bairro, status')
        .eq('gabinete_id', GABINETE_ID)
        .ilike('bairro', `%${termo}%`)
        .limit(5),
      supa.from('indicacoes')
        .select('id, logradouro, bairro, status')
        .eq('gabinete_id', GABINETE_ID)
        .ilike('logradouro', `%${termo}%`)
        .limit(5),
    ]);

    type IndRow = { id: string; logradouro: string | null; bairro: string | null; status: string | null };

    const combined = [
      ...((resBairro.data     ?? []) as IndRow[]),
      ...((resLogradouro.data ?? []) as IndRow[]),
    ];

    const seen = new Set<string>();
    return combined
      .filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      })
      .slice(0, 5)
      .map(r => ({
        id_curto:   (r.id as string).substring(0, 8).toUpperCase(),
        logradouro: r.logradouro,
        bairro:     r.bairro,
        status:     r.status,
      }));
  } catch {
    return [];
  }
}

async function searchPareceres(query: string): Promise<ParecerResult[]> {
  try {
    const supa = db();
    const termo = query.split(/\s+/).filter(w => w.length >= 3)[0] ?? query;

    const { data } = await supa
      .from('pareceres')
      .select('id, materia_ementa, status, created_at')
      .eq('gabinete_id', GABINETE_ID)
      .ilike('materia_ementa', `%${termo}%`)
      .order('created_at', { ascending: false })
      .limit(5);

    type ParecerRow = { id: string; materia_ementa?: string | null; status?: string | null; created_at?: string | null };

    return ((data ?? []) as ParecerRow[]).map(r => ({
      id:         (r.id as string).substring(0, 8).toUpperCase(),
      materia:    r.materia_ementa ?? null,
      status:     r.status ?? null,
      created_at: r.created_at ?? null,
    }));
  } catch {
    return [];
  }
}

async function searchAgenda(query: string): Promise<AgendaResult[]> {
  try {
    const supa = db();
    const termo = query.split(/\s+/).filter(w => w.length >= 3)[0] ?? query;
    const now = new Date().toISOString();

    const [resTitulo, resLocal] = await Promise.all([
      supa.from('agenda_eventos')
        .select('titulo, data_inicio, local, tipo')
        .eq('gabinete_id', GABINETE_ID)
        .ilike('titulo', `%${termo}%`)
        .gte('data_inicio', now)
        .order('data_inicio', { ascending: true })
        .limit(5),
      supa.from('agenda_eventos')
        .select('titulo, data_inicio, local, tipo')
        .eq('gabinete_id', GABINETE_ID)
        .ilike('local', `%${termo}%`)
        .gte('data_inicio', now)
        .order('data_inicio', { ascending: true })
        .limit(5),
    ]);

    type AgendaRow = { titulo?: string | null; data_inicio?: string | null; local?: string | null; tipo?: string | null };

    const combined = [
      ...((resTitulo.data ?? []) as AgendaRow[]),
      ...((resLocal.data  ?? []) as AgendaRow[]),
    ];

    const seen = new Set<string>();
    return combined
      .filter(r => {
        const key = `${r.titulo ?? ''}|${r.data_inicio ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5)
      .map(r => ({
        titulo:      r.titulo ?? null,
        data_inicio: r.data_inicio ?? null,
        local:       r.local ?? null,
        tipo:        r.tipo ?? null,
      }));
  } catch {
    return [];
  }
}

async function searchOrdemDia(query: string): Promise<OrdemResult[]> {
  try {
    const termo = query.split(/\s+/).filter(w => w.length >= 3)[0] ?? query;

    const res = await fetch(`${INTERNAL_BASE}/api/pareceres/ordens-ativas`);
    if (!res.ok) return [];

    const json = await res.json() as { results?: OrdemResult[] };
    const ordens = json.results ?? [];

    const termLower = termo.toLowerCase();
    return ordens
      .filter(o => {
        const haystack = JSON.stringify(o).toLowerCase();
        return haystack.includes(termLower);
      })
      .slice(0, 5);
  } catch {
    return [];
  }
}

// ── Format Helpers ────────────────────────────────────────────────────────────

function formatCadin(results: CadinResult[]): string {
  if (results.length === 0) return 'Nenhum resultado';
  return results
    .map(r => `• ${r.nome ?? 'N/I'} — ${r.cargo ?? ''}${r.orgao ? ` (${r.orgao})` : ''}${r.esfera ? ` [${r.esfera}]` : ''}`)
    .join('\n');
}

function formatIndicacoes(results: IndicacaoResult[]): string {
  if (results.length === 0) return 'Nenhum resultado';
  return results
    .map(r => `• ${r.id_curto} — ${r.logradouro ?? ''}, ${r.bairro ?? ''} [${r.status ?? 'N/I'}]`)
    .join('\n');
}

function formatPareceres(results: ParecerResult[]): string {
  if (results.length === 0) return 'Nenhum resultado';
  return results
    .map(r => `• ${r.id} — ${r.materia ?? 'sem ementa'} [${r.status ?? 'N/I'}]`)
    .join('\n');
}

function formatAgenda(results: AgendaResult[]): string {
  if (results.length === 0) return 'Nenhum resultado';
  return results
    .map(r => {
      const data = r.data_inicio
        ? new Date(r.data_inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'N/I';
      return `• ${r.titulo ?? 'N/I'} — ${data}${r.local ? ` @ ${r.local}` : ''}`;
    })
    .join('\n');
}

function formatOrdemDia(results: OrdemResult[]): string {
  if (results.length === 0) return 'Nenhum resultado';
  return results
    .map(r => `• Sessão ${r.numero ?? 'N/I'} — ${r.data_inicio ?? ''} [${r.tipo ?? 'N/I'}]`)
    .join('\n');
}

// ── consultaCruzada ───────────────────────────────────────────────────────────

async function consultaCruzada(
  data: Record<string, unknown>,
  _context: AgentContext,
): Promise<AgentResult> {
  const query = ((data.text as string) || (data.query as string) || '').trim();

  if (!query) {
    return {
      success: false,
      content: 'Informe o que deseja pesquisar para a análise integrada.',
    };
  }

  // 1. Parallel data gathering across all modules
  const [cadinResults, indicacoesResults, pareceresResults, agendaResults, ordemResults] =
    await Promise.all([
      searchCadin(query),
      searchIndicacoes(query),
      searchPareceres(query),
      searchAgenda(query),
      searchOrdemDia(query),
    ]);

  // 2. Synthesize with Gemini
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return {
      success: false,
      content: 'Chave da API Gemini não configurada para análise integrada.',
    };
  }

  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Você é ALIA em modo análise integrada. O usuário perguntou: "${query}"

Dados encontrados nos módulos do gabinete:

[CADIN]
${formatCadin(cadinResults)}

[INDICAÇÕES]
${formatIndicacoes(indicacoesResults)}

[PARECERES]
${formatPareceres(pareceresResults)}

[AGENDA]
${formatAgenda(agendaResults)}

[ORDEM DO DIA]
${formatOrdemDia(ordemResults)}

Responda cruzando os dados encontrados. Conecte autoridades com matérias, indicações com ofícios, etc. Se não há dados relevantes em algum módulo, não invente.`;

  const geminiRes = await model.generateContent(prompt);
  const answer = geminiRes.response.text().trim();

  const totalResults =
    cadinResults.length +
    indicacoesResults.length +
    pareceresResults.length +
    agendaResults.length +
    ordemResults.length;

  return {
    success: true,
    content: answer,
    structured: {
      query,
      totais: {
        cadin:      cadinResults.length,
        indicacoes: indicacoesResults.length,
        pareceres:  pareceresResults.length,
        agenda:     agendaResults.length,
        ordem_dia:  ordemResults.length,
        total:      totalResults,
      },
    },
    actions_taken: ['cross_module_query'],
  };
}

// ── Agent export ──────────────────────────────────────────────────────────────

export const crossmoduleAgent: AliaAgent = {
  name: 'crossmodule',
  description: 'Análise integrada cruzando dados entre todos os módulos',

  async execute({ action: _action, data, context }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      return await consultaCruzada(data, context);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro no agente de análise integrada: ${msg}` };
    }
  },
};
