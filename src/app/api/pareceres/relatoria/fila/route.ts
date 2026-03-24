// GET /api/pareceres/relatoria/fila
// Retorna a lista de matérias que estão tramitando em uma comissão específica.
//
// Estratégia de descoberta (3 camadas, em paralelo):
//   1. Cache DB: sapl_materias_cache WHERE tramitacoes_json contém keywords da comissão
//   2. SAPL API live: se commission.sapl_unit_id configurado, busca tramitacoes ao vivo
//   3. Merge e deduplicação por materia.id
//
// Comissões: carregadas do gabinetes.comissoes_config (white-label).
//   Fallback: lista estática COMISSOES_CMBV.
//
// Query params:
//   comissao — sigla da comissão (ex: CASP, CSSMA). Obrigatório.
//   tipo      — filtro de tipo de matéria, separado por vírgula (ex: PL,PLL). Opcional.
//   limit     — máx registros (default 50)
//   offset    — paginação

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { COMISSOES_CMBV } from '@/lib/parecer/prompts-relator';

const GABINETE_ID = process.env.GABINETE_ID!;
const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';

// O SAPL bloqueia requisições sem User-Agent de browser (retorna 503)
const SAPL_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

interface CommissionDynamic {
  sigla: string;
  nome: string;
  area: string;
  criterios?: string;
  keywords: string[];
  sapl_unit_id?: number | null;
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Carrega configuração de comissões do DB; fallback estático se vazio */
async function loadCommissionConfig(db: ReturnType<typeof supabase>): Promise<CommissionDynamic[]> {
  try {
    const { data } = await db
      .from('gabinetes')
      .select('comissoes_config')
      .eq('id', GABINETE_ID)
      .single();

    const cfg = data?.comissoes_config as CommissionDynamic[] | null;
    if (cfg && Array.isArray(cfg) && cfg.length > 0) {
      // Sobrescreve sapl_unit_id com valor da lista estática (unidade de tramitação real).
      // O DB pode ter o ID da comissão (ex: 12) em vez da unidade de tramitação (ex: 93).
      return cfg.map(c => {
        const staticMatch = COMISSOES_CMBV.find(
          sc => sc.sigla.toUpperCase() === (c.sigla || '').toUpperCase(),
        );
        return {
          ...c,
          sapl_unit_id: staticMatch?.sapl_unit_id ?? c.sapl_unit_id ?? null,
        };
      });
    }
  } catch {
    // Fallback
  }
  // Converte lista estática para CommissionDynamic
  // IMPORTANTE: usa c.sapl_unit_id (unidade de tramitação SAPL) — NÃO é o id da comissão
  return COMISSOES_CMBV.map(c => ({
    sigla: c.sigla,
    nome: c.nome,
    area: c.areaExpertise ?? '',
    criterios: c.criteriosAnalise ?? '',
    keywords: c.saplKeywords ?? [],
    sapl_unit_id: c.sapl_unit_id ?? null,
  }));
}

type LiveMateria = { id: number; tipo_sigla: string; numero: number; ano: number; ementa: string; autores: string; status_tramitacao?: string };

/** Enriquece um ID de matéria com dados completos do SAPL */
async function enrichMateria(id: number): Promise<LiveMateria | null> {
  try {
    const mRes = await fetch(`${SAPL_BASE}/api/materia/materialegislativa/${id}/?format=json`, {
      headers: SAPL_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!mRes.ok) return null;
    const m = await mRes.json() as {
      id: number; numero: number; ano: number; ementa?: string;
      tipo?: number | { sigla?: string }; __str__?: string; autores?: string;
    };
    let sigla = typeof m.tipo === 'object' ? (m.tipo?.sigla || '') : '';
    if (!sigla && m.__str__) {
      if (m.__str__.includes('Legislativo')) sigla = 'PLL';
      else if (m.__str__.includes('Complementar')) sigla = 'PLC';
      else if (m.__str__.includes('Decreto Legislativo')) sigla = 'PDL';
      else sigla = 'PL';
    }
    return { id: m.id, tipo_sigla: sigla, numero: m.numero, ano: m.ano, ementa: m.ementa || '', autores: m.autores || '' };
  } catch { return null; }
}

/** Busca matérias ao vivo no SAPL.
 *  Estratégia primária: busca por unidade de tramitação destino (sapl_unit_id).
 *  Fallback: busca 200 tramitações recentes e filtra por sigla/nome da comissão no texto. */
/** Parseia o __str__ da tramitação para extrair tipo/numero/ano como fallback */
function parseTramitacaoStr(str: string): { tipo_sigla: string; numero: number; ano: number } | null {
  // Formato: "Projeto de Lei do Legislativo nº 28 de 2026 | ..."
  const m = str.match(/n[oº°]\s*(\d+)\s*de\s*(\d{4})/i);
  if (!m) return null;
  const numero = parseInt(m[1], 10);
  const ano = parseInt(m[2], 10);
  let tipo_sigla = 'PL';
  const low = str.toLowerCase();
  if (low.includes('decreto legislativo')) tipo_sigla = 'PDL';
  else if (low.includes('lei complementar')) tipo_sigla = 'PLC';
  else if (low.includes('legislativo')) tipo_sigla = 'PLL';
  return { tipo_sigla, numero, ano };
}

async function fetchMateriasSaplLive(commission: CommissionDynamic): Promise<LiveMateria[]> {
  try {
    const materiaIds = new Set<number>();
    // Mapa materia_id → status da última tramitação (para classificar aberto/tramitado)
    const statusMap = new Map<number, string>();
    // Fallback com dados básicos extraídos do __str__ da tramitação (usado se enrichMateria falhar)
    const metaFallback = new Map<number, { tipo_sigla: string; numero: number; ano: number }>();

    // ── Estratégia 1A: busca por unidade de tramitação DESTINO (matérias cujo destino atual é a comissão) ──
    // Filtro de 120 dias: exclui matérias históricas antigas que chegaram à comissão há muito tempo
    // e ainda não foram resolvidas (evita poluir a fila com projetos de meses atrás).
    if (commission.sapl_unit_id) {
      const dataCorte1A = new Date();
      dataCorte1A.setDate(dataCorte1A.getDate() - 120);
      const dataCorte1AStr = dataCorte1A.toISOString().slice(0, 10);

      const urlDestino = `${SAPL_BASE}/api/materia/tramitacao/?unidade_tramitacao_destino=${commission.sapl_unit_id}&data_tramitacao__gte=${dataCorte1AStr}&limit=200&ordering=-data_tramitacao&format=json`;
      const resDestino = await fetch(urlDestino, {
        headers: SAPL_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (resDestino.ok) {
        const json = await resDestino.json() as { results?: { materia?: number; __str__?: string }[] };
        for (const t of (json.results ?? [])) {
          if (t.materia && typeof t.materia === 'number') {
            materiaIds.add(t.materia);
            if (t.__str__) {
              if (!statusMap.has(t.materia)) {
                const parts = t.__str__.split('|').map(s => s.trim());
                statusMap.set(t.materia, parts[1] || 'Em tramitação');
              }
              if (!metaFallback.has(t.materia)) {
                const meta = parseTramitacaoStr(t.__str__);
                if (meta) metaFallback.set(t.materia, meta);
              }
            }
          }
        }
      }

      // ── Estratégia 1B: busca por unidade de tramitação LOCAL/ORIGEM ──
      // Captura matérias que SAÍRAM da comissão para a caixa pessoal de um relator
      // (distribuídas pela presidente). A tramitação registra a comissão como ORIGEM (local).
      // Filtro de 90 dias: evita trazer matérias históricas antigas que também passaram pela comissão.
      const dataCorte = new Date();
      dataCorte.setDate(dataCorte.getDate() - 90);
      const dataCorteStr = dataCorte.toISOString().slice(0, 10); // YYYY-MM-DD

      const urlOrigem = `${SAPL_BASE}/api/materia/tramitacao/?unidade_tramitacao_local=${commission.sapl_unit_id}&data_tramitacao__gte=${dataCorteStr}&limit=200&ordering=-data_tramitacao&format=json`;
      const resOrigem = await fetch(urlOrigem, {
        headers: SAPL_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (resOrigem.ok) {
        const json = await resOrigem.json() as { results?: { materia?: number; __str__?: string; data_tramitacao?: string }[] };
        // Statuses que indicam que a comissão JÁ concluiu a análise — não precisam estar na fila ativa
        const statusConcluidoRegex = /parecer\s+(favor|contrár|aprovad|reprovad)/i;
        // Rastreia primeira ocorrência em 1B (a mais recente) para sobrescrever status de 1A
        const firstOccurrenceInB = new Set<number>();

        for (const t of (json.results ?? [])) {
          if (t.materia && typeof t.materia === 'number') {
            const parts = t.__str__ ? t.__str__.split('|').map(s => s.trim()) : [];
            const statusStr = parts[1] || '';

            // Exclui matérias cuja tramitação mais recente já encerrou a análise pela comissão
            if (statusConcluidoRegex.test(statusStr)) continue;

            if (!materiaIds.has(t.materia)) {
              materiaIds.add(t.materia);
            }
            // 1B é processada após 1A e em ordem decrescente de data.
            // A PRIMEIRA ocorrência de cada matéria em 1B é a mais recente — sempre sobrescreve
            // o status definido por 1A (que captura a chegada à comissão, não a distribuição atual).
            if (!firstOccurrenceInB.has(t.materia)) {
              firstOccurrenceInB.add(t.materia);
              if (statusStr) statusMap.set(t.materia, statusStr);
            }
            if (!metaFallback.has(t.materia) && t.__str__) {
              const meta = parseTramitacaoStr(t.__str__);
              if (meta) metaFallback.set(t.materia, meta);
            }
          }
        }
      }
    }

    // ── Estratégia 2 (fallback): busca por texto de tramitação ──
    if (materiaIds.size === 0) {
      const url = `${SAPL_BASE}/api/materia/tramitacao/?limit=200&ordering=-data_tramitacao&format=json`;
      const res = await fetch(url, {
        headers: SAPL_HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const json = await res.json() as { results?: { materia?: number; __str__?: string; texto?: string }[] };
        const filterKw = [
          commission.sigla.toLowerCase(),
          ...(commission.keywords || []).map(k => k.toLowerCase()),
        ];
        for (const t of (json.results ?? [])) {
          const text = `${t.__str__ || ''} ${t.texto || ''}`.toLowerCase();
          if (filterKw.some(kw => text.includes(kw)) && t.materia && typeof t.materia === 'number') {
            materiaIds.add(t.materia);
            if (!statusMap.has(t.materia) && t.__str__) {
              const parts = t.__str__.split('|').map(s => s.trim());
              statusMap.set(t.materia, parts[1] || 'Em tramitação');
            }
          }
        }
      }
    }

    if (materiaIds.size === 0) return [];

    // ── Enriquece com dados completos (limita a 50 para performance) ──
    const ids = [...materiaIds].slice(0, 50);
    const results = await Promise.allSettled(ids.map(enrichMateria));
    return results
      .map((r, i) => {
        const id = ids[i];
        // Se enrichMateria funcionou, usa os dados completos
        if (r.status === 'fulfilled' && r.value !== null) {
          return { ...r.value, status_tramitacao: statusMap.get(r.value.id) || 'Em tramitação' };
        }
        // Fallback: usa dados básicos do __str__ da tramitação (evita perder a matéria por timeout)
        const meta = metaFallback.get(id);
        if (meta) {
          return { id, ...meta, ementa: '', autores: '', status_tramitacao: statusMap.get(id) || 'Em tramitação' };
        }
        return null;
      })
      .filter((m): m is LiveMateria & { status_tramitacao: string } => m !== null);
  } catch (err) {
    console.error('[fetchMateriasSaplLive] error:', err);
    return [];
  }
}

export async function GET(req: NextRequest) {
  const db = supabase();
  const { searchParams } = new URL(req.url);

  const comissaoSigla = searchParams.get('comissao');
  if (!comissaoSigla) {
    return NextResponse.json({ error: 'Parâmetro "comissao" é obrigatório' }, { status: 400 });
  }

  // Carrega comissões do DB (white-label)
  const allCommissions = await loadCommissionConfig(db);
  const commission = allCommissions.find(c => c.sigla.toLowerCase() === comissaoSigla.toLowerCase());

  if (!commission) {
    return NextResponse.json({
      error: `Comissão "${comissaoSigla}" não encontrada na configuração deste gabinete`,
    }, { status: 400 });
  }

  const keywords = commission.keywords ?? [];
  const tipoFilter = searchParams.get('tipo')?.split(',').map(t => t.trim().toUpperCase()) ?? [];
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '50'), 200);
  const offset = parseInt(searchParams.get('offset') ?? '0');

  try {
    // ── Camada 1: Cache DB com keywords ─────────────────────────────────────
    let cacheQuery = db
      .from('sapl_materias_cache')
      .select('id, tipo_sigla, numero, ano, ementa, autores, tramitacoes_json, last_synced_at', { count: 'exact' })
      .eq('gabinete_id', GABINETE_ID)
      .order('last_synced_at', { ascending: false });

    if (keywords.length > 0) {
      cacheQuery = cacheQuery.or(keywords.map(kw => `tramitacoes_json.ilike.%${kw}%`).join(','));
    }
    if (tipoFilter.length > 0) {
      cacheQuery = cacheQuery.in('tipo_sigla', tipoFilter);
    }
    cacheQuery = cacheQuery.range(offset, offset + limit - 1);

    // ── Camada 2: SAPL live (busca por texto de tramitação, sempre ativa) ───
    const [cacheResult, liveMateriasResult] = await Promise.allSettled([
      cacheQuery,
      fetchMateriasSaplLive(commission),
    ]);

    type CachedMateria = {
      id: number; tipo_sigla: string; numero: number; ano: number;
      ementa: string; autores: string;
      tramitacoes_json: { __str__?: string; data_tramitacao?: string; texto?: string }[] | null;
      last_synced_at: string;
    };

    const cacheData = cacheResult.status === 'fulfilled' ? (cacheResult.value.data ?? []) as CachedMateria[] : [];
    const cacheCount = cacheResult.status === 'fulfilled' ? (cacheResult.value.count ?? 0) : 0;
    const liveMaterias: LiveMateria[] = liveMateriasResult.status === 'fulfilled' ? liveMateriasResult.value : [];

    // ── Merge: cache + live (dedup por id) ───────────────────────────────────
    const cacheIdSet = new Set(cacheData.map(m => m.id));
    const liveOnlyMaterias = liveMaterias.filter(m => !cacheIdSet.has(m.id));

    // Constroi resultado unificado
    type TramitacaoRaw = { __str__?: string; data_tramitacao?: string; texto?: string };

    // Mapa de status das matérias live — usado para enriquecer itens do cache
    const liveStatusMap = new Map<number, string>();
    for (const m of liveMaterias) {
      if (m.status_tramitacao) liveStatusMap.set(m.id, m.status_tramitacao);
    }

    const formatCacheItem = (m: CachedMateria) => {
      const tramits: TramitacaoRaw[] = Array.isArray(m.tramitacoes_json) ? m.tramitacoes_json : [];
      const ultimaRelev = [...tramits].reverse().find(t => {
        const txt = (t.__str__ || t.texto || '').toLowerCase();
        return keywords.some(kw => txt.includes(kw.toLowerCase()));
      });
      const ultima = ultimaRelev || tramits[tramits.length - 1] || null;
      return {
        id: m.id, tipo_sigla: m.tipo_sigla, numero: m.numero, ano: m.ano,
        ementa: m.ementa || '', autores: m.autores || '',
        ultima_tramitacao: ultima?.__str__ || ultima?.texto || '',
        data_tramitacao: ultima?.data_tramitacao || '',
        status_tramitacao: liveStatusMap.get(m.id) || 'Em tramitação',
        sapl_url: `${SAPL_BASE}/materia/${m.id}`,
        source: 'cache' as const,
      };
    };

    const formatLiveItem = (m: LiveMateria) => ({
      id: m.id, tipo_sigla: m.tipo_sigla, numero: m.numero, ano: m.ano,
      ementa: m.ementa || '', autores: m.autores || '',
      ultima_tramitacao: m.status_tramitacao || '', data_tramitacao: '',
      status_tramitacao: m.status_tramitacao || 'Em tramitação',
      sapl_url: `${SAPL_BASE}/materia/${m.id}`,
      source: 'sapl_live' as const,
    });

    const mergedItems = [
      ...cacheData.map(formatCacheItem),
      ...liveOnlyMaterias.map(formatLiveItem),
    ];

    if (mergedItems.length === 0) {
      return NextResponse.json({
        comissao: comissaoSigla,
        commission_nome: commission.nome,
        materias: [],
        total: 0,
        sapl_live: liveMaterias.length > 0,
      });
    }

    // ── Busca rascunhos já gerados ───────────────────────────────────────────
    const materiaIds = mergedItems.map(m => m.id);
    const { data: rascunhos } = await db
      .from('pareceres_relator')
      .select('materia_id, voto, created_at')
      .eq('gabinete_id', GABINETE_ID)
      .eq('commission_sigla', comissaoSigla)
      .in('materia_id', materiaIds)
      .order('created_at', { ascending: false });

    const rascunhoMap = new Map<number, { voto: string; created_at: string }>();
    for (const r of (rascunhos ?? [])) {
      if (!rascunhoMap.has(r.materia_id)) {
        rascunhoMap.set(r.materia_id, { voto: r.voto, created_at: r.created_at });
      }
    }

    // ── Formata resultado ────────────────────────────────────────────────────
    const result = mergedItems.map(m => {
      const rascunho = rascunhoMap.get(m.id);
      return {
        ...m,
        status_relatoria: rascunho ? 'rascunho_gerado' : 'sem_rascunho',
        rascunho_voto: rascunho?.voto ?? null,
        rascunho_em: rascunho?.created_at ?? null,
      };
    });

    return NextResponse.json({
      comissao: comissaoSigla,
      commission_nome: commission.nome,
      materias: result,
      total: cacheCount + liveOnlyMaterias.length,
      offset,
      limit,
      sapl_live: liveMaterias.length > 0,
    });
  } catch (error) {
    console.error('[GET /api/pareceres/relatoria/fila]', error);
    return NextResponse.json({ error: 'Falha ao buscar fila de relatoria' }, { status: 500 });
  }
}
