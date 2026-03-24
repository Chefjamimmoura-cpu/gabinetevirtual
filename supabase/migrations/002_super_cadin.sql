-- ============================================================
-- Super CADIN — Arquitetura Institucional Modular v1.0
-- Migration: 002_super_cadin
-- Responsável: Claude Code — Sprint S1
-- 2026-03-11
--
-- NOTA: A tabela `contatos` (001_initial_schema.sql) permanece
-- ativa para compatibilidade. As tabelas cadin_* substituem
-- gradualmente. Prefixo `cadin_` obrigatório (white-label).
-- ============================================================

-- ── cadin_organizations: Órgãos, secretarias, câmaras, etc. ─

create table if not exists cadin_organizations (
  id          uuid primary key default uuid_generate_v4(),
  gabinete_id uuid not null references gabinetes(id) on delete cascade,
  name        text not null,
  acronym     text,                         -- ex: SEMUC, SEMARH, PMBoaVista
  type        text not null default 'secretaria'
              check (type in (
                'prefeitura','camara','secretaria','autarquia',
                'empresa_publica','fundacao','conselho','outros'
              )),
  parent_id   uuid references cadin_organizations(id) on delete set null, -- hierarquia
  address     text,
  phone       text,
  email       text,
  website     text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists cadin_org_gabinete_idx
  on cadin_organizations (gabinete_id, active, type);

-- ── cadin_persons: Pessoas físicas (autoridades, técnicos) ──

create table if not exists cadin_persons (
  id          uuid primary key default uuid_generate_v4(),
  gabinete_id uuid not null references gabinetes(id) on delete cascade,
  full_name   text not null,
  cpf         text,                         -- opcional
  phone       text,
  email       text,
  address     text,
  party       text,                         -- partido político, se aplicável
  photo_url   text,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists cadin_persons_name_idx
  on cadin_persons (gabinete_id, full_name);

-- ── cadin_appointments: Vínculo Pessoa → Órgão (cargo/nomeação) ─

create table if not exists cadin_appointments (
  id              uuid primary key default uuid_generate_v4(),
  gabinete_id     uuid not null references gabinetes(id) on delete cascade,
  person_id       uuid not null references cadin_persons(id) on delete cascade,
  organization_id uuid not null references cadin_organizations(id) on delete cascade,
  title           text not null,            -- "Secretário Municipal", "Prefeito", etc.
  start_date      date,
  end_date        date,                     -- null = cargo atual
  active          boolean not null default true,
  dou_url         text,                     -- link do Diário Oficial da nomeação
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists cadin_appt_active_idx
  on cadin_appointments (gabinete_id, active, organization_id);

create index if not exists cadin_appt_person_idx
  on cadin_appointments (person_id, active);

-- ── cadin_rag_logs: Rastreia ingestões de Diários Oficiais ──

create table if not exists cadin_rag_logs (
  id                   uuid primary key default uuid_generate_v4(),
  gabinete_id          uuid not null references gabinetes(id) on delete cascade,
  source_url           text not null,
  source_type          text not null default 'diario_oficial'
                       check (source_type in ('diario_oficial','manual','sapl','outros')),
  status               text not null default 'pending'
                       check (status in ('pending','processing','done','error')),
  processed_at         timestamptz,
  appointments_created integer not null default 0,
  persons_created      integer not null default 0,
  error_message        text,
  raw_excerpt          text,                -- trecho bruto para auditoria
  created_at           timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────

alter table cadin_organizations enable row level security;
alter table cadin_persons        enable row level security;
alter table cadin_appointments   enable row level security;
alter table cadin_rag_logs       enable row level security;

create policy "cadin_organizations_all"
  on cadin_organizations for all
  using (gabinete_id = my_gabinete_id());

create policy "cadin_persons_all"
  on cadin_persons for all
  using (gabinete_id = my_gabinete_id());

create policy "cadin_appointments_all"
  on cadin_appointments for all
  using (gabinete_id = my_gabinete_id());

create policy "cadin_rag_logs_all"
  on cadin_rag_logs for all
  using (gabinete_id = my_gabinete_id());
