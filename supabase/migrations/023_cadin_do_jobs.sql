-- 023_cadin_do_jobs.sql
-- Fila de processamento de Diários Oficiais + coluna pending_review em appointments

-- ── 1. pending_review em cadin_appointments ───────────────────────────────
alter table cadin_appointments
  add column if not exists pending_review boolean not null default false,
  add column if not exists do_source_url  text,
  add column if not exists do_raw_text    text;

comment on column cadin_appointments.pending_review IS
  'true = importado automaticamente do D.O., aguarda revisão humana antes de ativar.';
comment on column cadin_appointments.do_source_url IS
  'URL do PDF do Diário Oficial de origem.';
comment on column cadin_appointments.do_raw_text IS
  'Trecho bruto extraído do D.O. para auditoria.';

-- ── 2. cadin_do_jobs — fila de PDFs a processar ──────────────────────────
create table if not exists cadin_do_jobs (
  id            uuid primary key default uuid_generate_v4(),
  gabinete_id   uuid not null references gabinetes(id) on delete cascade,
  source        text not null,           -- 'doerr' | 'dom-bv' | 'dje-rr'
  source_url    text not null,           -- URL do PDF (chave de idempotência)
  edition_date  date,                    -- data da edição do D.O.
  status        text not null default 'pending',  -- pending | processing | done | error
  appointments_found integer default 0,
  error_msg     text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists cadin_do_jobs_url_idx
  on cadin_do_jobs (gabinete_id, source_url);

create index if not exists cadin_do_jobs_status_idx
  on cadin_do_jobs (gabinete_id, status, created_at desc);

alter table cadin_do_jobs enable row level security;

create policy "cadin_do_jobs_all"
  on cadin_do_jobs for all
  using (gabinete_id = (
    select gabinete_id from profiles where id = auth.uid() limit 1
  ));
