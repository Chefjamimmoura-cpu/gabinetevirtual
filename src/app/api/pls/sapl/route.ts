// GET /api/pls/sapl
//
// Lista Projetos de Lei e demais proposições legislativas do Vereador(a)
// Dantas no SAPL (PLL, PLC, PDL, PRE, REQ, MOC).
//
// Parâmetros:
//   page         — página (padrão: 1)
//   page_size    — itens por página (padrão: 20, máx: 50)
//   q            — busca por ementa
//   ano          — filtrar por ano
//   tipo         — "PLL"|"PLC"|"PDL"|"PRE"|"all" (padrão: "all")
//   em_tramitacao — "true"|"false"|"all" (padrão: "all")

import { NextRequest, NextResponse } from 'next/server';
import { SAPL_BASE } from '@/lib/sapl/client';
import { smartTitleCase } from '@/lib/utils/format';
import { requireAuth } from '@/lib/supabase/auth-guard';

const DEFAULT_VEREADOR_ID = process.env.VEREADOR_AUTOR_ID ? Number(process.env.VEREADOR_AUTOR_ID) : 127;

// Tipos de matéria legislativa (proposições de lei)
const TIPO_PL: Record<string, number> = {
  PLL:  1,   // Projeto de Lei do Legislativo
  PLC:  5,   // Projeto de Lei Complementar
  PDL:  6,   // Projeto de Decreto Legislativo (honrarias)
  PRE:  2,   // Projeto de Resolução
  REQ:  3,   // Requerimento
  MOC:  7,   // Moção
  PELOM: 15, // Proposta de Emenda à Lei Orgânica
};

const DEFAULT_TIMEOUT = 15000;

async function saplFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, SAPL_BASE);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  url.searchParams.set('format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'CMBV-Gabinete/2.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`SAPL HTTP ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

interface SaplMateria {
  id: number;
  numero: number;
  ano: number;
  ementa?: string;
  tipo?: number | { id: number; sigla?: string };
  em_tramitacao?: boolean;
  data_apresentacao?: string;
  __str__?: string;
}

interface SaplPaginatedResponse<T> {
  pagination?: { total_entries?: number; total_pages?: number; next_page?: number | null; page?: number };
  count?: number;
  next?: string | null;
  results: T[];
}

interface SaplTramitacao {
  data_tramitacao?: string;
  status?: { sigla?: string; descricao?: string };
  unidade_tramitacao_destino?: { __str__?: string };
  texto?: string;
}

interface SaplDocAcessorio {
  id: number;
  nome?: string;
  tipo?: number | { id?: number };
  arquivo?: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const page       = sp.get('page') || '1';
  const pageSize   = String(Math.min(parseInt(sp.get('page_size') || '20'), 50));
  const q          = sp.get('q') || '';
  const ano        = sp.get('ano') || '';
  const tipoFiltro = (sp.get('tipo') || 'all').toUpperCase();
  const emTramit   = sp.get('em_tramitacao') || 'all';
  const autorParam = sp.get('autor');
  
  const autorBusca = autorParam ? Number(autorParam) : DEFAULT_VEREADOR_ID;

  // Montar IDs de tipo a buscar
  const tipoIds: { sigla: string; id: number }[] = tipoFiltro === 'ALL'
    ? Object.entries(TIPO_PL).map(([sigla, id]) => ({ sigla, id }))
    : TIPO_PL[tipoFiltro] ? [{ sigla: tipoFiltro, id: TIPO_PL[tipoFiltro] }]
    : Object.entries(TIPO_PL).map(([sigla, id]) => ({ sigla, id }));

  try {
    const allResults: (SaplMateria & { tipo_sigla: string; sapl_url: string })[] = [];
    let totalEntries = 0;

    // Buscar todos os tipos em paralelo
    const fetches = tipoIds.map(({ sigla, id }) => {
      const params: Record<string, string> = {
        autores: String(autorBusca),
        tipo: String(id),
        page_size: tipoIds.length === 1 ? pageSize : '100',
        ordering: '-data_apresentacao',
      };
      if (q) params.search = q;
      if (ano) params.ano = ano;
      if (emTramit === 'true') params.em_tramitacao = 'True';
      if (emTramit === 'false') params.em_tramitacao = 'False';

      return saplFetch<SaplPaginatedResponse<SaplMateria>>('/api/materia/materialegislativa/', params)
        .then(data => ({ sigla, data }))
        .catch(() => ({ sigla, data: { results: [], count: 0 } as SaplPaginatedResponse<SaplMateria> }));
    });

    const responses = await Promise.all(fetches);

    // Resumo por tipo
    const resumoPorTipo: Record<string, number> = {};
    responses.forEach(({ sigla, data }) => {
      const count = data.pagination?.total_entries ?? data.count ?? 0;
      resumoPorTipo[sigla] = count;
      totalEntries += count;
      (data.results || []).forEach(m => {
        allResults.push({ ...m, tipo_sigla: sigla, sapl_url: `${SAPL_BASE}/materia/${m.id}` });
      });
    });

    // Ordenar por data desc
    allResults.sort((a, b) => (b.data_apresentacao || '').localeCompare(a.data_apresentacao || ''));

    // Paginação manual quando buscamos múltiplos tipos
    const startIdx = (parseInt(page) - 1) * parseInt(pageSize);
    const pageResults = tipoIds.length === 1 ? allResults : allResults.slice(startIdx, startIdx + parseInt(pageSize));
    const totalPages = Math.ceil(totalEntries / parseInt(pageSize));

    // Enriquecer com última tramitação + docs em paralelo
    const enriched = await Promise.all(
      pageResults.map(async (m) => {
        const [tData, docsData] = await Promise.all([
          saplFetch<SaplPaginatedResponse<SaplTramitacao>>(
            '/api/materia/tramitacao/',
            { materia: String(m.id), page_size: '1', ordering: '-data_tramitacao' }
          ).catch(() => ({ results: [] } as SaplPaginatedResponse<SaplTramitacao>)),
          saplFetch<SaplPaginatedResponse<SaplDocAcessorio>>(
            '/api/materia/documentoacessorio/',
            { materia: String(m.id), page_size: '5' }
          ).catch(() => ({ results: [] } as SaplPaginatedResponse<SaplDocAcessorio>)),
        ]);

        const ultima = (tData.results || [])[0];
        const temTextoOriginal = (docsData.results || []).some(d => {
          const tipoId = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
          return tipoId === 1 || tipoId === 16 || d.nome?.toLowerCase().includes('texto');
        });

        return {
          id: m.id,
          numero: m.numero,
          ano: m.ano,
          tipo_sigla: m.tipo_sigla,
          ementa: m.ementa ? smartTitleCase(m.ementa) : undefined,
          em_tramitacao: m.em_tramitacao,
          data_apresentacao: m.data_apresentacao,
          sapl_url: m.sapl_url,
          tem_texto: temTextoOriginal,
          total_docs: (docsData.results || []).length,
          ultima_tramitacao: ultima ? {
            data: ultima.data_tramitacao,
            status: ultima.status?.descricao || ultima.status?.sigla || '—',
            destino: ultima.unidade_tramitacao_destino?.__str__ || '—',
            texto: ultima.texto,
          } : null,
        };
      })
    );

    return NextResponse.json({
      page: parseInt(page),
      page_size: parseInt(pageSize),
      total: totalEntries,
      total_pages: totalPages,
      resumo_por_tipo: resumoPorTipo,
      filtros: { q, ano, tipo: tipoFiltro, em_tramitacao: emTramit },
      autor: { id: autorBusca, nome: autorBusca === 127 ? 'Carol Dantas' : 'Outro Vereador' },
      results: enriched,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar PLs';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
