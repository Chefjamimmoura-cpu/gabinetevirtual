-- Migration: cadin_pdf_cache
-- Armazena PDFs gerados do CADIN para evitar reprocessamento

CREATE TABLE IF NOT EXISTS cadin_pdf_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  filter_hash TEXT NOT NULL UNIQUE,
  sphere TEXT,
  org_type TEXT,
  cargo TEXT,
  label TEXT,
  authority_count INT NOT NULL DEFAULT 0,
  pdf_storage_path TEXT NOT NULL,
  pdf_public_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours')
);

CREATE INDEX idx_pdf_cache_hash ON cadin_pdf_cache(filter_hash);
CREATE INDEX idx_pdf_cache_expires ON cadin_pdf_cache(expires_at);
