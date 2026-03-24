-- ============================================================
-- Migration 009 — Indicações V2
-- Amplia a tabela indicacoes para suportar:
--   • Integração com Fala Cidadão (Impacto SaaS)
--   • Campos de campo (bairro, logradouro, setores, fotos)
--   • Geração de documento IA (documento_gerado_md)
--   • Auto-protocolo SAPL (protocolado_em, sapl_proposicao_id)
-- ============================================================

ALTER TABLE indicacoes
  -- Integração Fala Cidadão
  ADD COLUMN IF NOT EXISTS fala_cidadao_id      TEXT,
  ADD COLUMN IF NOT EXISTS fala_cidadao_status  TEXT,            -- PENDING | INVESTIGATING | ACCEPTED | REJECTED
  ADD COLUMN IF NOT EXISTS fala_cidadao_slug    TEXT,

  -- Dados de campo
  ADD COLUMN IF NOT EXISTS responsavel_nome     TEXT,            -- agente que coletou a indicação
  ADD COLUMN IF NOT EXISTS logradouro           TEXT,            -- rua/avenida/travessa
  ADD COLUMN IF NOT EXISTS setores              TEXT[],          -- ['Asfalto','Limpeza','Drenagem',...]
  ADD COLUMN IF NOT EXISTS classificacao        TEXT,            -- 'necessidade' | 'prioridade' | 'urgencia'
  ADD COLUMN IF NOT EXISTS fotos_urls           TEXT[],          -- links para fotos do local
  ADD COLUMN IF NOT EXISTS observacoes          TEXT,            -- notas livres do agente

  -- Geração de documento IA
  ADD COLUMN IF NOT EXISTS documento_gerado_md  TEXT,            -- markdown da indicação gerada pelo Gemini
  ADD COLUMN IF NOT EXISTS documento_ementa     TEXT,            -- ementa extraída do documento gerado

  -- Auto-protocolo SAPL
  ADD COLUMN IF NOT EXISTS protocolado_em       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sapl_proposicao_id   INTEGER,
  ADD COLUMN IF NOT EXISTS sapl_numero          TEXT;            -- ex: "IND 123/2026"

-- Índices para filtros comuns no dashboard
CREATE INDEX IF NOT EXISTS indicacoes_fala_cidadao_id_idx  ON indicacoes(fala_cidadao_id);
CREATE INDEX IF NOT EXISTS indicacoes_responsavel_idx      ON indicacoes(gabinete_id, responsavel_nome);
CREATE INDEX IF NOT EXISTS indicacoes_classificacao_idx    ON indicacoes(gabinete_id, classificacao);
CREATE INDEX IF NOT EXISTS indicacoes_status_idx           ON indicacoes(gabinete_id, status);
CREATE INDEX IF NOT EXISTS indicacoes_bairro_idx           ON indicacoes(gabinete_id, bairro);

-- Garantir unicidade fala_cidadao_id por gabinete (permite NULL)
CREATE UNIQUE INDEX IF NOT EXISTS indicacoes_fc_unique_idx
  ON indicacoes(gabinete_id, fala_cidadao_id)
  WHERE fala_cidadao_id IS NOT NULL;

-- Comentários
COMMENT ON COLUMN indicacoes.fala_cidadao_id IS 'ID da solicitação na plataforma Fala Cidadão (Impacto SaaS)';
COMMENT ON COLUMN indicacoes.fala_cidadao_status IS 'Status no Fala Cidadão: PENDING | INVESTIGATING | ACCEPTED | REJECTED';
COMMENT ON COLUMN indicacoes.responsavel_nome IS 'Nome do agente de campo responsável pela coleta';
COMMENT ON COLUMN indicacoes.setores IS 'Array de setores de interesse: Asfalto, Limpeza, Drenagem, etc.';
COMMENT ON COLUMN indicacoes.classificacao IS 'Nível de urgência: necessidade | prioridade | urgencia';
COMMENT ON COLUMN indicacoes.fotos_urls IS 'Array de URLs das fotos tiradas no local';
COMMENT ON COLUMN indicacoes.documento_gerado_md IS 'Texto da indicação parlamentar gerado por IA no formato SAPL';
COMMENT ON COLUMN indicacoes.documento_ementa IS 'Ementa extraída do documento gerado (usado na protocolação)';
COMMENT ON COLUMN indicacoes.protocolado_em IS 'Data/hora em que a indicação foi protocolada no SAPL';
COMMENT ON COLUMN indicacoes.sapl_proposicao_id IS 'ID da proposição no SAPL após protocolo';
COMMENT ON COLUMN indicacoes.sapl_numero IS 'Número formatado no SAPL, ex: IND 123/2026';
