-- 034_email_intelligence.sql
-- Email intelligence: triagem, enrichment, suggested actions for ALIA.

CREATE TABLE IF NOT EXISTS email_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  email_id UUID NOT NULL,

  -- Triagem
  urgency TEXT NOT NULL CHECK (urgency IN ('critica','alta','media','baixa','spam')),
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  requires_action BOOLEAN DEFAULT false,
  action_deadline TIMESTAMPTZ,
  sentiment TEXT CHECK (sentiment IN ('positivo','neutro','negativo','formal')),

  -- Enriquecimento cross-módulo
  cadin_person_id UUID,
  materia_id TEXT,
  indicacao_id UUID,

  -- Ações sugeridas
  suggested_actions JSONB DEFAULT '[]',

  -- Status
  action_taken TEXT,
  action_taken_by UUID,
  action_taken_at TIMESTAMPTZ,

  processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_email_intel_gabinete ON email_intelligence(gabinete_id);
CREATE INDEX idx_email_intel_urgency ON email_intelligence(gabinete_id, urgency);
CREATE INDEX idx_email_intel_email ON email_intelligence(email_id);
CREATE INDEX idx_email_intel_requires ON email_intelligence(gabinete_id, requires_action)
  WHERE requires_action = true;

ALTER TABLE email_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on email_intelligence"
  ON email_intelligence FOR ALL
  USING (true)
  WITH CHECK (true);
