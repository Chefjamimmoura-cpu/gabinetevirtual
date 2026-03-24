// =============================================================================
// ALIA RAG — Core Library
// Embed · Search (pgvector) · Upsert · Hybrid Search · Format
//
// Modelo: gemini-embedding-001 (768 dims, Gemini, essencialmente gratuito)
// Banco:  Supabase PostgreSQL + pgvector via RPC match_knowledge
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type Dominio =
  | 'legislacao'
  | 'cadin'
  | 'sapl'
  | 'redacao'
  | 'indicacoes'
  | 'jurisprudencia';

export interface KnowledgeChunk {
  dominio: Dominio;
  source_ref: string;
  chunk_text: string;
  metadata?: Record<string, unknown>;
  validade_em?: string; // ISO date string 'YYYY-MM-DD'
}

export interface KnowledgeResult {
  id: string;
  dominio: Dominio;
  source_ref: string;
  chunk_text: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface HybridSearchResult {
  local: KnowledgeResult[];    // chunks do pgvector
  web:   WebSearchResult[];    // resultados da busca web (quando necessário)
  usedWeb: boolean;            // true se a busca web foi ativada
}

export interface WebSearchResult {
  titulo:  string;
  trecho:  string;
  fonte:   string;
  url?:    string;
}

// ── Singletons ────────────────────────────────────────────────────────────────

let _genAI: GoogleGenerativeAI | null = null;
function genAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return _genAI;
}

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Embedding ─────────────────────────────────────────────────────────────────

export async function embedText(
  text: string,
  taskType: TaskType = TaskType.RETRIEVAL_QUERY,
): Promise<number[]> {
  const model = genAI().getGenerativeModel({ model: 'gemini-embedding-001' });
  // gemini-embedding-001 padrão = 3072 dims; outputDimensionality reduz para 768 (compatível com pgvector)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req: any = {
    content: { role: 'user', parts: [{ text: text.slice(0, 3000) }] },
    taskType,
    outputDimensionality: 768,
  };
  const result = await model.embedContent(req);
  return result.embedding.values;
}

// ── Busca semântica local (pgvector) ──────────────────────────────────────────

export async function searchLocal(
  query: string,
  options: {
    gabineteId: string;
    dominios?: Dominio[];
    matchThreshold?: number;
    matchCount?: number;
  },
): Promise<KnowledgeResult[]> {
  try {
    const embedding = await embedText(query, TaskType.RETRIEVAL_QUERY);
    const { data, error } = await db().rpc('match_knowledge', {
      query_embedding:  embedding,
      p_gabinete_id:    options.gabineteId,
      match_threshold:  options.matchThreshold ?? 0.60,
      match_count:      options.matchCount ?? 6,
      p_dominios:       options.dominios ?? null,
    });
    if (error) throw error;
    return (data ?? []) as KnowledgeResult[];
  } catch (err) {
    console.error('[RAG] searchLocal error:', err);
    return [];
  }
}

// ── Busca web via Gemini Google Search Grounding ──────────────────────────────
// Ativada apenas quando RAG local não tem resultados suficientes.
// Usa o grounding nativo do Gemini — custo: ~US$0.001/query, fontes verificadas.

export async function searchWeb(query: string): Promise<WebSearchResult[]> {
  try {
    const model = genAI().getGenerativeModel({
      model: 'gemini-2.5-flash',
      // @ts-expect-error — googleSearch é suportado mas não tipado no SDK atual
      tools: [{ googleSearch: {} }],
    });

    const prompt = `Pesquise informações sobre: "${query}"

Retorne em JSON com o seguinte formato (sem markdown, apenas JSON puro):
{
  "resultados": [
    {
      "titulo": "título do resultado",
      "trecho": "trecho relevante com a informação",
      "fonte": "nome da fonte (STF, LexML, Gov.br, etc.)"
    }
  ]
}

Priorize fontes oficiais: STF, STJ, TJRR, LexML, Câmara Federal, Senado, Gov.br, Jusbrasil.
Limite a 3 resultados mais relevantes.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Extrai JSON da resposta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as { resultados?: WebSearchResult[] };
    return parsed.resultados ?? [];
  } catch (err) {
    console.error('[RAG] searchWeb error:', err);
    return [];
  }
}

// ── Busca híbrida (RAG local → web se necessário) ─────────────────────────────
//
// Lógica de prioridade:
// 1. Busca no pgvector com threshold 0.60
// 2. Se encontrou resultados com similarity >= 0.72: usa só RAG (alta confiança)
// 3. Se encontrou resultados com 0.60 ≤ sim < 0.72: usa RAG + complementa com web
// 4. Se não encontrou nada (ou todos < 0.60): usa web search puro
//
// Isso garante: RAG prevalece quando a informação está na base local.

export async function searchHybrid(
  query: string,
  options: {
    gabineteId: string;
    dominios?: Dominio[];
  },
): Promise<HybridSearchResult> {
  const local = await searchLocal(query, {
    gabineteId: options.gabineteId,
    dominios:   options.dominios,
    matchThreshold: 0.60,
    matchCount: 6,
  });

  const maxSimilarity = local.length > 0
    ? Math.max(...local.map(r => r.similarity))
    : 0;

  // Alta confiança no RAG local — não precisa de web
  if (maxSimilarity >= 0.72) {
    return { local, web: [], usedWeb: false };
  }

  // Baixa confiança ou sem resultados — complementa com web
  const web = await searchWeb(query);
  return { local, web, usedWeb: true };
}

// ── Upsert em lote ────────────────────────────────────────────────────────────

export async function upsertKnowledge(
  chunks: KnowledgeChunk[],
  gabineteId: string,
): Promise<{ ok: number; err: number }> {
  let ok = 0;
  let err = 0;
  const BATCH = 8;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    await Promise.all(batch.map(async (c) => {
      try {
        const embedding = await embedText(c.chunk_text, TaskType.RETRIEVAL_DOCUMENT);
        const { error } = await db().from('alia_knowledge').upsert({
          gabinete_id: gabineteId,
          dominio:     c.dominio,
          source_ref:  c.source_ref,
          chunk_text:  c.chunk_text,
          embedding,
          metadata:    c.metadata ?? {},
          validade_em: c.validade_em ?? null,
          updated_at:  new Date().toISOString(),
        }, { onConflict: 'gabinete_id,dominio,source_ref' });
        if (error) { console.error('[RAG] upsert:', error.message); err++; }
        else ok++;
      } catch (e) { console.error('[RAG] embed/upsert:', e); err++; }
    }));
    if (i + BATCH < chunks.length) await sleep(400);
  }
  return { ok, err };
}

// ── Formatação do contexto para o Gemini ─────────────────────────────────────

const DOMINIO_LABEL: Record<string, string> = {
  legislacao:     '⚖️ Legislação',
  cadin:          '👤 Autoridade',
  sapl:           '🏛️ SAPL',
  redacao:        '📝 Redação Oficial',
  indicacoes:     '📌 Indicações',
  jurisprudencia: '🔍 Jurisprudência',
};

export function formatRagContext(result: HybridSearchResult): string {
  const sections: string[] = [];

  if (result.local.length > 0) {
    const localBlocks = result.local.map((r, i) => {
      const label = DOMINIO_LABEL[r.dominio] ?? r.dominio;
      const conf  = r.similarity >= 0.80 ? '🟢' : r.similarity >= 0.65 ? '🟡' : '🟠';
      return `${conf} **[${i + 1}] ${label} — ${r.source_ref}**\n${r.chunk_text}`;
    });
    sections.push(`### BASE DE CONHECIMENTO DO GABINETE\n\n${localBlocks.join('\n\n---\n\n')}`);
  }

  if (result.web.length > 0) {
    const webBlocks = result.web.map((w, i) => {
      const num = (result.local.length + i + 1);
      return `🌐 **[${num}] ${w.titulo}** *(${w.fonte})*\n${w.trecho}`;
    });
    sections.push(`### BUSCA WEB (complementar)\n\n${webBlocks.join('\n\n---\n\n')}`);
  }

  return sections.join('\n\n');
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
