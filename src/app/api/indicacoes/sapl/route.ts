// GET /api/indicacoes/sapl
//
// Lista Indicações e Requerimentos do Vereador(a) no SAPL.
// Dados paginados, com suporte a filtros de busca, ano, status de tramitação
// e tipo. Retorna também o link direto no SAPL e a última tramitação.
//
// Parâmetros:
//   page         — página (padrão: 1)
//   page_size    — itens por página (padrão: 20, máx: 100)
//   q            — busca por ementa (texto livre)
//   ano          — filtrar por ano (ex: 2026)
//   tipo         — "IND" | "REQ" | "all" (padrão: "all")
//   em_tramitacao — "true" | "false" | "all" (padrão: "all")
//   ordering     — campo de ordenação (padrão: -data_apresentacao)

import { NextRequest, NextResponse } from 'next/server';
import { SAPL_BASE } from '@/lib/sapl/client';
import { smartTitleCase } from '@/lib/utils/format';

// ID do Vereador no SAPL (injetado via ENV ou fallback para 127)
const DEFAULT_VEREADOR_ID = process.env.VEREADOR_AUTOR_ID ? Number(process.env.VEREADOR_AUTOR_ID) : 127;

// IDs dos tipos de matéria no SAPL
const TIPO_IDS: Record<string, number> = {
  IND: 8,   // Indicação
  REQ: 3,   // Requerimento
  MOC: 7,   // Moção
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
  tipo?: number | { id: number; sigla?: string; descricao?: string };
  em_tramitacao?: boolean;
  data_apresentacao?: string;
  __str__?: string;
  metadata?: {
    signs?: {
      texto_original?: {
        autores?: [string, [string, string]][];
      };
    };
  };
}

interface SaplTramitacao {
  data_tramitacao?: string;
  status?: { sigla?: string; descricao?: string };
  unidade_tramitacao_destino?: { __str__?: string };
  texto?: string;
}

interface SaplPaginatedResponse<T> {
  pagination?: { total_entries?: number; total_pages?: number; next_page?: number | null; page?: number };
  count?: number;
  next?: string | null;
  results: T[];
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page      = sp.get('page') || '1';
  const pageSize  = String(Math.min(parseInt(sp.get('page_size') || '20'), 100));
  const q         = sp.get('q') || '';
  const ano       = sp.get('ano') || '';
  const tipoFiltro = (sp.get('tipo') || 'all').toUpperCase();
  const emTramit  = sp.get('em_tramitacao') || 'all';
  const ordering  = sp.get('ordering') || '-data_apresentacao';
  const autorParam = sp.get('autor');
  
  const autorBusca = autorParam ? Number(autorParam) : DEFAULT_VEREADOR_ID;

  // Montar lista de tipo_ids a buscar
  const tipoIds: number[] = tipoFiltro === 'ALL'
    ? [TIPO_IDS.IND, TIPO_IDS.REQ, TIPO_IDS.MOC]
    : tipoFiltro === 'IND' ? [TIPO_IDS.IND]
    : tipoFiltro === 'REQ' ? [TIPO_IDS.REQ]
    : tipoFiltro === 'MOC' ? [TIPO_IDS.MOC]
    : [TIPO_IDS.IND, TIPO_IDS.REQ];

  try {
    // Buscar tipo de matéria map para resolver siglas
    const tiposData = await saplFetch<SaplPaginatedResponse<{ id: number; sigla: string; descricao?: string }>>(
      '/api/materia/tipomaterialegislativa/', { page_size: '50' }
    );
    const tiposMap = new Map<number, { sigla: string; descricao?: string }>();
    (tiposData.results || []).forEach(t => tiposMap.set(t.id, { sigla: t.sigla, descricao: t.descricao }));

    // Se buscamos apenas um tipo, podemos paginar diretamente.
    // Se buscamos múltiplos, fazemos chamadas paralelas e mesclamos.
    let allResults: (SaplMateria & { tipo_sigla: string; sapl_url: string })[] = [];
    let totalEntries = 0;
    let totalPages = 1;

    if (tipoIds.length === 1) {
      // Busca simples com paginação nativa do SAPL
      const params: Record<string, string> = {
        autores: String(autorBusca),
        tipo: String(tipoIds[0]),
        page, page_size: pageSize, ordering,
      };
      if (q) params.search = q;
      if (ano) params.ano = ano;
      if (emTramit === 'true') params.em_tramitacao = 'True';
      if (emTramit === 'false') params.em_tramitacao = 'False';

      const data = await saplFetch<SaplPaginatedResponse<SaplMateria>>('/api/materia/materialegislativa/', params);
      totalEntries = data.pagination?.total_entries ?? data.count ?? 0;
      totalPages   = data.pagination?.total_pages ?? Math.ceil(totalEntries / parseInt(pageSize));
      allResults   = (data.results || []).map(m => ({
        ...m,
        ementa: m.ementa ? smartTitleCase(m.ementa) : undefined,
        tipo_sigla: tiposMap.get(typeof m.tipo === 'number' ? m.tipo : (m.tipo as { id: number })?.id)?.sigla || '?',
        sapl_url: `${SAPL_BASE}/materia/${m.id}`,
      }));
    } else {
      // Múltiplos tipos: buscar em paralelo e mesclar.
      // Para paginação cross-tipo simplificada, buscamos a página em cada tipo e agregamos,
      // correndo o risco de datas desalinhadas. Uma abordagem perfeita exigiria buscar tudo 
      // ou ter um endpoint que aceita vários tipos.
      const fetchPerTipo = tipoIds.map(tipoId => {
        const params: Record<string, string> = {
          autores: String(autorBusca),
          tipo: String(tipoId),
          page_size: String(Math.ceil(parseInt(pageSize) / tipoIds.length)),
          page,
          ordering,
        };
        if (q) params.search = q;
        if (ano) params.ano = ano;
        if (emTramit === 'true') params.em_tramitacao = 'True';
        if (emTramit === 'false') params.em_tramitacao = 'False';
        return saplFetch<SaplPaginatedResponse<SaplMateria>>('/api/materia/materialegislativa/', params);
      });

      const responses = await Promise.all(fetchPerTipo.map(p => p.catch(() => ({ results: [], count: 0 } as SaplPaginatedResponse<SaplMateria>))));
      
      let maxPages = 1;
      responses.forEach((data, index) => {
        const typeTotal = data.pagination?.total_entries ?? data.count ?? 0;
        totalEntries += typeTotal;
        const typePages = data.pagination?.total_pages ?? Math.ceil(typeTotal / Math.ceil(parseInt(pageSize) / tipoIds.length));
        if (typePages > maxPages) maxPages = typePages;

        (data.results || []).forEach(m => {
          allResults.push({
            ...m,
            ementa: m.ementa ? smartTitleCase(m.ementa) : undefined,
            tipo_sigla: tiposMap.get(typeof m.tipo === 'number' ? m.tipo : (m.tipo as { id: number })?.id)?.sigla || '?',
            sapl_url: `${SAPL_BASE}/materia/${m.id}`,
          });
        });
      });

      // Ordenar mesclado por data_apresentacao desc
      allResults.sort((a, b) => (b.data_apresentacao || '').localeCompare(a.data_apresentacao || ''));
      totalPages = maxPages;
    }

    // Buscar última tramitação das matérias da página atual (em paralelo, com limite)
    const enriched = await Promise.all(
      allResults.map(async (m) => {
        try {
          const tData = await saplFetch<SaplPaginatedResponse<SaplTramitacao>>(
            '/api/materia/tramitacao/',
            { materia: String(m.id), page_size: '1', ordering: '-data_tramitacao' }
          );
          const ultima = (tData.results || [])[0];
          return {
            ...m,
            ultima_tramitacao: ultima ? {
              data: ultima.data_tramitacao,
              status: ultima.status?.descricao || ultima.status?.sigla || '—',
              destino: ultima.unidade_tramitacao_destino?.__str__ || '—',
              texto: ultima.texto,
            } : null,
          };
        } catch {
          return { ...m, ultima_tramitacao: null };
        }
      })
    );

    return NextResponse.json({
      page: parseInt(page),
      page_size: parseInt(pageSize),
      total: totalEntries,
      total_pages: totalPages,
      filtros: { q, ano, tipo: tipoFiltro, em_tramitacao: emTramit },
      autor: { id: autorBusca, nome: autorBusca === 127 ? 'Carol Dantas' : 'Outro Vereador' },
      results: enriched,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar indicações';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
