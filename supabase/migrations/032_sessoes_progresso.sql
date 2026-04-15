-- Adiciona campos de progresso para tracking em tempo real
ALTER TABLE sessoes_transcritas
  ADD COLUMN IF NOT EXISTS progresso_pct SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progresso_etapa TEXT DEFAULT '';
