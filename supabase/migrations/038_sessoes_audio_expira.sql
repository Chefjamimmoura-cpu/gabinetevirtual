-- Campo de expiração do áudio (timebomb de 30 dias)
-- Áudio comprimido é removido do Storage após esta data, mas transcrição + relatório permanecem.

ALTER TABLE sessoes_transcritas
  ADD COLUMN IF NOT EXISTS audio_expira_em TIMESTAMPTZ;

COMMENT ON COLUMN sessoes_transcritas.audio_expira_em IS
  'Data limite em que o áudio comprimido será removido do Storage (default NOW + 30 dias). Após essa data, player/waveform ficam indisponíveis mas transcrição e relatório permanecem.';

-- Índice para o cron job de expiração varrer rapidamente
CREATE INDEX IF NOT EXISTS idx_sessoes_audio_expira
  ON sessoes_transcritas (audio_expira_em)
  WHERE audio_storage_path IS NOT NULL;
