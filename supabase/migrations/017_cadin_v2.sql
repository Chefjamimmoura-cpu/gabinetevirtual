-- ============================================================
-- Migration 017 — CADIN v2: Campos próprios para birthday,
--   nome parlamentar e chefe de gabinete.
--   Remove a dependência de parsear o campo de texto "notes".
-- ============================================================

-- 1. Colunas novas em cadin_persons
ALTER TABLE cadin_persons
  ADD COLUMN IF NOT EXISTS birthday     TEXT CHECK (birthday ~ '^\d{2}-\d{2}$'),  -- formato MM-DD
  ADD COLUMN IF NOT EXISTS nome_parlamentar TEXT,
  ADD COLUMN IF NOT EXISTS chefe_gabinete   TEXT;

-- 2. Backfill a partir do campo notes existente
UPDATE cadin_persons
SET
  birthday          = (regexp_match(notes, 'Aniversário: (\d{2}-\d{2})'))[1],
  nome_parlamentar  = trim((regexp_match(notes, 'Nome parlamentar: ([^;]+)'))[1]),
  chefe_gabinete    = trim((regexp_match(notes, 'Chefe de Gabinete: ([^;]+)'))[1])
WHERE notes IS NOT NULL;

-- 3. Índice para queries de aniversário (usado pelo widget diário)
CREATE INDEX IF NOT EXISTS cadin_persons_birthday_idx
  ON cadin_persons (gabinete_id, birthday)
  WHERE birthday IS NOT NULL;

-- 4. Coluna photo_url já existe — garantir constraint de URL válida (opcional)
-- (sem alteração: apenas documentamos que o campo está pronto para uso)

-- 5. Coluna dou_url em cadin_appointments — expor na UI
-- (já existia desde 002, apenas documentamos)

COMMENT ON COLUMN cadin_persons.birthday         IS 'Formato MM-DD. Ex: 03-25 = 25 de março.';
COMMENT ON COLUMN cadin_persons.nome_parlamentar IS 'Nome de tratamento/político do vereador ou autoridade.';
COMMENT ON COLUMN cadin_persons.chefe_gabinete   IS 'Nome do chefe de gabinete ou assessor principal.';
