-- 037_whatsapp_recipients.sql
-- Multi-recipient WhatsApp com permissões granulares por tipo de evento.
-- Até 5 recipients ativos por gabinete. Cada um pode receber apenas
-- os event_types configurados no array event_types_allowed.

CREATE TABLE IF NOT EXISTS gabinete_whatsapp_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,

  -- Identificação
  nome TEXT NOT NULL,
  cargo TEXT,
  telefone TEXT NOT NULL,

  -- Permissões por tipo de evento (opt-in)
  -- Vazio = não recebe nada. NULL = recebe todos.
  event_types_allowed TEXT[] DEFAULT '{}',

  -- Preferências de horário
  quiet_start TIME,
  quiet_end TIME,
  max_daily INT DEFAULT 20,
  digest_enabled BOOLEAN DEFAULT true,

  -- Estado
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID
);

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
      RAISE EXCEPTION 'Limite de 5 recipients ativos por gabinete atingido.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_whatsapp_recipients_limit ON gabinete_whatsapp_recipients;
CREATE TRIGGER trg_whatsapp_recipients_limit
  BEFORE INSERT OR UPDATE ON gabinete_whatsapp_recipients
  FOR EACH ROW EXECUTE FUNCTION enforce_whatsapp_recipients_limit();

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
