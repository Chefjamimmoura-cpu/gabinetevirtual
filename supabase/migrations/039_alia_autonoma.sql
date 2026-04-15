-- 039_alia_autonoma.sql
-- ALIA Autônoma: config por gabinete, task queue, action permissions em recipients.
-- Spec: docs/superpowers/specs/2026-04-15-alia-autonoma-pareceres-design.md

-- ── gabinete_alia_config ─────────────────────────────────────────────────────
-- Configuração de automação da ALIA por gabinete.
-- Somente superadmin pode alterar via /api/admin/alia-config.

CREATE TABLE IF NOT EXISTS gabinete_alia_config (
  gabinete_id TEXT PRIMARY KEY,
  auto_parecer_on_ordem_dia BOOLEAN DEFAULT false,
  notify_ordem_dia BOOLEAN DEFAULT true,
  notify_materia_comissao BOOLEAN DEFAULT true,
  parecer_model TEXT DEFAULT 'flash',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE gabinete_alia_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on gabinete_alia_config" ON gabinete_alia_config;
CREATE POLICY "Service role full access on gabinete_alia_config"
  ON gabinete_alia_config FOR ALL USING (true) WITH CHECK (true);

-- ── alia_task_queue ──────────────────────────────────────────────────────────
-- Fila de tarefas assíncronas para geração de pareceres em background.
-- Processada pelo cron alia-proactive via /api/alia/task/process.

CREATE TABLE IF NOT EXISTS alia_task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pendente',
  resultado JSONB,
  erro TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_queue_status
  ON alia_task_queue(status, created_at);

CREATE INDEX IF NOT EXISTS idx_task_queue_gabinete
  ON alia_task_queue(gabinete_id, status);

ALTER TABLE alia_task_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on alia_task_queue" ON alia_task_queue;
CREATE POLICY "Service role full access on alia_task_queue"
  ON alia_task_queue FOR ALL USING (true) WITH CHECK (true);

-- ── action_permissions em recipients ─────────────────────────────────────────
-- Permissões granulares por ação (gerar_pareceres, configurar_automacao, etc.)
-- Default: somente receber notificações e consultar matérias.

ALTER TABLE gabinete_whatsapp_recipients
  ADD COLUMN IF NOT EXISTS action_permissions TEXT[]
  DEFAULT ARRAY['receber_notificacoes', 'consultar_materias'];

-- ── Seed config padrão ──────────────────────────────────────────────────────

INSERT INTO gabinete_alia_config (gabinete_id, notify_ordem_dia, notify_materia_comissao)
VALUES ('carol-dantas-cmbv', true, true)
ON CONFLICT (gabinete_id) DO NOTHING;
