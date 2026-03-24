-- =============================================================================
-- Migration 022 — ALIA Knowledge Base (RAG)
-- Base de conhecimento vetorial para RAG híbrido da ALIA.
-- Domínios: legislacao | cadin | sapl | redacao | indicacoes | jurisprudencia
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Tabela principal ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alia_knowledge (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id  UUID        REFERENCES gabinetes(id) ON DELETE CASCADE,
  dominio      TEXT        NOT NULL CHECK (dominio IN (
                             'legislacao','cadin','sapl',
                             'redacao','indicacoes','jurisprudencia')),
  source_ref   TEXT        NOT NULL,   -- chave semântica única por chunk
  chunk_text   TEXT        NOT NULL,   -- texto usado para embedding e exibição
  embedding    vector(768),            -- text-embedding-004 (768 dims)
  metadata     JSONB       NOT NULL DEFAULT '{}',
  validade_em  DATE,                   -- NULL = permanente
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alia_knowledge_unique UNIQUE (gabinete_id, dominio, source_ref)
);

-- ── Índices ───────────────────────────────────────────────────────────────────
-- HNSW: melhor recall para coleções < 100k chunks (sem necessidade de treino)
CREATE INDEX IF NOT EXISTS alia_knowledge_hnsw
  ON alia_knowledge USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS alia_knowledge_dominio_idx
  ON alia_knowledge (gabinete_id, dominio);

CREATE INDEX IF NOT EXISTS alia_knowledge_validade_idx
  ON alia_knowledge (validade_em) WHERE validade_em IS NOT NULL;

-- ── Trigger updated_at ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_alia_knowledge()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_alia_knowledge ON alia_knowledge;
CREATE TRIGGER trg_alia_knowledge
  BEFORE UPDATE ON alia_knowledge
  FOR EACH ROW EXECUTE FUNCTION touch_alia_knowledge();

-- ── RPC: match_knowledge ──────────────────────────────────────────────────────
-- Busca semântica por cosseno. Retorna chunks ordenados por similaridade.
-- p_dominios NULL = busca em todos os domínios (fallback)
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding vector(768),
  p_gabinete_id   UUID,
  match_threshold FLOAT   DEFAULT 0.60,
  match_count     INT     DEFAULT 6,
  p_dominios      TEXT[]  DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  dominio     TEXT,
  source_ref  TEXT,
  chunk_text  TEXT,
  metadata    JSONB,
  similarity  FLOAT
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    k.id, k.dominio, k.source_ref, k.chunk_text, k.metadata,
    1 - (k.embedding <=> query_embedding) AS similarity
  FROM alia_knowledge k
  WHERE
    k.gabinete_id = p_gabinete_id
    AND (k.validade_em IS NULL OR k.validade_em > CURRENT_DATE)
    AND 1 - (k.embedding <=> query_embedding) > match_threshold
    AND (p_dominios IS NULL OR k.dominio = ANY(p_dominios))
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
END; $$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE alia_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alia_knowledge_service_role"
  ON alia_knowledge FOR ALL
  TO service_role USING (true);
