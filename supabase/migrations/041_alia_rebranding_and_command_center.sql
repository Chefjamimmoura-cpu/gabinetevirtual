-- Migration 041: ALIA rebranding (laia_* → alia_*) + Command Center tables
-- Reversível: todos os renames têm view de compatibilidade; novas tabelas
-- podem ser dropadas.

BEGIN;

-- IMPORTANTE: rollback (DROP novas tabelas + RENAME ALIA→LAIA + DROP views) é
-- seguro APENAS antes de qualquer INSERT nas 4 tabelas novas. Após primeiros
-- inserts em alia_agent_runs/biblioteca_docs/agent_config/agent_config_history,
-- rollback significa perda permanente desses dados. Ver plano F0 seção Rollback.

-- =========================================================================
-- PARTE 1: Rename das tabelas existentes laia_* → alia_*
-- =========================================================================

ALTER TABLE IF EXISTS laia_sessions RENAME TO alia_sessions;
ALTER TABLE IF EXISTS laia_messages RENAME TO alia_messages;

-- Views de compatibilidade: permitem que código antigo (não atualizado neste
-- deploy) continue funcionando por 1 release. Remover em migration futura
-- quando confirmarmos zero consumidores do nome antigo.
CREATE VIEW laia_sessions AS SELECT * FROM alia_sessions;
CREATE VIEW laia_messages AS SELECT * FROM alia_messages;

COMMENT ON VIEW laia_sessions IS 'Compat view — remover após 1 release estável. Ver plan 2026-04-16.';
COMMENT ON VIEW laia_messages IS 'Compat view — remover após 1 release estável. Ver plan 2026-04-16.';
-- Views são SECURITY INVOKER (default Postgres): RLS das tabelas alia_* renomeadas se aplica ao caller.

-- =========================================================================
-- PARTE 2: alia_agent_runs (telemetria + base das métricas)
-- =========================================================================

CREATE TABLE IF NOT EXISTS alia_agent_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id    uuid NOT NULL REFERENCES gabinetes(id) ON DELETE CASCADE,
  agent_name     text NOT NULL,
  session_id     uuid NULL REFERENCES alia_sessions(id) ON DELETE SET NULL,
  triggered_by   text NOT NULL CHECK (triggered_by IN ('chat','whatsapp','cron','test-isolated')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz NULL,
  status         text NOT NULL CHECK (status IN ('running','ok','error')),
  error_message  text NULL,
  input_preview  text NOT NULL,
  output_preview text NULL,
  tokens_input   int NULL,
  tokens_output  int NULL,
  cost_usd       numeric(10,6) NULL,
  model          text NOT NULL,
  intent_tag     text NULL
);

CREATE INDEX IF NOT EXISTS idx_alia_agent_runs_gabinete_agent_time
  ON alia_agent_runs (gabinete_id, agent_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_alia_agent_runs_gabinete_status
  ON alia_agent_runs (gabinete_id, status);

-- =========================================================================
-- PARTE 3: alia_biblioteca_docs (metadados de docs ingeridos via UI)
-- =========================================================================

CREATE TABLE IF NOT EXISTS alia_biblioteca_docs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id    uuid NOT NULL REFERENCES gabinetes(id) ON DELETE CASCADE,
  titulo         text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('pdf','docx','txt','md','url','youtube','audio','csv','xlsx')),
  source_ref     text NOT NULL,
  storage_path   text NULL,
  status         text NOT NULL CHECK (status IN ('processing','pending_review','active','rejected','error')),
  chunks_count   int NOT NULL DEFAULT 0,
  error_message  text NULL,
  uploaded_by    uuid NOT NULL REFERENCES auth.users(id),
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by    uuid NULL REFERENCES auth.users(id),
  reviewed_at    timestamptz NULL,
  tags           text[] NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alia_biblioteca_docs_gabinete_status_time
  ON alia_biblioteca_docs (gabinete_id, status, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_alia_biblioteca_docs_tags
  ON alia_biblioteca_docs USING GIN (tags);

-- Trigger: mantém updated_at sincronizado em UPDATEs
CREATE OR REPLACE FUNCTION alia_biblioteca_docs_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_alia_biblioteca_docs_updated_at
BEFORE UPDATE ON alia_biblioteca_docs
FOR EACH ROW
EXECUTE FUNCTION alia_biblioteca_docs_set_updated_at();

-- =========================================================================
-- PARTE 4: alia_agent_config (overrides de prompt + toggle + router priority)
-- =========================================================================

CREATE TABLE IF NOT EXISTS alia_agent_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id      uuid NOT NULL REFERENCES gabinetes(id) ON DELETE CASCADE,
  agent_name       text NOT NULL,
  ativo            boolean NOT NULL DEFAULT true,
  prompt_override  text NULL,
  router_priority  int NOT NULL DEFAULT 0,
  updated_by       uuid NOT NULL REFERENCES auth.users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gabinete_id, agent_name)
);

-- =========================================================================
-- PARTE 5: alia_agent_config_history (histórico de 5 últimas versões)
-- =========================================================================

CREATE TABLE IF NOT EXISTS alia_agent_config_history (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id                  uuid NOT NULL REFERENCES alia_agent_config(id) ON DELETE CASCADE,
  agent_name                 text NOT NULL,
  prompt_snapshot            text NULL,
  ativo_snapshot             boolean NOT NULL,
  router_priority_snapshot   int NOT NULL,
  changed_by                 uuid NOT NULL REFERENCES auth.users(id),
  changed_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alia_agent_config_history_config_time
  ON alia_agent_config_history (config_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alia_agent_config_history_changed_by
  ON alia_agent_config_history (changed_by, changed_at DESC);

-- Trigger: antes de UPDATE em alia_agent_config, grava snapshot anterior
CREATE OR REPLACE FUNCTION alia_agent_config_history_trigger()
RETURNS trigger AS $$
BEGIN
  INSERT INTO alia_agent_config_history (
    config_id,
    agent_name,
    prompt_snapshot,
    ativo_snapshot,
    router_priority_snapshot,
    changed_by,
    changed_at
  ) VALUES (
    OLD.id,
    OLD.agent_name,
    OLD.prompt_override,
    OLD.ativo,
    OLD.router_priority,
    OLD.updated_by,
    OLD.updated_at
  );

  -- mantém apenas últimas 5 versões por config_id
  DELETE FROM alia_agent_config_history
  WHERE config_id = OLD.id
    AND id NOT IN (
      SELECT id FROM alia_agent_config_history
      WHERE config_id = OLD.id
      ORDER BY changed_at DESC, id DESC
      LIMIT 5
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_alia_agent_config_history
BEFORE UPDATE ON alia_agent_config
FOR EACH ROW
EXECUTE FUNCTION alia_agent_config_history_trigger();

-- Trigger: mantém updated_at sincronizado em UPDATEs
CREATE OR REPLACE FUNCTION alia_agent_config_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_alia_agent_config_updated_at
BEFORE UPDATE ON alia_agent_config
FOR EACH ROW
EXECUTE FUNCTION alia_agent_config_set_updated_at();

-- =========================================================================
-- PARTE 6: RLS (Row Level Security) — isolamento por gabinete
-- =========================================================================

ALTER TABLE alia_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alia_biblioteca_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alia_agent_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE alia_agent_config_history ENABLE ROW LEVEL SECURITY;

-- Policies de leitura: user deve pertencer ao gabinete (via profiles)
-- profiles.id é PK e referencia auth.users(id) diretamente
CREATE POLICY alia_agent_runs_select
  ON alia_agent_runs FOR SELECT
  USING (
    gabinete_id IN (
      SELECT gabinete_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY alia_biblioteca_docs_select
  ON alia_biblioteca_docs FOR SELECT
  USING (
    gabinete_id IN (
      SELECT gabinete_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY alia_agent_config_select
  ON alia_agent_config FOR SELECT
  USING (
    gabinete_id IN (
      SELECT gabinete_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY alia_agent_config_history_select
  ON alia_agent_config_history FOR SELECT
  USING (
    config_id IN (
      SELECT id FROM alia_agent_config
      WHERE gabinete_id IN (
        SELECT gabinete_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

-- Writes: apenas via service_role (backend). Nenhuma policy de INSERT/UPDATE
-- para authenticated — forçamos que mutações passem pelo server.

COMMIT;
