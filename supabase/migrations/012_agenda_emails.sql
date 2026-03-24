-- =============================================================================
-- Migration 012 — Agenda: tabela de cache para emails sincronizados via IMAP
-- Sprint V6 — Agenda Institucional com dados reais
-- =============================================================================

CREATE TABLE IF NOT EXISTS agenda_emails (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gabinete_id      UUID NOT NULL REFERENCES gabinetes(id) ON DELETE CASCADE,

  -- Qual das 5 contas do gabinete recebeu este email
  conta            TEXT NOT NULL
                   CHECK (conta IN ('oficial', 'agenda', 'pessoal', 'canais', 'comissao')),

  -- UID único do servidor IMAP (garante idempotência no sync)
  uid              TEXT NOT NULL,

  remetente        TEXT,
  assunto          TEXT,
  preview          TEXT,            -- primeiros 200 chars do corpo
  data_recebimento TIMESTAMPTZ,
  lido             BOOLEAN NOT NULL DEFAULT false,

  -- Se o email foi convertido em evento da agenda
  evento_criado_id UUID REFERENCES eventos(id) ON DELETE SET NULL,

  -- Headers brutos para debugging/futura extração de convites iCal
  raw_headers      JSONB NOT NULL DEFAULT '{}',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (gabinete_id, conta, uid)
);

CREATE INDEX IF NOT EXISTS idx_agenda_emails_gabinete
  ON agenda_emails (gabinete_id, conta, data_recebimento DESC);

CREATE INDEX IF NOT EXISTS idx_agenda_emails_nao_lidos
  ON agenda_emails (gabinete_id, lido) WHERE lido = false;

-- RLS
ALTER TABLE agenda_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agenda_emails: acesso ao próprio gabinete"
  ON agenda_emails FOR ALL
  USING (
    gabinete_id IN (
      SELECT gabinete_id FROM profiles WHERE id = auth.uid()
    )
  );
