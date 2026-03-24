-- ─────────────────────────────────────────────────────────────
-- 013 — Histórico de Pareceres Gerados
-- Registra cada parecer produzido pela IA para consulta futura.
-- ─────────────────────────────────────────────────────────────

create table if not exists pareceres_historico (
  id            uuid primary key default gen_random_uuid(),
  gabinete_id   uuid not null default 'f25299db-1c33-45b9-830f-82f6d2d666ef'::uuid,
  sessao_str    text,                          -- ex: "Sessão Plenária 5 (11/03/2026)"
  data_sessao   date,                          -- ex: 2026-03-11
  total_materias int not null default 0,
  model_usado   text not null default 'gemini-2.5-flash',
  materia_ids   int[],                         -- IDs das matérias analisadas
  parecer_md    text not null,                 -- texto completo em markdown
  gerado_em     timestamptz not null default now()
);

-- índices para listagem rápida
create index if not exists pareceres_historico_gabinete_idx on pareceres_historico (gabinete_id, gerado_em desc);
create index if not exists pareceres_historico_data_idx     on pareceres_historico (data_sessao desc);

-- Row Level Security — apenas service role escreve, anon lê do gabinete
alter table pareceres_historico enable row level security;

create policy "service role full access" on pareceres_historico
  for all using (true) with check (true);
