-- ============================================================
-- CADIN — Adiciona tipo 'judiciario' para TJ, TRE, MP, Defensoria
-- Migration: 015_cadin_tipo_judiciario
-- 2026-03-16
-- ============================================================

-- Expande o CHECK constraint da coluna type
ALTER TABLE cadin_organizations
  DROP CONSTRAINT IF EXISTS cadin_organizations_type_check;

ALTER TABLE cadin_organizations
  ADD CONSTRAINT cadin_organizations_type_check
  CHECK (type IN (
    'prefeitura','camara','secretaria','autarquia',
    'empresa_publica','fundacao','conselho','judiciario','outros'
  ));
