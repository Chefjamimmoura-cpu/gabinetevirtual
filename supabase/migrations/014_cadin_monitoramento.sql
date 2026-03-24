-- =============================================================================
-- Migration 014 — CADIN: Monitoramento automático de Diários Oficiais
-- Sprint V7 — CADIN como produto independente + atualizações automáticas
-- =============================================================================
--
-- Fluxo:
-- 1. Cron diário raspa DOs (estado, município, DJE) e fontes de notícias locais
-- 2. Gemini extrai possíveis mudanças de cargo/posse/exoneração
-- 3. Proposta fica pendente em cadin_pending_updates
-- 4. Assessor (ou ALIA) modera: aprova/rejeita com um clique
-- 5. Se aprovado, campos do CADIN são atualizados automaticamente
-- =============================================================================

-- ── Fontes monitoradas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cadin_monitor_sources (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gabinete_id   UUID NOT NULL REFERENCES gabinetes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                -- "Diário Oficial do Estado de RR"
  url           TEXT NOT NULL,               -- URL base para varredura
  source_type   TEXT NOT NULL DEFAULT 'diario_oficial'
                CHECK (source_type IN (
                  'diario_oficial_estado',
                  'diario_oficial_municipio',
                  'dje_tj',
                  'noticias_locais',
                  'portal_transparencia',
                  'outros'
                )),
  active        BOOLEAN NOT NULL DEFAULT true,
  last_checked  TIMESTAMPTZ,
  check_pattern TEXT,   -- seletor CSS / XPath / regex para extrair o texto relevante
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Atualização pendente (aguardando moderação do assessor) ──────────────────
CREATE TABLE IF NOT EXISTS cadin_pending_updates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gabinete_id       UUID NOT NULL REFERENCES gabinetes(id) ON DELETE CASCADE,
  source_id         UUID REFERENCES cadin_monitor_sources(id) ON DELETE SET NULL,

  -- Tipo de alteração detectada
  update_type       TEXT NOT NULL
                    CHECK (update_type IN (
                      'nova_nomecao',       -- nova posse/nomeação
                      'exoneracao',         -- saída do cargo
                      'mudanca_cargo',      -- mesmo titular, cargo diferente
                      'novo_orgao',         -- órgão novo criado/reestruturado
                      'dado_contato',       -- atualização de telefone/email
                      'aniversario',        -- data de aniversário encontrada
                      'outros'
                    )),

  -- Entidade impactada (opcional — pode ser inferida pelo Gemini)
  person_id         UUID REFERENCES cadin_persons(id) ON DELETE SET NULL,
  organization_id   UUID REFERENCES cadin_organizations(id) ON DELETE SET NULL,

  -- O que o Gemini encontrou
  extracted_text    TEXT NOT NULL,          -- trecho bruto do DO/notícia
  source_url        TEXT,                   -- URL exata da fonte
  source_date       DATE,                   -- data de publicação
  suggested_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Ex: {"full_name": "João Silva", "title": "Secretário de Finanças", "org_name": "SEFAZ"}
  confidence        NUMERIC(3,2),           -- 0.00–1.00 (confiança do Gemini)
  gemini_summary    TEXT,                   -- resumo em linguagem natural

  -- Moderação
  status            TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'aplicado')),
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_notes      TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cadin_pending_gabinete_status
  ON cadin_pending_updates (gabinete_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS cadin_pending_person
  ON cadin_pending_updates (person_id) WHERE person_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE cadin_monitor_sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadin_pending_updates  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cadin_monitor_sources_all"
  ON cadin_monitor_sources FOR ALL
  USING (gabinete_id IN (SELECT gabinete_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "cadin_pending_updates_all"
  ON cadin_pending_updates FOR ALL
  USING (gabinete_id IN (SELECT gabinete_id FROM profiles WHERE id = auth.uid()));

-- ── Fontes padrão para Roraima (pré-populadas) ───────────────────────────────
-- Execute após rodar esta migration, substituindo {{GABINETE_ID}}:
--
-- INSERT INTO cadin_monitor_sources (gabinete_id, name, url, source_type) VALUES
--   ('{{GABINETE_ID}}', 'Diário Oficial do Estado de RR', 'https://www.doe.rr.gov.br', 'diario_oficial_estado'),
--   ('{{GABINETE_ID}}', 'Diário Oficial de Boa Vista',    'https://boavista.rr.gov.br/diario-oficial', 'diario_oficial_municipio'),
--   ('{{GABINETE_ID}}', 'DJE — TJ-RR',                   'https://dje.tjrr.jus.br', 'dje_tj'),
--   ('{{GABINETE_ID}}', 'Folha de Boa Vista',             'https://folhabv.com.br', 'noticias_locais'),
--   ('{{GABINETE_ID}}', 'G1 Roraima',                     'https://g1.globo.com/rr', 'noticias_locais');
