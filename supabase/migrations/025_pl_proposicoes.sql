-- =============================================================================
-- V9: Módulo ALIA Legislativo — Tabelas de PLs e Tramitação
-- Migration: 025_pl_proposicoes
-- Data: 2026-03-24
--
-- Cria as tabelas de gestão interna de Projetos de Lei gerados pela ALIA,
-- desacopladas do espelho SAPL (sapl_materias_cache).
-- =============================================================================

-- ── pl_proposicoes ─────────────────────────────────────────────────────────
create table if not exists pl_proposicoes (
  id                    uuid primary key default uuid_generate_v4(),
  gabinete_id           uuid not null references gabinetes(id) on delete cascade,

  -- Identificação SAPL (NULL enquanto rascunho)
  numero_sapl           varchar(30),          -- ex: "PLL 38/2026"
  sapl_id               integer,              -- FK ao sapl_materias_cache.id (opcional)

  -- Classificação
  tipo                  text not null default 'PLL'
                          check (tipo in ('PLL','PDL','PRE','REQ','OUTROS')),
  ementa                text,
  tema                  varchar(80),          -- classificado automaticamente pela ALIA

  -- Status do ciclo de vida
  status                text not null default 'RASCUNHO'
                          check (status in ('RASCUNHO','TRAMITANDO','COMISSAO','APROVADO','ARQUIVADO')),

  -- Conteúdo gerado pela ALIA
  texto_pl              text,
  justificativa         text,

  -- Outputs dos agentes ALIA (JSONB estruturado)
  pesquisa_similares    jsonb,                -- output Agente Pesquisadora
  parecer_juridico      jsonb,                -- output Agente Jurídica
  pls_acessorios        jsonb,               -- output Agente Estrategista

  -- Estado persistido do wizard (salvo entre sessões)
  rascunho_wizard       jsonb,

  -- Relacionamento tronco-acessório
  pl_tronco_id          uuid references pl_proposicoes(id) on delete set null,

  -- Controle de aprovação humana (RN-01, RN-02)
  aprovado_por          uuid references auth.users(id),
  aprovado_em           timestamptz,
  texto_aprovado        text,                 -- snapshot do texto no momento da aprovação

  -- Dados de protocolo
  data_protocolo        date,

  -- Controle de notificação
  notificado_em         timestamptz,          -- última notificação de tramitação enviada

  -- Timestamps
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Índices de performance
create index if not exists pl_proposicoes_gabinete_idx
  on pl_proposicoes (gabinete_id, status, updated_at desc);

create index if not exists pl_proposicoes_tema_idx
  on pl_proposicoes (gabinete_id, tema);

create index if not exists pl_proposicoes_tipo_idx
  on pl_proposicoes (gabinete_id, tipo);

-- Trigger para atualizar updated_at automaticamente
create or replace function update_pl_proposicoes_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pl_proposicoes_updated_at
  before update on pl_proposicoes
  for each row execute function update_pl_proposicoes_updated_at();

-- ── pl_historico_tramitacao ────────────────────────────────────────────────
-- Tabela append-only — nunca deletar ou atualizar entradas (RN-06)
create table if not exists pl_historico_tramitacao (
  id             uuid primary key default uuid_generate_v4(),
  pl_id          uuid not null references pl_proposicoes(id) on delete cascade,
  gabinete_id    uuid not null references gabinetes(id) on delete cascade,

  data_evento    date not null,
  status_novo    text not null,
  descricao      text,

  -- fonte: 'interno' = ação no Gabinete Virtual; 'sapl' = detectado pelo cron
  fonte          text not null default 'interno'
                   check (fonte in ('interno','sapl')),

  -- Controle de leitura (RN-07)
  visualizado    boolean not null default false,

  created_at     timestamptz not null default now()
);

-- Índices
create index if not exists pl_historico_pl_idx
  on pl_historico_tramitacao (pl_id, data_evento desc);

create index if not exists pl_historico_nao_visualizado_idx
  on pl_historico_tramitacao (gabinete_id, visualizado)
  where visualizado = false;

-- ── RLS Policies ───────────────────────────────────────────────────────────
alter table pl_proposicoes          enable row level security;
alter table pl_historico_tramitacao enable row level security;

-- pl_proposicoes: acesso apenas ao gabinete autenticado (RN-04)
create policy "pl_proposicoes_gabinete_policy" on pl_proposicoes
  for all using (gabinete_id = my_gabinete_id());

-- pl_historico_tramitacao: acesso apenas ao gabinete autenticado
create policy "pl_historico_tramitacao_gabinete_policy" on pl_historico_tramitacao
  for all using (gabinete_id = my_gabinete_id());

-- Bloquear DELETE e UPDATE na tabela de histórico (append-only)
create policy "pl_historico_no_delete" on pl_historico_tramitacao
  as restrictive for delete using (false);

create policy "pl_historico_no_update" on pl_historico_tramitacao
  as restrictive for update using (false);
