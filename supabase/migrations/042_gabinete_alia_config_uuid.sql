-- 042_gabinete_alia_config_uuid.sql
-- Migra gabinete_id de TEXT para UUID em gabinete_alia_config e alia_task_queue.
-- Em prod o ALTER já pode ter sido aplicado manualmente — esta migration é
-- idempotente no caminho feliz: USING gabinete_id::uuid funciona se a coluna
-- já é uuid (cast no-op) ou se contém strings UUID válidas.
--
-- Limpeza prévia: remove rows com valores não-UUID (ex: seed antigo
-- 'carol-dantas-cmbv') que de outra forma fariam o ALTER falhar.
--
-- Refs:
--   - 039_alia_autonoma.sql criou as colunas como TEXT
--   - Após migração para self-hosted, gabinete_id padronizou em UUID

BEGIN;

-- ── Limpeza de seed/dados não-UUID antes do ALTER ──────────────────────────
DELETE FROM gabinete_alia_config
WHERE gabinete_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

DELETE FROM alia_task_queue
WHERE gabinete_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- ── ALTER TYPE TEXT → UUID ─────────────────────────────────────────────────
-- ALTER COLUMN ... TYPE com USING é seguro re-executar quando a coluna já é uuid:
-- Postgres detecta no-op e não toca na tabela. Se ainda for text, faz o cast.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'gabinete_alia_config' AND column_name = 'gabinete_id') = 'text' THEN
    ALTER TABLE gabinete_alia_config
      ALTER COLUMN gabinete_id TYPE uuid USING gabinete_id::uuid;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'alia_task_queue' AND column_name = 'gabinete_id') = 'text' THEN
    ALTER TABLE alia_task_queue
      ALTER COLUMN gabinete_id TYPE uuid USING gabinete_id::uuid;
  END IF;
END $$;

-- ── Reseed do gabinete padrão (Carol Dantas / CMBV) com UUID real ─────────
-- f25299db-1c33-45b9-830f-82f6d2d666ef = id do gabinete em gabinetes(id)
INSERT INTO gabinete_alia_config (gabinete_id, notify_ordem_dia, notify_materia_comissao)
VALUES ('f25299db-1c33-45b9-830f-82f6d2d666ef', true, true)
ON CONFLICT (gabinete_id) DO NOTHING;

COMMIT;
