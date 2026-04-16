-- 040_gabinete_evolution_instances.sql
-- Tabela para armazenar a instância Evolution API de cada gabinete (multi-tenant).

CREATE TABLE IF NOT EXISTS gabinete_evolution_instances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id         UUID NOT NULL UNIQUE REFERENCES gabinetes(id) ON DELETE CASCADE,
  instance_name       TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'disconnected',
  qr_base64           TEXT,
  qr_expires_at       TIMESTAMPTZ,
  phone_number        TEXT,
  profile_name        TEXT,
  profile_picture_url TEXT,
  last_connected_at   TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evo_instances_name ON gabinete_evolution_instances(instance_name);
CREATE INDEX IF NOT EXISTS idx_evo_instances_status ON gabinete_evolution_instances(status);

ALTER TABLE gabinete_evolution_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_gabinete_read" ON gabinete_evolution_instances;
CREATE POLICY "admin_gabinete_read" ON gabinete_evolution_instances
  FOR SELECT USING (
    gabinete_id = (SELECT gabinete_id FROM profiles WHERE id = auth.uid())
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'superadmin'
  );

DROP POLICY IF EXISTS "admin_gabinete_write" ON gabinete_evolution_instances;
CREATE POLICY "admin_gabinete_write" ON gabinete_evolution_instances
  FOR ALL USING (
    gabinete_id = (SELECT gabinete_id FROM profiles WHERE id = auth.uid())
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'superadmin'
  );

-- Realtime para UI
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gabinete_evolution_instances'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE gabinete_evolution_instances';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION tg_evo_instances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evo_instances_updated_at ON gabinete_evolution_instances;
CREATE TRIGGER evo_instances_updated_at
  BEFORE UPDATE ON gabinete_evolution_instances
  FOR EACH ROW EXECUTE FUNCTION tg_evo_instances_updated_at();

-- Seed: continuidade do gabinete da Carol
INSERT INTO gabinete_evolution_instances (gabinete_id, instance_name, status)
SELECT id, 'gabinete-carol', 'disconnected'
FROM gabinetes
WHERE id = 'f25299db-1c33-45b9-830f-82f6d2d666ef'
ON CONFLICT (gabinete_id) DO NOTHING;
