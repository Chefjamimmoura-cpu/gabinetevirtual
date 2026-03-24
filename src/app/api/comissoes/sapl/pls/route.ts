// GET /api/comissoes/sapl/pls?comissao=CLJRF&tipo=PLL,PLC
//
// Busca PLs (Projetos de Lei) ativos no SAPL que estejam atualmente
// aguardando parecer em comissões. Detecta isso analisando a tramitação
// mais recente de cada matéria — se o destino/status indica "comissão",
// a matéria é incluída.
//
// Parâmetros opcionais:
//   comissao  — sigla da comissão para filtrar (ex: CLJRF). Se omitido, retorna todas.
//   tipo      — tipos de matéria separados por vírgula (padrão: PLL,PLC,PLO)
//   page_size — quantas matérias buscar do SAPL (padrão: 100)

import { NextRequest, NextResponse } from 'next/server';
import { SAPL_BASE, fetchTramitacoes, fetchDocumentosAcessorios } from '@/lib/sapl/client';

const DEFAULT_TIMEOUT = 15000;
const ENRICH_DELAY_MS = 250;

// Keywords que indicam que uma tramitação aponta para uma comissão
const COMISSAO_KEYWORDS = [
  'comiss', 'cljrf', 'ccj', 'cof', 'cofftc', 'casp', 'cecej', 'cssma', 'cdhu',
  'aguardando parecer', 'encaminhad', 'em estudo', 'em análise',
];

// Siglas de tipos de matéria que interessam (PLs, não honrarias)
const DEFAULT_TIPOS = ['PLL', 'PLC', 'PLO', 'PLS'];

async function saplFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, SAPL_BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
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

interface RawMateria {
  id: number;
  numero: number;
  ano: number;
  ementa?: string;
  tipo?: number | { id: number; sigla?: string };
  tipo_sigla?: string;
  em_tramitacao?: boolean;
  __str__?: string;
}

interface RawTramitacao {
  id?: number;
  data_tramitacao?: string;
  status?: { sigla?: string; descricao?: string };
  unidade_tramitacao_destino?: { __str__?: string; comissao?: { nome?: string; sigla?: string } | null };
  texto?: string;
  __str__?: string;
}

function isComissaoTramitacao(t: RawTramitacao): boolean {
  const parts = [
    t.status?.descricao || '',
    t.status?.sigla || '',
    t.unidade_tramitacao_destino?.__str__ || '',
    t.unidade_tramitacao_destino?.comissao?.nome || '',
    t.unidade_tramitacao_destino?.comissao?.sigla || '',
    t.texto || '',
    t.__str__ || '',
  ].join(' ').toLowerCase();

  return COMISSAO_KEYWORDS.some(kw => parts.includes(kw));
}

function extractComissaoDestino(t: RawTramitacao): string | null {
  if (t.unidade_tramitacao_destino?.comissao?.sigla) {
    return t.unidade_tramitacao_destino.comissao.sigla;
  }
  if (t.unidade_tramitacao_destino?.comissao?.nome) {
    return t.unidade_tramitacao_destino.comissao.nome;
  }
  // Tentar extrair do __str__ da unidade
  const str = t.unidade_tramitacao_destino?.__str__ || '';
  if (str) return str;
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const comissaoFiltro = (searchParams.get('comissao') || '').toLowerCase();
  const tiposFiltro = (searchParams.get('tipo') || DEFAULT_TIPOS.join(',')).split(',').map(t => t.trim().toUpperCase());
  const pageSize = Math.min(parseInt(searchParams.get('page_size') || '100'), 200);

  try {
    // 1. Buscar tipos de matéria para mapear sigla → id
    const tiposData = await saplFetch<{ results: { id: number; sigla: string }[] }>(
      '/api/materia/tipomaterialegislativa/',
      { page_size: '50' }
    );
    const tiposMap = new Map<string, number>();
    (tiposData.results || []).forEach(t => tiposMap.set(t.sigla.toUpperCase(), t.id));

    // 2. Para cada tipo desejado, buscar matérias em tramitação
    const allMaterias: RawMateria[] = [];
    for (const sigla of tiposFiltro) {
      const tipoId = tiposMap.get(sigla);
      if (!tipoId) continue;

      const materiaParams: Record<string, string> = {
        tipo: String(tipoId),
        em_tramitacao: 'True',
        page_size: String(Math.ceil(pageSize / tiposFiltro.length)),
        ordering: '-data_apresentacao',
      };

      try {
        const data = await saplFetch<{ results: RawMateria[] }>('/api/materia/materialegislativa/', materiaParams);
        (data.results || []).forEach(m => { m.tipo_sigla = sigla; });
        allMaterias.push(...(data.results || []));
      } catch {
        // tipo sem resultados — continuar
      }
      await new Promise(r => setTimeout(r, ENRICH_DELAY_MS));
    }

    // 3. Para cada matéria, verificar se a tramitação mais recente aponta para comissão
    const result = [];
    for (const materia of allMaterias) {
      try {
        const tramitsData = await fetchTramitacoes(materia.id);
        const tramits = (tramitsData.results || []) as RawTramitacao[];
        if (tramits.length === 0) continue;

        // Ordenar da mais recente para a mais antiga
        const sorted = [...tramits].sort((a, b) =>
          (b.data_tramitacao || '').localeCompare(a.data_tramitacao || '')
        );

        // Verificar se alguma das 3 tramitações mais recentes indica comissão
        const recentTramits = sorted.slice(0, 3);
        const comissaoTramit = recentTramits.find(isComissaoTramitacao);
        if (!comissaoTramit) continue;

        const comissaoDestino = extractComissaoDestino(comissaoTramit);

        // Filtrar por comissão específica se solicitado
        if (comissaoFiltro && comissaoDestino) {
          const destinoLower = comissaoDestino.toLowerCase();
          if (!destinoLower.includes(comissaoFiltro) && !comissaoFiltro.includes(destinoLower.substring(0, 4))) {
            continue;
          }
        }

        // Buscar documentos de parecer já existentes
        const docsData = await fetchDocumentosAcessorios(materia.id);
        const pareceresDocs = (docsData.results || []).filter(d => {
          const tipo = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
          return tipo === 1 || tipo === 16; // TIPO_PARECER_RELATOR ou TIPO_PARECER_COMISSAO
        });

        result.push({
          id: materia.id,
          numero: materia.numero,
          ano: materia.ano,
          tipo_sigla: materia.tipo_sigla,
          ementa: materia.ementa,
          sapl_url: `${SAPL_BASE}/materia/${materia.id}`,
          comissao_atual: comissaoDestino,
          ultima_tramitacao: {
            data: recentTramits[0]?.data_tramitacao,
            status: recentTramits[0]?.status?.descricao || recentTramits[0]?.status?.sigla,
            texto: recentTramits[0]?.texto,
          },
          pareceres_existentes: pareceresDocs.length,
          tramitacoes_total: tramits.length,
        });

        await new Promise(r => setTimeout(r, ENRICH_DELAY_MS));
      } catch {
        // matéria individual com erro — continuar
      }
    }

    // Ordenar: sem parecer primeiro (mais urgentes), depois por tramitação mais recente
    result.sort((a, b) => {
      if (a.pareceres_existentes !== b.pareceres_existentes) {
        return a.pareceres_existentes - b.pareceres_existentes;
      }
      return (b.ultima_tramitacao.data || '').localeCompare(a.ultima_tramitacao.data || '');
    });

    return NextResponse.json({
      total: result.length,
      filtro_comissao: comissaoFiltro || null,
      filtro_tipos: tiposFiltro,
      pls: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar PLs';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
