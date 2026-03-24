// ═══════════════════════════════════════════
// SAPL CLIENT — Abstração das chamadas ao SAPL
// Câmara Municipal de Boa Vista · Roraima
// Portado de cmbv-parecer/src/sapl-client.js
// ═══════════════════════════════════════════

export const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';
const DEFAULT_TIMEOUT = 15000;
const MAX_RETRIES = 2;

export interface SaplMateria {
  id: number;
  numero: number;
  ano: number;
  ementa?: string;
  tipo?: number | { id: number; sigla?: string; descricao?: string };
  tipo_sigla?: string;
  tipo_descricao?: string;
  autor_nome?: string;
  regime_tramitacao?: { descricao?: string };
  _docs: SaplDocumento[];
  _tramits: SaplTramitacao[];
  _pareceres: SaplParecer[];
  _autorias: SaplAutoria[];
}

export interface SaplDocumento {
  id: number;
  nome?: string;
  arquivo?: string;
  autor?: string;
  data?: string;
  indexacao?: string;
  tipo?: number | { id?: number; descricao?: string; nome?: string };
  __str__?: string;
}

export interface SaplTramitacao {
  id?: number;
  data_tramitacao?: string;
  status?: { id?: number; sigla?: string; descricao?: string } | number;
  texto?: string;
  __str__?: string;
  unidade_tramitacao_local?: number;
  unidade_tramitacao_destino?: number;
}

export interface SaplParecer {
  id?: number;
  comissao_nome?: string;
  comissao?: { nome?: string };
  parecer?: string;
  tipo_resultado_votacao?: { nome?: string };
}

export interface SaplAutoria {
  id?: number;
  autor?: number;
  autor_nome?: string;
  autor_tipo?: string | null;
  __str__?: string;
}

export interface SaplSessao {
  id: number;
  data_inicio?: string;
  data_fim?: string;
  hora_inicio?: string;
  hora_fim?: string;
  numero?: number;
  upload_pauta?: string | null;
  upload_ata?: string | null;
  finalizada?: boolean;
  tipo?: number | { id?: number; nome?: string };
  __str__?: string;
}

export interface SaplDocumentoSessao {
  id: number;
  sessao_plenaria?: number;
  tipo?: number | { id?: number; descricao?: string };
  nome?: string;
  arquivo?: string;
  data_hora?: string;
  __str__?: string;
}

export interface SaplOrdemDiaItem {
  id: number;
  numero_ordem?: number;
  materia: number;
  resultado?: string;
  votacao_nominal?: boolean;
  observacao?: string;
  sessao_plenaria?: number;
}

export interface SaplPagedResponse<T> {
  count?: number;
  next?: string | null;
  results: T[];
  pagination?: { next_page?: number; total_entries?: number };
}

// ── Core HTTP ──────────────────────────────────────────────

async function saplGet<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(path, SAPL_BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });
  url.searchParams.set('format', 'json');

  let lastError: Error = new Error('Unknown error');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
        const delay = Math.max(retryAfter * 1000, 3000 * (attempt + 1));
        await new Promise(r => setTimeout(r, delay));
        lastError = new Error(`SAPL retornou HTTP ${response.status}`);
        continue;
      }

      if (!response.ok) throw new Error(`SAPL retornou HTTP ${response.status}`);

      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) return (await response.json()) as T;

      throw new Error(`Resposta não-JSON do SAPL: ${ct}`);
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function extractNextPage(pageData: SaplPagedResponse<unknown>): number | null {
  if (pageData.pagination?.next_page) return pageData.pagination.next_page;
  if (pageData.next) {
    try {
      const p = new URL(pageData.next).searchParams.get('page');
      return p ? parseInt(p, 10) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function saplGetAll<T>(path: string, params: Record<string, unknown> = {}, maxPages = 10): Promise<SaplPagedResponse<T>> {
  const firstPage = await saplGet<SaplPagedResponse<T>>(path, params);
  let allResults: T[] = firstPage.results || [];
  let currentPage = 1;
  let nextPage = extractNextPage(firstPage as SaplPagedResponse<unknown>);

  while (nextPage && currentPage < maxPages) {
    currentPage++;
    try {
      const pageData = await saplGet<SaplPagedResponse<T>>(path, { ...params, page: nextPage });
      allResults = allResults.concat(pageData.results || []);
      nextPage = extractNextPage(pageData as SaplPagedResponse<unknown>);
    } catch {
      break;
    }
  }

  return { ...firstPage, results: allResults };
}

// ── Public API ─────────────────────────────────────────────

export async function fetchRecentSessions(pageSize = 100): Promise<SaplPagedResponse<SaplSessao>> {
  const currentYear = new Date().getFullYear();
  const startDate = `${currentYear}-01-01`;

  // Usa ordering por -id (confiável) + filtro por data_inicio para o ano atual.
  // NÃO usa ordering=-data_inicio pois algumas sessões têm datas corrompidas
  // (ex: "0213-02-18") que quebram a ordem cronológica.
  const data = await saplGet<SaplPagedResponse<SaplSessao>>('/api/sessao/sessaoplenaria/', {
    page_size: pageSize,
    data_inicio__gte: startDate,
    ordering: '-id',
  });

  let sessions = data.results || [];

  if (sessions.length === 0) {
    const fallback = await saplGet<SaplPagedResponse<SaplSessao>>('/api/sessao/sessaoplenaria/', {
      page_size: pageSize,
      data_inicio__gte: `${currentYear - 1}-01-01`,
      ordering: '-id',
    });
    sessions = fallback.results || [];
  }

  // Sort client-side por data_inicio descendente (mais recente primeiro)
  sessions.sort((a, b) => (b.data_inicio || '').localeCompare(a.data_inicio || ''));
  return { ...data, results: sessions };
}

/**
 * Busca matérias da Ordem do Dia de uma sessão plenária.
 *
 * ATENÇÃO — Esta instância do SAPL (CMBV Boa Vista) NÃO popula a tabela
 * OrdemDia via API. O endpoint /api/sessao/ordemdia/ retorna sempre vazio.
 * A pauta é gerenciada como PDF (upload_pauta).
 *
 * Estratégia principal:
 *  Query tramitações com sessao_plenaria=<id> — o SAPL vincula cada tramitação
 *  à sessão plenária onde a matéria foi votada/discutida.
 *  Isso retorna exatamente as matérias que estiveram na pauta desta sessão.
 *
 * Fallback (sessões futuras sem tramitações ainda registradas):
 *  Busca matérias com status=57 (AVPP – Aguardando Votação em Plenário).
 *
 * Retorna array de IDs de matérias únicas (sem duplicatas).
 */
export async function fetchOrdemDiaMateriaIds(
  sessao: SaplSessao,
): Promise<number[]> {
  const ids = new Set<number>();

  const dataInicio = sessao.data_inicio;
  if (!dataInicio) return [];

  const today = new Date().toISOString().slice(0, 10);
  const sessaoFutura = dataInicio > today;

  // Estratégia 1: tramitações vinculadas diretamente à sessão pelo FK sessao_plenaria.
  // Apenas para sessões passadas — sessões futuras não têm tramitações registradas ainda,
  // e IDs corrompidos no SAPL (ex: sessao_plenaria default) podem retornar 100k+ resultados.
  if (!sessaoFutura) {
    try {
      const data = await saplGetAll<{
        materia: number;
        status?: { id?: number; sigla?: string } | number;
        __str__?: string;
      }>('/api/materia/tramitacao/', {
        sessao_plenaria: sessao.id,
        page_size: 100,
      }, 5);

      for (const t of data.results || []) {
        if (t.materia) ids.add(t.materia);
      }
    } catch {
      // silencioso — tenta fallback
    }
  }

  if (ids.size > 0) return Array.from(ids);

  if (sessaoFutura) {
    // Estratégia 2a: raspa a página HTML da sessão no SAPL.
    // O SAPL publica a pauta na web antes da API retornar dados.
    // Extrai exatamente as matérias da ordem do dia listadas na página.
    const htmlMateriaRegex = /\/materia\/(\d{4,6})\//g;
    const sessionUrls = [
      `${SAPL_BASE}/sessao/${sessao.id}/detail/`,
      `${SAPL_BASE}/sessao/${sessao.id}/`,
    ];
    for (const url of sessionUrls) {
      try {
        const res = await fetch(url, {
          headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 CMBV-Gabinete/2.0' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        let m: RegExpExecArray | null;
        htmlMateriaRegex.lastIndex = 0;
        while ((m = htmlMateriaRegex.exec(html)) !== null) ids.add(parseInt(m[1], 10));
        if (ids.size > 0) break;
      } catch { /* continua */ }
    }

    if (ids.size > 0) return Array.from(ids);

    // Estratégia 2b: AGORDIA (status 30) + AVPP (57) nos últimos 45 dias.
    // Aproximação — pode retornar mais matérias do que a sessão específica,
    // mas é o melhor fallback quando PDF e HTML não estão disponíveis.
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 45);
    const cutoff = cutoffDate.toISOString().slice(0, 10);

    await Promise.all([30, 57].map(async (status) => {
      try {
        const data = await saplGetAll<{ materia: number }>(
          '/api/materia/tramitacao/',
          { status, data_tramitacao__gte: cutoff, ordering: '-data_tramitacao', page_size: 100 },
          3,
        );
        for (const t of data.results || []) {
          if (t.materia) ids.add(t.materia);
        }
      } catch {
        // silencioso
      }
    }));
  } else {
    // Sessão passada mas sem tramitação vinculada por FK — tenta por data + status de votação
    const STATUSES_VOTACAO = [58, 9, 63];
    await Promise.all(
      STATUSES_VOTACAO.map(async (status) => {
        try {
          const data = await saplGetAll<{ materia: number; __str__?: string }>(
            '/api/materia/tramitacao/',
            { status, data_tramitacao: dataInicio, page_size: 100 },
            3,
          );
          for (const t of data.results || []) {
            const str = (t.__str__ || '').toLowerCase();
            const isExpediente =
              str.includes('indicação') ||
              str.includes('requerimento') ||
              str.includes('moção');
            if (!isExpediente && t.materia) ids.add(t.materia);
          }
        } catch {
          // silencioso
        }
      }),
    );
  }

  return Array.from(ids);
}

/**
 * Compatibilidade retroativa: wrapper que usa a nova estratégia
 * mas retorna no formato antigo esperado pelo código existente.
 * @deprecated Use fetchOrdemDiaMateriaIds() diretamente.
 */
export async function fetchOrdemDia(
  sessaoId: number,
  sessao?: SaplSessao,
): Promise<SaplPagedResponse<SaplOrdemDiaItem>> {
  if (!sessao) {
    // Tenta buscar a sessão para ter o data_inicio
    try {
      sessao = await saplGet<SaplSessao>(`/api/sessao/sessaoplenaria/${sessaoId}/`);
    } catch {
      return { results: [] };
    }
  }
  const ids = await fetchOrdemDiaMateriaIds(sessao);
  const items: SaplOrdemDiaItem[] = ids.map((materiaId, idx) => ({
    id: idx + 1,
    numero_ordem: idx + 1,
    materia: materiaId,
    sessao_plenaria: sessaoId,
  }));
  return { count: items.length, results: items };
}

/**
 * Busca documentos da sessão (folha de votação, atas em PDF etc.)
 * O SAPL desta instância NÃO expõe /api/sessao/documentosessao/ — retorna 404.
 * Em vez disso, os documentos ficam diretamente nos campos da sessão:
 *   upload_pauta, upload_ata, upload_anexo
 * Esta função normaliza esses campos num array de documentos.
 */
export function extractDocumentosSessao(sessao: SaplSessao): SaplDocumentoSessao[] {
  const docs: SaplDocumentoSessao[] = [];
  if (sessao.upload_pauta) {
    docs.push({
      id: 1,
      sessao_plenaria: sessao.id,
      nome: 'Pauta / Ordem do Dia',
      arquivo: sessao.upload_pauta,
      tipo: { id: 1, descricao: 'Pauta' },
    });
  }
  if (sessao.upload_ata) {
    docs.push({
      id: 2,
      sessao_plenaria: sessao.id,
      nome: 'Ata da Sessão',
      arquivo: sessao.upload_ata,
      tipo: { id: 2, descricao: 'Ata' },
    });
  }
  return docs;
}

export async function fetchMateria(materiaId: number): Promise<SaplMateria> {
  return saplGet<SaplMateria>(`/api/materia/materialegislativa/${materiaId}/`);
}

export async function fetchDocumentosAcessorios(materiaId: number): Promise<SaplPagedResponse<SaplDocumento>> {
  return saplGetAll<SaplDocumento>('/api/materia/documentoacessorio/', { materia: materiaId });
}

export async function fetchTramitacoes(materiaId: number): Promise<SaplPagedResponse<SaplTramitacao>> {
  return saplGetAll<SaplTramitacao>('/api/materia/tramitacao/', { materia: materiaId });
}

export async function fetchPareceres(materiaId: number): Promise<SaplPagedResponse<SaplParecer>> {
  try {
    const data = await saplGetAll<SaplParecer>('/api/materia/parecer/', { materia: materiaId });
    if (data.results && data.results.length > 0) return data;
  } catch {
    // fallback silencioso
  }
  return { results: [] };
}

async function fetchAutorias(materiaId: number): Promise<SaplPagedResponse<SaplAutoria>> {
  return saplGet('/api/materia/autoria/', { materia: materiaId });
}

async function resolveAuthors(materiaId: number): Promise<SaplAutoria[]> {
  try {
    const autoriaData = await fetchAutorias(materiaId);
    const autorias = autoriaData.results || [];

    return await Promise.all(
      autorias.map(async (a) => {
        try {
          const autorData = await saplGet<{ nome?: string; __str__?: string; tipo?: string }>(`/api/base/autor/${a.autor}/`);
          return {
            ...a,
            autor_nome: autorData.nome || autorData.__str__ || `Autor ${a.autor}`,
            autor_tipo: autorData.tipo || null,
          };
        } catch {
          return { ...a, autor_nome: a.__str__ || `Autor ${a.autor}` };
        }
      }),
    );
  } catch {
    return [];
  }
}

// Cache de tipos de matéria
let tiposCache: Map<number, { sigla: string; descricao: string }> | null = null;

async function fetchTiposMateriaMap(): Promise<Map<number, { sigla: string; descricao: string }>> {
  if (tiposCache) return tiposCache;
  try {
    const data = await saplGet<SaplPagedResponse<{ id: number; sigla: string; descricao?: string; __str__?: string }>>(
      '/api/materia/tipomaterialegislativa/',
      { page_size: 50 },
    );
    tiposCache = new Map();
    (data.results || []).forEach(t => {
      tiposCache!.set(t.id, { sigla: t.sigla, descricao: t.descricao || t.__str__ || '' });
    });
  } catch {
    tiposCache = new Map();
  }
  return tiposCache;
}

async function resolveTypeInfo(materia: SaplMateria): Promise<SaplMateria> {
  const tipos = await fetchTiposMateriaMap();
  const tipoId = typeof materia.tipo === 'number' ? materia.tipo : materia.tipo?.id;
  if (tipoId && tipos.has(tipoId)) {
    const info = tipos.get(tipoId)!;
    materia.tipo_sigla = info.sigla;
    materia.tipo_descricao = info.descricao;
  }
  return materia;
}

/**
 * Enriquecimento leve: resolve apenas tipo e autores.
 * Usado na listagem da ordem do dia — rápido, sem docs/tramitações/pareceres.
 * Para qualquer volume de matérias (40, 60...) sem risco de timeout.
 */
export async function lightEnrichMateria(materia: SaplMateria): Promise<SaplMateria> {
  const [, autorias] = await Promise.all([
    resolveTypeInfo(materia),
    resolveAuthors(materia.id).catch(() => [] as SaplAutoria[]),
  ]);

  return {
    ...materia,
    _docs: [],
    _tramits: [],
    _pareceres: [],
    _autorias: autorias,
    autor_nome: autorias.length > 0
      ? autorias.map(a => a.autor_nome).filter(Boolean).join(', ')
      : materia.autor_nome,
  };
}

/**
 * Enriquece uma matéria com docs, tramitações, pareceres e autorias em paralelo.
 */
export async function enrichMateria(materia: SaplMateria): Promise<SaplMateria> {
  const [docs, tramits, pareceres, autorias] = await Promise.all([
    fetchDocumentosAcessorios(materia.id).catch(() => ({ results: [] as SaplDocumento[] })),
    fetchTramitacoes(materia.id).catch(() => ({ results: [] as SaplTramitacao[] })),
    fetchPareceres(materia.id).catch(() => ({ results: [] as SaplParecer[] })),
    resolveAuthors(materia.id).catch(() => [] as SaplAutoria[]),
  ]);

  await resolveTypeInfo(materia);

  return {
    ...materia,
    _docs: docs.results || [],
    _tramits: tramits.results || [],
    _pareceres: pareceres.results || [],
    _autorias: autorias,
    autor_nome: autorias.length > 0 ? autorias.map(a => a.autor_nome).filter(Boolean).join(', ') : materia.autor_nome,
  };
}
