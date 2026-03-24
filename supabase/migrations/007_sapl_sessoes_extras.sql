-- ══════════════════════════════════════════════════════════════
-- Migration 007: Colunas extras em sapl_sessoes_cache para o
-- Mirroring Passivo do SAPL (V3-F1 — Claude Code)
-- ──────────────────────────────────────────────────────────────
-- A migration 006 criou as tabelas base. Esta migration adiciona
-- as colunas necessárias para rastrear:
--  1. str_repr   — descrição textual da sessão (__str__ do SAPL)
--  2. materia_ids — IDs de matéria extraídos do PDF da pauta
--  3. pdf_processado — flag para saber se o PDF já foi processado
-- ══════════════════════════════════════════════════════════════

ALTER TABLE sapl_sessoes_cache
  ADD COLUMN IF NOT EXISTS str_repr       TEXT,
  ADD COLUMN IF NOT EXISTS materia_ids    INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pdf_processado BOOLEAN DEFAULT false;

-- Índice para o worker de sync encontrar sessões com PDF pendente
CREATE INDEX IF NOT EXISTS sapl_sessoes_pdf_pendente_idx
  ON sapl_sessoes_cache (id)
  WHERE pdf_processado = false AND upload_pauta IS NOT NULL;

-- Índice para buscas por data (sem gabinete_id para o worker global)
CREATE INDEX IF NOT EXISTS sapl_sessoes_data_only_idx
  ON sapl_sessoes_cache (data_sessao DESC);
