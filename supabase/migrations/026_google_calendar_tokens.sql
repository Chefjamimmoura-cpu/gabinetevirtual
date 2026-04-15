-- ═══════════════════════════════════════════════════════════════
-- Migration 026 — Google Calendar OAuth2 Tokens
-- Tokens OAuth2 das contas Google vinculadas ao gabinete
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gabinete_id     UUID NOT NULL REFERENCES gabinetes(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  access_token    TEXT,
  refresh_token   TEXT NOT NULL,
  expires_at      TIMESTAMPTZ,
  calendar_id     TEXT NOT NULL DEFAULT 'primary',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(gabinete_id, email)
);

ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso restrito ao próprio gabinete"
  ON google_calendar_tokens FOR ALL
  USING (gabinete_id = current_setting('app.gabinete_id')::UUID);

-- Colunas para rastreamento de origem no sync bidirecional
ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS google_event_id    TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS sync_source        TEXT CHECK (sync_source IN ('gv', 'gcal', 'sapl'));

-- Índice único: evita duplicatas no upsert por google_event_id
CREATE UNIQUE INDEX IF NOT EXISTS eventos_google_event_id_idx
  ON eventos(gabinete_id, google_event_id)
  WHERE google_event_id IS NOT NULL;
