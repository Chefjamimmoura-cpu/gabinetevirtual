// =============================================================================
// ALIA RAG — Legal Search
// Specialized search for legal domains with lower threshold, metadata filtering,
// and auto-ingest scaffolding for web→local learning.
//
// Threshold: 0.55 (vs 0.60 default) — legal terms need more recall
// Metadata filters: esfera, tipo_norma, vigente
// Auto-ingest: Phase 6 extension point (scaffold only)
// =============================================================================

import { searchLocal, searchWeb } from '../rag';
import type { TipoNorma, Esfera } from './legal-types';

// ── Tipos exportados ──────────────────────────────────────────────────────────

export interface LegalSearchOpts {
  gabineteId: string;
  dominio?: 'legislacao' | 'jurisprudencia';
  esfera?: Esfera;
  tipo_norma?: TipoNorma;
  vigente?: boolean;
  limit?: number;
  threshold?: number;
}

export interface LegalSearchResult {
  local: Array<{
    artigo: string;
    documento: string;
    texto: string;
    similarity: number;
    metadata: Record<string, unknown>;
  }>;
  web: Array<{
    titulo: string;
    trecho: string;
    fonte: string;
    url?: string;
  }>;
  used_web: boolean;
  max_similarity: number;
}

// ── searchLegal ───────────────────────────────────────────────────────────────

export async function searchLegal(
  query: string,
  opts: LegalSearchOpts,
): Promise<LegalSearchResult> {
  const threshold = opts.threshold ?? 0.55;
  const limit     = opts.limit     ?? 10;
  const dominios  = opts.dominio
    ? [opts.dominio]
    : (['legislacao', 'jurisprudencia'] as const);

  // 1. Busca local no pgvector
  const rawLocal = await searchLocal(query, {
    gabineteId:     opts.gabineteId,
    dominios:       dominios as ('legislacao' | 'jurisprudencia')[],
    matchThreshold: threshold,
    matchCount:     limit,
  });

  // 2. Máxima similaridade encontrada
  const maxSimilarity = rawLocal.length > 0
    ? Math.max(...rawLocal.map(r => r.similarity))
    : 0;

  // 3. Fallback para busca web se confiança baixa
  let webResults: LegalSearchResult['web'] = [];
  const used_web = maxSimilarity < 0.72;

  if (used_web) {
    const webRaw = await searchWeb(query);
    webResults = webRaw.map(w => ({
      titulo: w.titulo,
      trecho: w.trecho,
      fonte:  w.fonte,
      url:    w.url,
    }));
  }

  // 4. Post-filtro por metadados nos resultados locais
  const filtered = rawLocal.filter(r => {
    if (opts.esfera     !== undefined && r.metadata.esfera     !== opts.esfera)     return false;
    if (opts.tipo_norma !== undefined && r.metadata.tipo_norma !== opts.tipo_norma) return false;
    if (opts.vigente    !== undefined && r.metadata.vigente    !== opts.vigente)    return false;
    return true;
  });

  // 5. Mapeia para o formato LegalSearchResult.local
  const local = filtered.map(r => ({
    artigo:     (r.metadata.artigo     as string | undefined) ?? r.source_ref,
    documento:  (r.metadata.documento  as string | undefined) ?? r.source_ref,
    texto:      r.chunk_text,
    similarity: r.similarity,
    metadata:   r.metadata,
  }));

  return { local, web: webResults, used_web, max_similarity: maxSimilarity };
}

// ── autoIngestFromWeb ─────────────────────────────────────────────────────────
// Phase 6 extension point — scaffold only.
// Full implementation requires fetching the full document from the source URL
// and calling ingestFromSource / ingestDocument from legal-ingestor.ts.

export async function autoIngestFromWeb(
  webResults: Array<{ titulo: string; trecho: string; fonte: string; url?: string }>,
  gabineteId: string,
): Promise<number> {
  // TODO (Phase 6): Parse URLs to identify source:
  //   planalto.gov.br  → PlanaltoSource
  //   stf.jus.br       → STFSource
  //   stj.jus.br       → STJSource
  //   lexml.gov.br     → LexMLSource
  // Then fetch the full document and call ingestFromSource(gabineteId, sourceConfig).
  console.log(
    `[RAG/legal] Auto-ingest would process ${webResults.length} web results for gabinete ${gabineteId}`,
  );
  return 0;
}

// ── formatLegalContext ────────────────────────────────────────────────────────

export function formatLegalContext(result: LegalSearchResult): string {
  if (result.local.length === 0 && result.web.length === 0) return '';

  const lines: string[] = ['## Fundamentação legal encontrada'];

  // Seção local
  if (result.local.length > 0) {
    lines.push('\n### Legislação local:');
    for (const item of result.local) {
      const esfera   = (item.metadata.esfera   as string | undefined) ?? '';
      const fonte    = (item.metadata.fonte_url as string | undefined) ?? '';
      const esferaFmt = esfera ? ` (${esfera})` : '';
      const fonteFmt  = fonte  ? `, Fonte: ${fonte}` : '';
      lines.push(
        `- **${item.documento}**, ${item.artigo}${esferaFmt} — ${item.texto}` +
        `\n  _Similarity: ${item.similarity.toFixed(3)}${fonteFmt}_`,
      );
    }
  }

  // Seção web complementar
  if (result.web.length > 0) {
    lines.push('\n### Web (complementar):');
    for (const item of result.web) {
      lines.push(`- **${item.titulo}** (${item.fonte}): ${item.trecho}`);
    }
  }

  return lines.join('\n');
}
