-- =============================================================================
-- Migration 003: Workflow de Assinaturas de Comissões
-- Autor: Claude Code (Sprint S2)
-- Data: 2026-03-12
--
-- Aprimora comissao_pareceres com máquina de estados para o fluxo de
-- assinatura (secretário → vice-presidente → presidente) e adiciona
-- campos de auditoria em comissao_assinaturas.
-- =============================================================================

-- 1. Adicionar colunas de workflow em comissao_pareceres
--    workflow_status: estado atual no fluxo de assinaturas
--    gabinete_id: desnormalizado para RLS eficiente (evita JOIN com comissoes)
--    texto_parecer: conteúdo markdown do parecer gerado pela IA
--    sapl_materia_numero / ano: referência legível da matéria
--    ementa: cache da ementa da matéria (evita round-trip ao SAPL)

alter table comissao_pareceres
  add column if not exists gabinete_id        uuid references gabinetes(id) on delete cascade,
  add column if not exists workflow_status    text not null default 'rascunho'
                                              check (workflow_status in (
                                                'rascunho',
                                                'aguardando_secretario',
                                                'aguardando_vice',
                                                'aguardando_presidente',
                                                'assinado',
                                                'publicado',
                                                'rejeitado'
                                              )),
  add column if not exists texto_parecer      text,
  add column if not exists sapl_materia_numero integer,
  add column if not exists sapl_materia_ano   integer,
  add column if not exists ementa             text,
  add column if not exists data_reuniao       date,
  add column if not exists updated_at         timestamptz not null default now();

-- Preencher gabinete_id retroativamente via JOIN com comissoes
update comissao_pareceres cp
set    gabinete_id = c.gabinete_id
from   comissoes c
where  cp.comissao_id = c.id
  and  cp.gabinete_id is null;

-- 2. Aprimorar comissao_assinaturas com cargo e observação
alter table comissao_assinaturas
  add column if not exists cargo         text not null default 'membro'
                                         check (cargo in ('presidente', 'vice-presidente', 'secretario', 'membro')),
  add column if not exists observacao    text,
  add column if not exists ordem         integer not null default 1; -- ordem no fluxo (1=secretário, 2=vice, 3=presidente)

-- 3. Tabela de log de auditoria do workflow
create table if not exists comissao_workflow_log (
  id              uuid primary key default uuid_generate_v4(),
  parecer_id      uuid not null references comissao_pareceres(id) on delete cascade,
  gabinete_id     uuid not null references gabinetes(id) on delete cascade,
  actor_id        uuid references profiles(id) on delete set null,
  actor_name      text,                              -- cache do nome para auditoria
  de_status       text,                              -- status anterior
  para_status     text not null,                     -- novo status
  observacao      text,                              -- motivo (especialmente em rejeição)
  created_at      timestamptz not null default now()
);

-- 4. Trigger: atualizar updated_at em comissao_pareceres
create or replace function update_parecer_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_parecer_updated_at on comissao_pareceres;
create trigger trg_parecer_updated_at
  before update on comissao_pareceres
  for each row execute function update_parecer_updated_at();

-- 5. Trigger: ao assinar (status → 'assinado'), avançar workflow automaticamente
--    Regra: quando TODOS os assinantes obrigatórios do parecer assinaram → avançar para o próximo cargo
create or replace function advance_workflow_on_signature()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parecer        comissao_pareceres%rowtype;
  v_total_cargo    integer;
  v_signed_cargo   integer;
  v_next_status    text;
begin
  -- Só atua em transições para 'assinado'
  if new.status <> 'assinado' then return new; end if;

  select * into v_parecer from comissao_pareceres where id = new.parecer_id;

  -- Contar assinantes do mesmo cargo e quantos já assinaram
  select count(*) into v_total_cargo
  from   comissao_assinaturas
  where  parecer_id = new.parecer_id and cargo = new.cargo;

  select count(*) into v_signed_cargo
  from   comissao_assinaturas
  where  parecer_id = new.parecer_id and cargo = new.cargo and status = 'assinado';

  -- Se todos do cargo assinaram, avançar estado
  if v_signed_cargo >= v_total_cargo then
    v_next_status := case v_parecer.workflow_status
      when 'aguardando_secretario'  then 'aguardando_vice'
      when 'aguardando_vice'        then 'aguardando_presidente'
      when 'aguardando_presidente'  then 'assinado'
      else v_parecer.workflow_status
    end;

    if v_next_status <> v_parecer.workflow_status then
      update comissao_pareceres
      set    workflow_status = v_next_status
      where  id = new.parecer_id;

      insert into comissao_workflow_log (parecer_id, gabinete_id, actor_id, actor_name, de_status, para_status)
      values (new.parecer_id, v_parecer.gabinete_id, new.membro_id,
              (select full_name from profiles where id = new.membro_id),
              v_parecer.workflow_status, v_next_status);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_advance_workflow on comissao_assinaturas;
create trigger trg_advance_workflow
  after update on comissao_assinaturas
  for each row execute function advance_workflow_on_signature();

-- 6. RLS em comissao_workflow_log
alter table comissao_workflow_log enable row level security;

drop policy if exists "log visible no gabinete" on comissao_workflow_log;
create policy "log visible no gabinete" on comissao_workflow_log
  for select using (gabinete_id = my_gabinete_id());

drop policy if exists "log inserido pelo sistema" on comissao_workflow_log;
create policy "log inserido pelo sistema" on comissao_workflow_log
  for insert with check (gabinete_id = my_gabinete_id());

-- 7. RLS em comissao_pareceres (adicionar gabinete_id ao filtro)
--    Remove política antiga e recria com gabinete_id direto (mais eficiente)
drop policy if exists "parecer visivel no gabinete" on comissao_pareceres;
create policy "parecer visivel no gabinete" on comissao_pareceres
  for all using (
    gabinete_id = my_gabinete_id()
    or exists (
      select 1 from comissoes c
      where c.id = comissao_pareceres.comissao_id
        and c.gabinete_id = my_gabinete_id()
    )
  );

-- 8. Índices úteis para queries do workflow
create index if not exists idx_parecer_workflow_status  on comissao_pareceres(workflow_status);
create index if not exists idx_parecer_gabinete         on comissao_pareceres(gabinete_id);
create index if not exists idx_assinatura_cargo         on comissao_assinaturas(cargo, status);
create index if not exists idx_workflow_log_parecer     on comissao_workflow_log(parecer_id);
