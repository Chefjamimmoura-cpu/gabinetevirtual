-- =============================================================================
-- V3: SAPL Mirroring & Cache System (Fase 1)
-- Migration: 006_sapl_mirror
-- Data: 2026-03-13
--
-- Cria as tabelas de cache local para evitar bater no SAPL em tempo real.
-- =============================================================================

-- ── sapl_sessoes_cache ──────────────────────────────────────────────────
create table if not exists sapl_sessoes_cache (
  id              integer primary key,         -- ID real do SAPL
  gabinete_id     uuid references gabinetes(id) on delete cascade,
  tipo_sessao     text,                        -- Ex: Extraordinária, Ordinária
  data_sessao     date not null,
  hora_inicio     time,
  numero          integer,
  legislatura     integer,
  sessao_legislativa integer,
  upload_pauta    text,
  upload_ata      text,
  ativa           boolean default true,        -- Sessões antigas podem ser nativas = false para otimizar UI
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- Indexar por data para buscas da página inicial
create index if not exists sapl_sessoes_data_idx
  on sapl_sessoes_cache (gabinete_id, data_sessao desc);

-- ── sapl_materias_cache ─────────────────────────────────────────────────
create table if not exists sapl_materias_cache (
  id              integer primary key,         -- ID real do SAPL da Matéria
  sessao_id       integer references sapl_sessoes_cache(id) on delete cascade,
  gabinete_id     uuid references gabinetes(id) on delete cascade,
  tipo_sigla      text not null,               -- Ex: IND, PL, REQ
  numero          integer,
  ano             integer,
  ementa          text,
  autores         text,                        -- Array flat ou string
  pauta_ordem     integer,                     -- Qual a ordem de leitura na pauta (ordem_dia)
  data_apresentacao date,
  docs_json       jsonb,
  tramitacoes_json jsonb,
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- Indexar autoria para dashboards
create index if not exists sapl_materias_tipo_idx
  on sapl_materias_cache (gabinete_id, tipo_sigla, ano, numero);

-- ── sapl_tramitacoes_raw ────────────────────────────────────────────────
-- (Opcional, futuro passo para espelhar todo andamento do SAPL)
create table if not exists sapl_tramitacoes_raw (
  id              integer primary key,         -- ID Real
  materia_id      integer references sapl_materias_cache(id) on delete cascade,
  gabinete_id     uuid references gabinetes(id) on delete cascade,
  data_tramitacao date not null,
  status_nome     text,
  texto_acao      text,
  pdf_url         text,
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists sapl_tramitacoes_materia_idx
  on sapl_tramitacoes_raw (materia_id, data_tramitacao desc);

-- ── Tabela de Controle do Worker (Sync Logs) ───────────────────────────
create table if not exists sapl_sync_logs (
  id             uuid primary key default uuid_generate_v4(),
  gabinete_id    uuid not null references gabinetes(id) on delete cascade,
  target_table   text not null,                -- 'sapl_sessoes', 'sapl_materias'
  status         text not null check (status in ('running', 'success', 'error')),
  records_synced integer default 0,
  error_message  text,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- ── RLS Policies ────────────────────────────────────────────────────────
alter table sapl_sessoes_cache    enable row level security;
alter table sapl_materias_cache   enable row level security;
alter table sapl_tramitacoes_raw  enable row level security;
alter table sapl_sync_logs        enable row level security;

create policy "sapl_sessoes_cache_all" on sapl_sessoes_cache for all
  using (gabinete_id = my_gabinete_id() or gabinete_id is null);

create policy "sapl_materias_cache_all" on sapl_materias_cache for all
  using (gabinete_id = my_gabinete_id() or gabinete_id is null);

create policy "sapl_tramitacoes_raw_all" on sapl_tramitacoes_raw for all
  using (gabinete_id = my_gabinete_id() or gabinete_id is null);

create policy "sapl_sync_logs_all" on sapl_sync_logs for all
  using (gabinete_id = my_gabinete_id());
