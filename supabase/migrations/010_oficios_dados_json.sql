-- =============================================================================
-- Migration 010 — Oficios: campo dados_json para re-renderização do documento
-- Sprint V4 — Sistema de salvamento de ofícios
-- =============================================================================

-- Armazena o objeto completo retornado pela IA para re-renderizar o documento
-- sem precisar chamar a IA novamente ao abrir um ofício salvo.
ALTER TABLE oficios
  ADD COLUMN IF NOT EXISTS dados_json JSONB NOT NULL DEFAULT '{}';

-- Índice para buscas por assunto e destinatário (full-text futuro)
CREATE INDEX IF NOT EXISTS idx_oficios_gabinete_ano ON oficios (gabinete_id, ano DESC, numero_seq DESC);
