// src/lib/alia/rag/legal-ingestor.ts
// =============================================================================
// ALIA RAG — Legal Ingestion Pipeline
//
// Orchestrates: fetch from LegalSource → chunk → embed → upsert to pgvector
// =============================================================================

import type { LegalDocument, LegalChunk } from './legal-types';
import { chunkLegalDocument, chunkSumula } from './legal-chunker';
import type { LegalSource } from './sources/source.interface';
import { upsertKnowledge } from '../rag';
import type { KnowledgeChunk, Dominio } from '../rag';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IngestResult {
  source: string;
  documents_fetched: number;
  chunks_created: number;
  chunks_upserted: number;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const JURISPRUDENCIA_TIPOS = new Set([
  'sumula',
  'sumula_vinculante',
  'acordao',
  'tema_repetitivo',
]);

function resolveDominio(chunk: LegalChunk): Dominio {
  return JURISPRUDENCIA_TIPOS.has(chunk.tipo_norma) ? 'jurisprudencia' : 'legislacao';
}

function toKnowledgeChunk(doc: LegalDocument, chunk: LegalChunk): KnowledgeChunk {
  return {
    dominio: resolveDominio(chunk),
    source_ref: `${chunk.documento}_${chunk.artigo}`,
    chunk_text: chunk.texto,
    metadata: {
      tipo_norma:           chunk.tipo_norma,
      esfera:               chunk.esfera,
      artigo:               chunk.artigo,
      dispositivo_completo: chunk.dispositivo_completo,
      hierarquia:           chunk.hierarquia,
      tema_principal:       chunk.tema_principal,
      tribunal:             chunk.tribunal,
      fonte_url:            chunk.fonte_url,
      vigente:              chunk.vigente,
    },
  };
}

function chunkDocument(doc: LegalDocument): LegalChunk[] {
  if (
    doc.tipo_norma === 'sumula' ||
    doc.tipo_norma === 'sumula_vinculante'
  ) {
    return [chunkSumula(doc)];
  }
  return chunkLegalDocument(doc);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches all documents from a LegalSource matching `theme`, chunks them,
 * embeds, and upserts to the pgvector knowledge base.
 */
export async function ingestFromSource(
  source: LegalSource,
  theme: string,
  gabineteId: string,
  opts?: { limit?: number; since?: Date },
): Promise<IngestResult> {
  const result: IngestResult = {
    source: source.name,
    documents_fetched: 0,
    chunks_created: 0,
    chunks_upserted: 0,
    errors: [],
  };

  // 1. Fetch documents
  let docs: LegalDocument[];
  try {
    docs = await source.fetchByTheme(theme, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`[fetch] ${msg}`);
    console.error(`[legal-ingestor] fetch error (${source.name}):`, err);
    return result;
  }

  result.documents_fetched = docs.length;

  // 2. Skip if empty
  if (docs.length === 0) return result;

  // 3. Chunk all documents, isolating per-document errors
  const allKnowledgeChunks: KnowledgeChunk[] = [];

  for (const doc of docs) {
    try {
      const legalChunks = chunkDocument(doc);
      const knowledgeChunks = legalChunks.map(c => toKnowledgeChunk(doc, c));
      allKnowledgeChunks.push(...knowledgeChunks);
      result.chunks_created += knowledgeChunks.length;
    } catch (err) {
      const label = `${doc.tipo_norma} ${doc.numero}/${doc.ano}`;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`[chunk:${label}] ${msg}`);
      console.error(`[legal-ingestor] chunk error (${label}):`, err);
    }
  }

  if (allKnowledgeChunks.length === 0) return result;

  // 4. Batch upsert to pgvector
  try {
    const { ok } = await upsertKnowledge(allKnowledgeChunks, gabineteId);
    result.chunks_upserted = ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`[upsert] ${msg}`);
    console.error('[legal-ingestor] upsert error:', err);
  }

  return result;
}

/**
 * Processes a single LegalDocument — used by auto-ingest from web search.
 */
export async function ingestDocument(
  doc: LegalDocument,
  gabineteId: string,
): Promise<{ chunks: number; upserted: number }> {
  const legalChunks = chunkDocument(doc);
  const knowledgeChunks = legalChunks.map(c => toKnowledgeChunk(doc, c));

  if (knowledgeChunks.length === 0) return { chunks: 0, upserted: 0 };

  const { ok } = await upsertKnowledge(knowledgeChunks, gabineteId);
  return { chunks: knowledgeChunks.length, upserted: ok };
}
