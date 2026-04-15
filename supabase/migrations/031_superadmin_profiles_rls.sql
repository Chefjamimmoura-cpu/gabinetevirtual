-- ============================================================
-- Migration 031 — RLS: superadmin pode ver e editar todos os profiles
-- Permite que o painel /superadmin liste e gerencie todos os usuários.
-- 2026-03-31
-- ============================================================

-- 1. Superadmin pode LER todos os profiles
CREATE POLICY "profiles: superadmin lê todos"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );

-- 2. Superadmin pode ATUALIZAR qualquer profile (role, permissões, aprovação)
CREATE POLICY "profiles: superadmin atualiza todos"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );

-- 3. Superadmin pode DELETAR profiles (rejeitar contas pendentes)
CREATE POLICY "profiles: superadmin deleta"
  ON profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );
