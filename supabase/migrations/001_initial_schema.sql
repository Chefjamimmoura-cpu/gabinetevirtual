-- =============================================================================
-- Gabinete Virtual — Schema Inicial
-- Autor: Claude Code (Sprint S0)
-- Data: 2026-03-10
--
-- Aplicar no Supabase SQL Editor (ou via Supabase CLI: supabase db push)
-- Organização Supabase: fzblgxdwjmciwuvvodsg
-- =============================================================================

-- Extensões
create extension if not exists "uuid-ossp";
create extension if not exists "vector";          -- pgvector: embeddings (indicações)

-- =============================================================================
-- CORE: gabinetes + profiles
-- =============================================================================

create table if not exists gabinetes (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  vereador_name text not null,
  municipio     text not null default 'Boa Vista',
  config_json   jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text not null,
  email       text not null,
  role        text not null default 'assessor'
              check (role in ('admin', 'vereador', 'assessor')),
  gabinete_id uuid references gabinetes(id) on delete set null,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Trigger: criar profile automaticamente após signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =============================================================================
-- MÓDULO 2: Comissões
-- =============================================================================

create table if not exists comissoes (
  id            uuid primary key default uuid_generate_v4(),
  gabinete_id   uuid not null references gabinetes(id) on delete cascade,
  name          text not null,
  sapl_id       integer,          -- ID da comissão no SAPL
  presidente_id uuid references profiles(id) on delete set null,
  tipo          text not null default 'permanente'
                check (tipo in ('permanente', 'especial', 'cpi')),
  created_at    timestamptz not null default now()
);

create table if not exists comissao_membros (
  id          uuid primary key default uuid_generate_v4(),
  comissao_id uuid not null references comissoes(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  cargo       text not null default 'membro'
              check (cargo in ('presidente', 'vice-presidente', 'secretario', 'membro')),
  ativo       boolean not null default true,
  unique (comissao_id, profile_id)
);

create table if not exists comissao_pareceres (
  id              uuid primary key default uuid_generate_v4(),
  comissao_id     uuid not null references comissoes(id) on delete cascade,
  materia_sapl_id integer not null,
  relator         text,
  voto            text check (voto in ('favoravel', 'contrario', 'com_emenda', 'abstencao')),
  doc_url         text,
  created_at      timestamptz not null default now()
);

create table if not exists comissao_assinaturas (
  id          uuid primary key default uuid_generate_v4(),
  parecer_id  uuid not null references comissao_pareceres(id) on delete cascade,
  membro_id   uuid not null references profiles(id) on delete cascade,
  status      text not null default 'pendente'
              check (status in ('pendente', 'assinado', 'recusado')),
  signed_at   timestamptz,
  unique (parecer_id, membro_id)
);

-- =============================================================================
-- MÓDULO 3: Agenda
-- =============================================================================

create table if not exists eventos (
  id               uuid primary key default uuid_generate_v4(),
  gabinete_id      uuid not null references gabinetes(id) on delete cascade,
  titulo           text not null,
  descricao        text,
  tipo             text not null default 'reuniao'
                   check (tipo in ('sessao_plenaria', 'reuniao_comissao', 'agenda_externa', 'reuniao', 'outro')),
  data_inicio      timestamptz not null,
  data_fim         timestamptz,
  local            text,
  participantes_ids uuid[] default '{}',
  cor              text default '#6366f1',
  created_by       uuid references profiles(id) on delete set null,
  sapl_sessao_id   integer,       -- link com sessão importada do SAPL
  created_at       timestamptz not null default now()
);

-- =============================================================================
-- MÓDULO 4: Projetos de Lei (criados internamente, não apenas espelhados do SAPL)
-- =============================================================================

create table if not exists projetos_lei (
  id             uuid primary key default uuid_generate_v4(),
  gabinete_id    uuid not null references gabinetes(id) on delete cascade,
  tipo           text not null default 'PL'
                 check (tipo in ('PL', 'PLO', 'PLC', 'Requerimento', 'Indicação', 'Moção')),
  numero         text,
  ementa         text not null,
  justificativa  text,
  texto_completo text,
  status         text not null default 'rascunho'
                 check (status in ('rascunho', 'revisao', 'protocolado', 'em_tramitacao', 'aprovado', 'arquivado')),
  sapl_id        integer,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- =============================================================================
-- MÓDULOS 5+6: Indicações
-- =============================================================================

create table if not exists indicacoes (
  id            uuid primary key default uuid_generate_v4(),
  gabinete_id   uuid not null references gabinetes(id) on delete cascade,
  numero_sapl   text,
  titulo        text not null,
  descricao     text,
  bairro        text,
  tema          text,
  status        text not null default 'pendente'
                check (status in ('pendente', 'em_andamento', 'atendida', 'arquivada')),
  geo_lat       double precision,
  geo_lng       double precision,
  fonte         text default 'manual'
                check (fonte in ('manual', 'fala_cidadao', 'sapl', 'whatsapp')),
  sapl_id       integer,
  embedding     vector(768),      -- Gemini Embedding 2 (768 dims)
  created_at    timestamptz not null default now()
);

create index if not exists indicacoes_embedding_idx
  on indicacoes using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- =============================================================================
-- MÓDULO 7: Ofícios
-- =============================================================================

create table if not exists oficios (
  id             uuid primary key default uuid_generate_v4(),
  gabinete_id    uuid not null references gabinetes(id) on delete cascade,
  numero_seq     integer not null,
  ano            integer not null default extract(year from now())::integer,
  tipo_template  text not null default 'oficio'
                 check (tipo_template in ('oficio', 'requerimento', 'representacao', 'solicitacao')),
  destinatario   text not null,
  cargo_dest     text,
  orgao_dest     text,
  assunto        text not null,
  corpo          text,
  status         text not null default 'rascunho'
                 check (status in ('rascunho', 'enviado', 'arquivado')),
  doc_url        text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (gabinete_id, ano, numero_seq)
);

-- Sequence por gabinete: função auxiliar para próximo número
create or replace function next_oficio_numero(p_gabinete_id uuid)
returns integer language plpgsql as $$
declare v_next integer;
begin
  select coalesce(max(numero_seq), 0) + 1
    into v_next
    from oficios
   where gabinete_id = p_gabinete_id
     and ano = extract(year from now())::integer;
  return v_next;
end;
$$;

-- =============================================================================
-- MÓDULO 8: CADIN (Cadastro de Autoridades/Contatos)
-- =============================================================================

create table if not exists contatos (
  id          uuid primary key default uuid_generate_v4(),
  gabinete_id uuid not null references gabinetes(id) on delete cascade,
  nome        text not null,
  cargo       text,
  orgao       text,
  telefone    text,
  email       text,
  endereco    text,
  notas       text,
  created_at  timestamptz not null default now()
);

create index if not exists contatos_orgao_idx    on contatos (gabinete_id, orgao);
create index if not exists contatos_nome_idx     on contatos (gabinete_id, nome);

-- =============================================================================
-- RLS — Row Level Security (multi-tenant por gabinete_id)
-- =============================================================================

-- Helper: retorna gabinete_id do usuário autenticado
create or replace function my_gabinete_id()
returns uuid language sql stable security definer set search_path = public as $$
  select gabinete_id from profiles where id = auth.uid()
$$;

-- ── gabinetes ────────────────────────────────────────────────────────────────
alter table gabinetes enable row level security;

create policy "gabinete: leitura do próprio gabinete"
  on gabinetes for select
  using (id = my_gabinete_id());

-- ── profiles ────────────────────────────────────────────────────────────────
alter table profiles enable row level security;

create policy "profiles: usuário lê o próprio perfil"
  on profiles for select
  using (id = auth.uid());

create policy "profiles: usuário atualiza o próprio perfil"
  on profiles for update
  using (id = auth.uid());

create policy "profiles: leitura de colegas do mesmo gabinete"
  on profiles for select
  using (gabinete_id = my_gabinete_id() and gabinete_id is not null);

-- ── comissoes ───────────────────────────────────────────────────────────────
alter table comissoes enable row level security;

create policy "comissoes: acesso ao próprio gabinete"
  on comissoes for all
  using (gabinete_id = my_gabinete_id());

-- ── comissao_membros ────────────────────────────────────────────────────────
alter table comissao_membros enable row level security;

create policy "comissao_membros: acesso ao próprio gabinete"
  on comissao_membros for all
  using (exists (
    select 1 from comissoes c
    where c.id = comissao_membros.comissao_id
      and c.gabinete_id = my_gabinete_id()
  ));

-- ── comissao_pareceres ──────────────────────────────────────────────────────
alter table comissao_pareceres enable row level security;

create policy "comissao_pareceres: acesso ao próprio gabinete"
  on comissao_pareceres for all
  using (exists (
    select 1 from comissoes c
    where c.id = comissao_pareceres.comissao_id
      and c.gabinete_id = my_gabinete_id()
  ));

-- ── comissao_assinaturas ────────────────────────────────────────────────────
alter table comissao_assinaturas enable row level security;

create policy "comissao_assinaturas: acesso ao próprio gabinete"
  on comissao_assinaturas for all
  using (exists (
    select 1 from comissao_pareceres cp
    join comissoes c on c.id = cp.comissao_id
    where cp.id = comissao_assinaturas.parecer_id
      and c.gabinete_id = my_gabinete_id()
  ));

-- ── eventos ─────────────────────────────────────────────────────────────────
alter table eventos enable row level security;

create policy "eventos: acesso ao próprio gabinete"
  on eventos for all
  using (gabinete_id = my_gabinete_id());

-- ── projetos_lei ────────────────────────────────────────────────────────────
alter table projetos_lei enable row level security;

create policy "projetos_lei: acesso ao próprio gabinete"
  on projetos_lei for all
  using (gabinete_id = my_gabinete_id());

-- ── indicacoes ──────────────────────────────────────────────────────────────
alter table indicacoes enable row level security;

create policy "indicacoes: acesso ao próprio gabinete"
  on indicacoes for all
  using (gabinete_id = my_gabinete_id());

-- ── oficios ─────────────────────────────────────────────────────────────────
alter table oficios enable row level security;

create policy "oficios: acesso ao próprio gabinete"
  on oficios for all
  using (gabinete_id = my_gabinete_id());

-- ── contatos ────────────────────────────────────────────────────────────────
alter table contatos enable row level security;

create policy "contatos: acesso ao próprio gabinete"
  on contatos for all
  using (gabinete_id = my_gabinete_id());

-- =============================================================================
-- SEED: Gabinete Carol (executa só uma vez em produção)
-- =============================================================================
-- Remova o comentário abaixo ao aplicar em produção pela primeira vez:
--
-- insert into gabinetes (id, name, vereador_name, municipio)
-- values (
--   uuid_generate_v4(),
--   'Gabinete Carol Dantas',
--   'Carol Dantas',
--   'Boa Vista'
-- );
