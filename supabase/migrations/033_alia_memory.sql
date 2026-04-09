-- 033_alia_memory.sql
-- Persistent memory for ALIA Core Engine.
-- 4 types: preference, decision, relation, pattern
-- Uses pgvector for semantic recall + confidence decay.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alia_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('preference','decision','relation','pattern')),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source_module TEXT,
  source_ref TEXT,
  embedding VECTOR(768),
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_alia_memory_gabinete ON alia_memory(gabinete_id);
CREATE INDEX idx_alia_memory_tipo ON alia_memory(gabinete_id, tipo);
CREATE INDEX idx_alia_memory_subject ON alia_memory(gabinete_id, subject);
CREATE INDEX idx_alia_memory_confidence ON alia_memory(gabinete_id, confidence)
  WHERE confidence > 0.2;

CREATE INDEX idx_alia_memory_embedding ON alia_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── RPC: match_memory (semantic search) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION match_memory(
  query_embedding VECTOR(768),
  p_gabinete_id UUID,
  match_threshold FLOAT DEFAULT 0.50,
  match_count INT DEFAULT 10,
  p_tipos TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  gabinete_id UUID,
  tipo TEXT,
  subject TEXT,
  content TEXT,
  confidence FLOAT,
  source_module TEXT,
  source_ref TEXT,
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.gabinete_id, m.tipo, m.subject, m.content,
    m.confidence, m.source_module, m.source_ref,
    m.expires_at, m.last_accessed_at, m.created_at, m.updated_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM alia_memory m
  WHERE m.gabinete_id = p_gabinete_id
    AND m.confidence > 0.2
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND (p_tipos IS NULL OR m.tipo = ANY(p_tipos))
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ── RPC: decay_memories (called by daily cron) ───────────────────────────────

CREATE OR REPLACE FUNCTION decay_memories(
  p_gabinete_id UUID,
  decay_rate FLOAT DEFAULT 0.02
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE alia_memory
  SET
    confidence = GREATEST(confidence - decay_rate, 0),
    updated_at = now()
  WHERE gabinete_id = p_gabinete_id
    AND tipo != 'preference'
    AND last_accessed_at < now() - INTERVAL '7 days'
    AND confidence > 0.2;

  GET DIAGNOSTICS affected = ROW_COUNT;

  UPDATE alia_memory
  SET confidence = 0, updated_at = now()
  WHERE gabinete_id = p_gabinete_id
    AND confidence > 0 AND confidence <= 0.2;

  RETURN affected;
END;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE alia_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on alia_memory"
  ON alia_memory FOR ALL
  USING (true)
  WITH CHECK (true);
