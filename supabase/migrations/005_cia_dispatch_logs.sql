-- ============================================================
-- CIa (Assistente Virtual) — Logs de Disparos WhatsApp
-- Migration: 005_cia_dispatch_logs
-- Responsável: Claude Code — Sprint S3 pt.2
-- 2026-03-12
-- ============================================================

-- Tabela de logs de cada mensagem WhatsApp disparada pela CIa
create table if not exists cadin_cia_logs (
  id                    uuid primary key default uuid_generate_v4(),
  gabinete_id           uuid not null references gabinetes(id) on delete cascade,
  person_id             uuid references cadin_persons(id) on delete set null,

  -- Snapshot do contato no momento do envio
  person_name           text not null,
  person_phone          text not null,
  person_title          text,              -- cargo no momento do envio

  -- Dados da mensagem
  context_input         text,             -- contexto/motivo informado pelo usuário
  message_generated     text,             -- mensagem gerada pelo Gemini
  message_preview       text,             -- primeiros 200 chars

  -- Resultado do disparo
  status                text not null default 'pending'
                        check (status in ('pending','sent','error','skipped')),
  evolution_message_id  text,             -- ID retornado pela Evolution API
  error_message         text,

  -- Metadados
  model_used            text default 'gemini-2.5-flash',
  dispatched_at         timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists cadin_cia_logs_gabinete_idx
  on cadin_cia_logs (gabinete_id, created_at desc);

create index if not exists cadin_cia_logs_person_idx
  on cadin_cia_logs (person_id, status);

-- RLS
alter table cadin_cia_logs enable row level security;

create policy "cadin_cia_logs_all"
  on cadin_cia_logs for all
  using (gabinete_id = my_gabinete_id());
