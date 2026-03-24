-- =============================================================================
-- V3: RAG & ALIA Knowledge Base (Fase 2)
-- Migration: 007_rag_knowledge
-- Data: 2026-03-13
--
-- Cria a tabela de vetores de conhecimento e a função de busca por similaridade.
-- O pgvector será usado no formato HNSW para alta performance de recall.
-- =============================================================================

-- ── cadin_knowledge_vectors ──────────────────────────────────────────────
create table if not exists cadin_knowledge_vectors (
  id              uuid primary key default gen_random_uuid(),
  gabinete_id     uuid references gabinetes(id) on delete cascade,
  source_type     text not null,               -- Ex: 'sumula_stf', 'jurisprudencia', 'regimento_interno', 'tce_rr'
  source_ref      text,                        -- Ex: 'Súmula Vinculante 13', 'Art. 45'
  chunk_text      text not null,               -- O fragmento de texto puro
  embedding       vector(768),                 -- Usaremos 768 dims (gemini-embedding defaults to 768 w/ param or text-embedding-004)
  metadata        jsonb default '{}'::jsonb,   -- Tags adicionais, URLs, metadados extras
  created_at      timestamptz not null default now()
);

-- Indexação avançada HNSW usando distância do co-seno
create index if not exists cadin_knowledge_embedding_idx
  on cadin_knowledge_vectors
  using hnsw (embedding vector_cosine_ops);

-- Indexação tradicional para queries baseadas no tipo de documento
create index if not exists cadin_knowledge_source_idx
  on cadin_knowledge_vectors (gabinete_id, source_type);

-- ── RLS Policies ─────────────────────────────────────────────────────────
alter table cadin_knowledge_vectors enable row level security;

create policy "cadin_knowledge_vectors_select" on cadin_knowledge_vectors for select
  using (gabinete_id = my_gabinete_id() or gabinete_id is null);

create policy "cadin_knowledge_vectors_modify" on cadin_knowledge_vectors for all
  using (gabinete_id = my_gabinete_id());

-- ── RPC: match_documents (Busca Híbrida/Semântica) ────────────────────
-- Função para buscar documentos relevantes comparando o embedding da query
-- com o embedding armazenado, retornando junto pontuação de similaridade.
create or replace function match_documents (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_gabinete_id uuid default null,
  p_source_type text default null
)
returns table (
  id uuid,
  source_type text,
  source_ref text,
  chunk_text text,
  metadata jsonb,
  similarity float
)
language plpgsql
stable
as $$
begin
  return query
  select
    v.id,
    v.source_type,
    v.source_ref,
    v.chunk_text,
    v.metadata,
    1 - (v.embedding <=> query_embedding) as similarity -- Cosine Similarity
  from cadin_knowledge_vectors v
  where 1 - (v.embedding <=> query_embedding) > match_threshold
    and (v.gabinete_id = p_gabinete_id or v.gabinete_id is null)
    and (p_source_type is null or v.source_type = p_source_type)
  order by v.embedding <=> query_embedding
  limit match_count;
end;
$$;
