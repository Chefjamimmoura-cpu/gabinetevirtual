-- ═══════════════════════════════════════════════════════════════
-- Migration 027 — Multi-tenant: sapl_parlamentar_id + comissoes_descobertas
-- ═══════════════════════════════════════════════════════════════
-- sapl_parlamentar_id: ID do vereador no SAPL (para chamadas dinâmicas)
-- comissoes_descobertas: resultado do sync automático de comissões via SAPL API

ALTER TABLE gabinetes
  ADD COLUMN IF NOT EXISTS sapl_parlamentar_id   INT,
  ADD COLUMN IF NOT EXISTS comissoes_descobertas JSONB;

COMMENT ON COLUMN gabinetes.sapl_parlamentar_id IS 'ID do parlamentar no endpoint /api/parlamentares/parlamentar/ do SAPL';
COMMENT ON COLUMN gabinetes.comissoes_descobertas IS 'JSONB com comissões descobertas via sync automático: [{sigla, nome, sapl_comissao_id, sapl_unit_id}]';
