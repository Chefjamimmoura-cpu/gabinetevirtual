-- ══════════════════════════════════════════════════════════════
-- 028 — Sessões Transcritas (Módulo Transcrição Plenária)
-- Armazena transcrições de sessões da CMBV (upload, YouTube, gravação)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sessoes_transcritas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id         UUID REFERENCES gabinetes(id) ON DELETE CASCADE,
  titulo              TEXT NOT NULL,
  data_sessao         DATE,
  duracao_segundos    INT,
  fonte               TEXT CHECK (fonte IN ('upload', 'youtube', 'gravacao')),
  youtube_url         TEXT,
  audio_storage_path  TEXT,
  transcricao         JSONB,
  pontos_chave        JSONB,
  relatorio           TEXT,
  status              TEXT NOT NULL DEFAULT 'processando'
                      CHECK (status IN ('processando', 'transcrevendo', 'concluida', 'erro')),
  error_msg           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessoes_transcritas ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sessoes_transcritas_gabinete_idx
  ON sessoes_transcritas(gabinete_id, created_at DESC);
