-- 036_cadin_sentinel.sql
-- CADIN Sentinel: monitors Diários Oficiais for authority changes.
-- CADIN Ingestor: bulk import from PDF/DOCX documents.

-- ── Sentinel logs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cadin_sentinel_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  source TEXT NOT NULL,
  date_checked DATE NOT NULL,
  entries_found INT DEFAULT 0,
  changes_detected INT DEFAULT 0,
  new_suggestions INT DEFAULT 0,
  raw_log JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sentinel_logs_gabinete ON cadin_sentinel_logs(gabinete_id);
CREATE INDEX idx_sentinel_logs_date ON cadin_sentinel_logs(gabinete_id, date_checked);

-- ── Pending updates (curadoria queue) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cadin_pending_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  person_id UUID,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nomeacao','exoneracao','posse','substituicao',
    'aposentadoria','novo_cadastro','importacao_novo',
    'importacao_atualiza','importacao_ambiguo'
  )),
  campo TEXT,
  valor_atual TEXT,
  valor_novo TEXT,
  fonte TEXT NOT NULL,
  fonte_url TEXT,
  fonte_data DATE NOT NULL,
  trecho_original TEXT NOT NULL,
  confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT DEFAULT 'pendente' CHECK (status IN (
    'pendente','aprovado','rejeitado','editado'
  )),
  revisado_por UUID,
  revisado_em TIMESTAMPTZ,
  notas_revisao TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pending_updates_gabinete ON cadin_pending_updates(gabinete_id);
CREATE INDEX idx_pending_updates_status ON cadin_pending_updates(gabinete_id, status);
CREATE INDEX idx_pending_updates_person ON cadin_pending_updates(person_id);

-- ── Ingest jobs (bulk PDF/DOCX import) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS cadin_ingest_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  esfera TEXT,
  status TEXT DEFAULT 'processando' CHECK (status IN (
    'processando','concluido','erro','parcial'
  )),
  total_pages INT,
  pages_processed INT DEFAULT 0,
  records_found INT DEFAULT 0,
  records_new INT DEFAULT 0,
  records_update INT DEFAULT 0,
  records_ambiguous INT DEFAULT 0,
  error_log TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_ingest_jobs_gabinete ON cadin_ingest_jobs(gabinete_id);
CREATE INDEX idx_ingest_jobs_status ON cadin_ingest_jobs(gabinete_id, status);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE cadin_sentinel_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadin_pending_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadin_ingest_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on cadin_sentinel_logs"
  ON cadin_sentinel_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on cadin_pending_updates"
  ON cadin_pending_updates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on cadin_ingest_jobs"
  ON cadin_ingest_jobs FOR ALL USING (true) WITH CHECK (true);
