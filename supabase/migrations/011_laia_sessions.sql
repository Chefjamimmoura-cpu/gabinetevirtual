-- =============================================================================
-- Migration 011 — LAIA: Centro de Comando da IA
-- Sprint V5-F2 — Monitoramento, chat interno e Human Takeover
-- =============================================================================

-- ─── Sessões de conversa ────────────────────────────────────────────────────
-- Cada sessão representa uma conversa contínua, seja pelo WhatsApp ou
-- pelo chat interno do dashboard.

CREATE TABLE IF NOT EXISTS laia_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gabinete_id     UUID NOT NULL REFERENCES gabinetes(id) ON DELETE CASCADE,
  canal           TEXT NOT NULL CHECK (canal IN ('whatsapp', 'interno')),
  agente          TEXT NOT NULL DEFAULT 'laia'
                  CHECK (agente IN ('laia', 'cadin')),
  telefone        TEXT,                        -- número WhatsApp (+55...)
  contato_nome    TEXT,                        -- nome identificado do contato
  status          TEXT NOT NULL DEFAULT 'ativa'
                  CHECK (status IN ('ativa', 'humano', 'encerrada')),
  assumido_por    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assumido_em     TIMESTAMPTZ,
  ultima_msg_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Mensagens ───────────────────────────────────────────────────────────────
-- Histórico completo de cada sessão. Role distingue quem enviou.

CREATE TABLE IF NOT EXISTS laia_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES laia_sessions(id) ON DELETE CASCADE,
  -- 'user'        = mensagem do cidadão/usuário externo
  -- 'assistant'   = resposta da IA (LAIA ou CADIN agent)
  -- 'human_agent' = resposta manual de um assessor em modo takeover
  -- 'system'      = evento de sistema (ex: "Assessor X assumiu a conversa")
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'human_agent', 'system')),
  content     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',    -- tokens, model, evolution_id, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Índices ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_laia_sessions_gabinete ON laia_sessions (gabinete_id, status, ultima_msg_em DESC);
CREATE INDEX IF NOT EXISTS idx_laia_sessions_telefone ON laia_sessions (gabinete_id, telefone) WHERE telefone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_laia_messages_session ON laia_messages (session_id, created_at ASC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE laia_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE laia_messages ENABLE ROW LEVEL SECURITY;

-- Acesso restrito ao próprio gabinete (via profile)
CREATE POLICY "laia_sessions: acesso ao próprio gabinete"
  ON laia_sessions FOR ALL
  USING (
    gabinete_id IN (
      SELECT gabinete_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "laia_messages: acesso via sessão do gabinete"
  ON laia_messages FOR ALL
  USING (
    session_id IN (
      SELECT ls.id FROM laia_sessions ls
      JOIN profiles p ON p.gabinete_id = ls.gabinete_id
      WHERE p.id = auth.uid()
    )
  );

-- ─── Realtime (habilitar publicação) ─────────────────────────────────────────
-- Adicionar as tabelas à publicação realtime do Supabase para que o
-- frontend receba atualizações instantâneas sem polling.
-- ATENÇÃO: executar apenas se a publicação 'supabase_realtime' já existir.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE laia_sessions;
    ALTER PUBLICATION supabase_realtime ADD TABLE laia_messages;
  END IF;
END;
$$;
