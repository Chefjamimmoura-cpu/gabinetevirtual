// =============================================================================
// ALIA Memory — Persistent Episodic Memory with Semantic Search
//
// Tabela:  alia_memory (Supabase + pgvector)
// RPCs:    match_memory, decay_memories
// Embed:   gemini-embedding-001 via embedText (rag.ts)
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { TaskType } from '@google/generative-ai';
import { embedText } from './rag';
import type { AliaMemory, MemoryType, RememberOptions } from './types';

// ── Singleton DB ──────────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── remember ──────────────────────────────────────────────────────────────────
// Salva ou atualiza uma memória. Upsert por (gabinete_id, tipo, subject).

export async function remember(
  gabineteId: string,
  tipo: MemoryType,
  subject: string,
  content: string,
  opts?: RememberOptions,
): Promise<AliaMemory | null> {
  try {
    const embedding = await embedText(content, TaskType.RETRIEVAL_DOCUMENT);
    const now = new Date().toISOString();

    const row = {
      gabinete_id:      gabineteId,
      tipo,
      subject,
      content,
      embedding,
      confidence:       opts?.confidence ?? 1.0,
      source_module:    opts?.sourceModule ?? null,
      source_ref:       opts?.sourceRef ?? null,
      expires_at:       opts?.expiresAt ?? null,
      last_accessed_at: now,
      updated_at:       now,
    };

    const { data, error } = await db()
      .from('alia_memory')
      .upsert(row, { onConflict: 'gabinete_id,tipo,subject' })
      .select()
      .single();

    if (error) {
      console.error('[Memory] remember error:', error.message);
      return null;
    }
    return data as AliaMemory;
  } catch (err) {
    console.error('[Memory] remember exception:', err);
    return null;
  }
}

// ── recall ────────────────────────────────────────────────────────────────────
// Busca semântica via RPC match_memory (pgvector).

export async function recall(
  gabineteId: string,
  query: string,
  opts?: {
    matchThreshold?: number;
    matchCount?: number;
    tipos?: MemoryType[];
  },
): Promise<AliaMemory[]> {
  try {
    const embedding = await embedText(query, TaskType.RETRIEVAL_QUERY);

    const { data, error } = await db().rpc('match_memory', {
      query_embedding:  embedding,
      p_gabinete_id:    gabineteId,
      match_threshold:  opts?.matchThreshold ?? 0.60,
      match_count:      opts?.matchCount ?? 8,
      p_tipos:          opts?.tipos ?? null,
    });

    if (error) {
      console.error('[Memory] recall RPC error:', error.message);
      return [];
    }

    const memories = (data ?? []) as AliaMemory[];

    // fire-and-forget: atualiza last_accessed_at nas memórias retornadas
    if (memories.length > 0) {
      const ids = memories.map((m) => m.id);
      db()
        .from('alia_memory')
        .update({ last_accessed_at: new Date().toISOString() })
        .in('id', ids)
        .then(({ error: e }) => {
          if (e) console.warn('[Memory] last_accessed_at update failed:', e.message);
        });
    }

    return memories;
  } catch (err) {
    console.error('[Memory] recall exception:', err);
    return [];
  }
}

// ── recallBySubject ───────────────────────────────────────────────────────────
// Busca exata por subject (match direto, sem vetor).

export async function recallBySubject(
  gabineteId: string,
  subject: string,
): Promise<AliaMemory[]> {
  try {
    const { data, error } = await db()
      .from('alia_memory')
      .select('*')
      .eq('gabinete_id', gabineteId)
      .eq('subject', subject)
      .gt('confidence', 0)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[Memory] recallBySubject error:', error.message);
      return [];
    }
    return (data ?? []) as AliaMemory[];
  } catch (err) {
    console.error('[Memory] recallBySubject exception:', err);
    return [];
  }
}

// ── forget ────────────────────────────────────────────────────────────────────
// Soft-delete: zera a confidence para que a memória não seja mais retornada.

export async function forget(
  gabineteId: string,
  memoryId: string,
): Promise<boolean> {
  try {
    const { error } = await db()
      .from('alia_memory')
      .update({ confidence: 0, updated_at: new Date().toISOString() })
      .eq('id', memoryId)
      .eq('gabinete_id', gabineteId);

    if (error) {
      console.error('[Memory] forget error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Memory] forget exception:', err);
    return false;
  }
}

// ── reinforce ─────────────────────────────────────────────────────────────────
// Eleva a confidence da memória para 1.0 (reforço positivo).

export async function reinforce(memoryId: string): Promise<boolean> {
  try {
    const { error } = await db()
      .from('alia_memory')
      .update({ confidence: 1.0, updated_at: new Date().toISOString() })
      .eq('id', memoryId);

    if (error) {
      console.error('[Memory] reinforce error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Memory] reinforce exception:', err);
    return false;
  }
}

// ── decay ─────────────────────────────────────────────────────────────────────
// Dispara o RPC decay_memories para reduzir gradualmente a confidence de
// memórias antigas e expiradas do gabinete.

export async function decay(gabineteId: string): Promise<boolean> {
  try {
    const { error } = await db().rpc('decay_memories', {
      p_gabinete_id: gabineteId,
    });

    if (error) {
      console.error('[Memory] decay RPC error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Memory] decay exception:', err);
    return false;
  }
}

// ── formatMemoryContext ───────────────────────────────────────────────────────
// Formata lista de memórias em seções markdown para injeção no prompt do Gemini.

const TIPO_LABEL: Record<MemoryType, string> = {
  preference: 'Preferências conhecidas',
  decision:   'Decisões anteriores',
  relation:   'Histórico relacional',
  pattern:    'Padrões aprendidos',
};

const TIPO_ORDER: MemoryType[] = ['preference', 'decision', 'relation', 'pattern'];

export function formatMemoryContext(memories: AliaMemory[]): string {
  if (memories.length === 0) return '';

  // Agrupa por tipo
  const byTipo = new Map<MemoryType, AliaMemory[]>();
  for (const m of memories) {
    if (m.confidence <= 0) continue; // ignora soft-deletadas
    const list = byTipo.get(m.tipo) ?? [];
    list.push(m);
    byTipo.set(m.tipo, list);
  }

  if (byTipo.size === 0) return '';

  const sections: string[] = ['### MEMÓRIA CONTEXTUAL DA ALIA\n'];

  for (const tipo of TIPO_ORDER) {
    const list = byTipo.get(tipo);
    if (!list || list.length === 0) continue;

    const label = TIPO_LABEL[tipo];
    const items = list
      .map((m) => `- **${m.subject}**: ${m.content}`)
      .join('\n');

    sections.push(`#### ${label}\n${items}`);
  }

  return sections.join('\n\n');
}
