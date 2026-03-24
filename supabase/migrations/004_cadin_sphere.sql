-- ============================================================
-- CADIN: Coluna sphere em cadin_organizations
-- Migration: 004_cadin_sphere
-- Responsável: Claude Code — Sprint S3
-- 2026-03-12
--
-- Adiciona esfera governamental às organizações do CADIN.
-- Valores: 'federal' | 'estadual' | 'municipal'
-- Default: 'municipal' (maioria das organizações cadastradas)
-- ============================================================

alter table cadin_organizations
  add column if not exists sphere text not null default 'municipal'
    check (sphere in ('federal', 'estadual', 'municipal'));

comment on column cadin_organizations.sphere is
  'Esfera governamental: federal, estadual ou municipal';

-- Índice para queries por esfera (usada no export-pdf e filtros)
create index if not exists cadin_org_sphere_idx
  on cadin_organizations (gabinete_id, sphere, active);
