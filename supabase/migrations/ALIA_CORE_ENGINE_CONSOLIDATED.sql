-- ═══════════════════════════════════════════════════════════════════════════════
-- ALIA CORE ENGINE — CONSOLIDATED MIGRATIONS (033 → 037)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Copie/cole este arquivo INTEIRO no Supabase Dashboard → SQL Editor → Run
--
-- O que este script cria:
--   033 — alia_memory (memória persistente da ALIA)
--   034 — email_intelligence (triagem inteligente de emails)
--   035 — alia_notifications + alia_proactive_log + alia_notification_prefs
--   036 — cadin_sentinel_logs + cadin_pending_updates + cadin_ingest_jobs
--   037 — gabinete_whatsapp_recipients (multi-recipient com permissões)
--
-- Idempotente: usa IF NOT EXISTS em tudo. Pode rodar múltiplas vezes sem erro.
-- Requer: extensão pgvector já habilitada (CREATE EXTENSION IF NOT EXISTS vector;)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Garantir pgvector habilitado
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 033 — ALIA MEMORY (persistent memory with pgvector)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alia_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('preference','decision','relation','pattern')),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source_module TEXT,
  source_ref TEXT,
  embedding VECTOR(768),
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alia_memory_gabinete ON alia_memory(gabinete_id);
CREATE INDEX IF NOT EXISTS idx_alia_memory_tipo ON alia_memory(gabinete_id, tipo);
CREATE INDEX IF NOT EXISTS idx_alia_memory_subject ON alia_memory(gabinete_id, subject);
CREATE INDEX IF NOT EXISTS idx_alia_memory_confidence ON alia_memory(gabinete_id, confidence)
  WHERE confidence > 0.2;
CREATE INDEX IF NOT EXISTS idx_alia_memory_embedding ON alia_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION match_memory(
  query_embedding VECTOR(768),
  p_gabinete_id UUID,
  match_threshold FLOAT DEFAULT 0.50,
  match_count INT DEFAULT 10,
  p_tipos TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID, gabinete_id UUID, tipo TEXT, subject TEXT, content TEXT,
  confidence FLOAT, source_module TEXT, source_ref TEXT,
  expires_at TIMESTAMPTZ, last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.gabinete_id, m.tipo, m.subject, m.content,
         m.confidence, m.source_module, m.source_ref,
         m.expires_at, m.last_accessed_at, m.created_at, m.updated_at,
         1 - (m.embedding <=> query_embedding) AS similarity
  FROM alia_memory m
  WHERE m.gabinete_id = p_gabinete_id
    AND m.confidence > 0.2
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND (p_tipos IS NULL OR m.tipo = ANY(p_tipos))
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION decay_memories(
  p_gabinete_id UUID,
  decay_rate FLOAT DEFAULT 0.02
)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE alia_memory
  SET confidence = GREATEST(confidence - decay_rate, 0),
      updated_at = now()
  WHERE gabinete_id = p_gabinete_id
    AND tipo != 'preference'
    AND last_accessed_at < now() - INTERVAL '7 days'
    AND confidence > 0.2;
  GET DIAGNOSTICS affected = ROW_COUNT;

  UPDATE alia_memory
  SET confidence = 0, updated_at = now()
  WHERE gabinete_id = p_gabinete_id
    AND confidence > 0 AND confidence <= 0.2;

  RETURN affected;
END;
$$;

ALTER TABLE alia_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on alia_memory" ON alia_memory;
CREATE POLICY "Service role full access on alia_memory"
  ON alia_memory FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 034 — EMAIL INTELLIGENCE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  email_id UUID NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('critica','alta','media','baixa','spam')),
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  requires_action BOOLEAN DEFAULT false,
  action_deadline TIMESTAMPTZ,
  sentiment TEXT CHECK (sentiment IN ('positivo','neutro','negativo','formal')),
  cadin_person_id UUID,
  materia_id TEXT,
  indicacao_id UUID,
  suggested_actions JSONB DEFAULT '[]',
  action_taken TEXT,
  action_taken_by UUID,
  action_taken_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_intel_gabinete ON email_intelligence(gabinete_id);
CREATE INDEX IF NOT EXISTS idx_email_intel_urgency ON email_intelligence(gabinete_id, urgency);
CREATE INDEX IF NOT EXISTS idx_email_intel_email ON email_intelligence(email_id);
CREATE INDEX IF NOT EXISTS idx_email_intel_requires ON email_intelligence(gabinete_id, requires_action)
  WHERE requires_action = true;

ALTER TABLE email_intelligence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on email_intelligence" ON email_intelligence;
CREATE POLICY "Service role full access on email_intelligence"
  ON email_intelligence FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 035 — PROACTIVE ENGINE (notifications, log, prefs)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alia_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  recipient_id UUID,
  type TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('critica','alta','media','baixa','informativa')),
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alia_notif_gabinete ON alia_notifications(gabinete_id);
CREATE INDEX IF NOT EXISTS idx_alia_notif_unread ON alia_notifications(gabinete_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_alia_notif_urgency ON alia_notifications(gabinete_id, urgency);

CREATE TABLE IF NOT EXISTS alia_proactive_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_ref TEXT,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  consolidated_count INT DEFAULT 1,
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_log_gabinete ON alia_proactive_log(gabinete_id);
CREATE INDEX IF NOT EXISTS idx_proactive_log_cooldown ON alia_proactive_log(gabinete_id, event_type, event_ref, sent_at);

CREATE TABLE IF NOT EXISTS alia_notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  profile_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','dashboard','email')),
  quiet_start TIME,
  quiet_end TIME,
  max_daily INT DEFAULT 15,
  digest_time TIME DEFAULT '08:00',
  enabled BOOLEAN DEFAULT true,
  event_types_muted TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_prefs_unique ON alia_notification_prefs(gabinete_id, profile_id, channel);

ALTER TABLE alia_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE alia_proactive_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE alia_notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on alia_notifications" ON alia_notifications;
CREATE POLICY "Service role full access on alia_notifications"
  ON alia_notifications FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on alia_proactive_log" ON alia_proactive_log;
CREATE POLICY "Service role full access on alia_proactive_log"
  ON alia_proactive_log FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on alia_notification_prefs" ON alia_notification_prefs;
CREATE POLICY "Service role full access on alia_notification_prefs"
  ON alia_notification_prefs FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 036 — CADIN SENTINEL + INGESTOR
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cadin_sentinel_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  source TEXT NOT NULL,
  date_checked DATE NOT NULL,
  entries_found INT DEFAULT 0,
  changes_detected INT DEFAULT 0,
  new_suggestions INT DEFAULT 0,
  raw_log JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sentinel_logs_gabinete ON cadin_sentinel_logs(gabinete_id);
CREATE INDEX IF NOT EXISTS idx_sentinel_logs_date ON cadin_sentinel_logs(gabinete_id, date_checked);

CREATE TABLE IF NOT EXISTS cadin_pending_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  person_id UUID,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nomeacao','exoneracao','posse','substituicao',
    'aposentadoria','novo_cadastro','importacao_novo',
    'importacao_atualiza','importacao_ambiguo'
  )),
  campo TEXT,
  valor_atual TEXT,
  valor_novo TEXT,
  fonte TEXT NOT NULL,
  fonte_url TEXT,
  fonte_data DATE NOT NULL,
  trecho_original TEXT NOT NULL,
  confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado','editado')),
  revisado_por UUID,
  revisado_em TIMESTAMPTZ,
  notas_revisao TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_updates_gabinete ON cadin_pending_updates(gabinete_id);
CREATE INDEX IF NOT EXISTS idx_pending_updates_status ON cadin_pending_updates(gabinete_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_updates_person ON cadin_pending_updates(person_id);

CREATE TABLE IF NOT EXISTS cadin_ingest_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  esfera TEXT,
  status TEXT DEFAULT 'processando' CHECK (status IN ('processando','concluido','erro','parcial')),
  total_pages INT,
  pages_processed INT DEFAULT 0,
  records_found INT DEFAULT 0,
  records_new INT DEFAULT 0,
  records_update INT DEFAULT 0,
  records_ambiguous INT DEFAULT 0,
  error_log TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_gabinete ON cadin_ingest_jobs(gabinete_id);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON cadin_ingest_jobs(gabinete_id, status);

ALTER TABLE cadin_sentinel_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadin_pending_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadin_ingest_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on cadin_sentinel_logs" ON cadin_sentinel_logs;
CREATE POLICY "Service role full access on cadin_sentinel_logs"
  ON cadin_sentinel_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on cadin_pending_updates" ON cadin_pending_updates;
CREATE POLICY "Service role full access on cadin_pending_updates"
  ON cadin_pending_updates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on cadin_ingest_jobs" ON cadin_ingest_jobs;
CREATE POLICY "Service role full access on cadin_ingest_jobs"
  ON cadin_ingest_jobs FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 037 — WHATSAPP RECIPIENTS (multi-recipient with granular permissions)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gabinete_whatsapp_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,

  -- Identificação
  nome TEXT NOT NULL,
  cargo TEXT,                          -- 'Vereadora', 'Assessora', 'Líder de equipe', 'Atendente', etc.
  telefone TEXT NOT NULL,              -- E.164 sem +, ex: 5595991234567

  -- Permissões por tipo de evento (opt-in)
  -- Vazio = não recebe nada. NULL = recebe todos (fallback para admin).
  event_types_allowed TEXT[] DEFAULT '{}',

  -- Preferências de horário
  quiet_start TIME,                    -- Ex: '22:00'
  quiet_end TIME,                      -- Ex: '07:00'
  max_daily INT DEFAULT 20,
  digest_enabled BOOLEAN DEFAULT true, -- Recebe digest matinal?

  -- Estado
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID                      -- profile_id de quem cadastrou
);

-- Unique: mesmo telefone não pode ser cadastrado 2x no mesmo gabinete
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_recipients_unique
  ON gabinete_whatsapp_recipients(gabinete_id, telefone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_recipients_gabinete
  ON gabinete_whatsapp_recipients(gabinete_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_recipients_enabled
  ON gabinete_whatsapp_recipients(gabinete_id, enabled)
  WHERE enabled = true;

-- Trigger: impede mais de 5 recipients ativos por gabinete
CREATE OR REPLACE FUNCTION enforce_whatsapp_recipients_limit()
RETURNS TRIGGER AS $$
DECLARE
  active_count INT;
BEGIN
  IF NEW.enabled = true THEN
    SELECT COUNT(*) INTO active_count
    FROM gabinete_whatsapp_recipients
    WHERE gabinete_id = NEW.gabinete_id
      AND enabled = true
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF active_count >= 5 THEN
      RAISE EXCEPTION 'Limite de 5 recipients ativos por gabinete atingido. Desative algum antes de adicionar outro.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_whatsapp_recipients_limit ON gabinete_whatsapp_recipients;
CREATE TRIGGER trg_whatsapp_recipients_limit
  BEFORE INSERT OR UPDATE ON gabinete_whatsapp_recipients
  FOR EACH ROW EXECUTE FUNCTION enforce_whatsapp_recipients_limit();

-- Trigger: updated_at automático
CREATE OR REPLACE FUNCTION update_whatsapp_recipients_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_whatsapp_recipients_updated ON gabinete_whatsapp_recipients;
CREATE TRIGGER trg_whatsapp_recipients_updated
  BEFORE UPDATE ON gabinete_whatsapp_recipients
  FOR EACH ROW EXECUTE FUNCTION update_whatsapp_recipients_timestamp();

ALTER TABLE gabinete_whatsapp_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on gabinete_whatsapp_recipients" ON gabinete_whatsapp_recipients;
CREATE POLICY "Service role full access on gabinete_whatsapp_recipients"
  ON gabinete_whatsapp_recipients FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO FINAL
-- ═══════════════════════════════════════════════════════════════════════════════
-- Ao final, rode esta query para confirmar que tudo foi criado:
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN (
--   'alia_memory', 'email_intelligence',
--   'alia_notifications', 'alia_proactive_log', 'alia_notification_prefs',
--   'cadin_sentinel_logs', 'cadin_pending_updates', 'cadin_ingest_jobs',
--   'gabinete_whatsapp_recipients'
-- )
-- ORDER BY table_name;
--
-- Esperado: 9 linhas (todas as tabelas acima)
-- ═══════════════════════════════════════════════════════════════════════════════
