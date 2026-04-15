-- ============================================================
-- Migration 016 — Roles: superadmin + visitante
-- Expande o CHECK constraint de profiles.role para suportar
-- acesso de super administrador e modo visitante (demo).
-- 2026-03-17
-- ============================================================

-- 1. Expande o CHECK constraint de role
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'vereador', 'assessor', 'superadmin', 'visitante'));

-- 2. Promove o usuário jamim.moura@gmail.com para superadmin
UPDATE profiles SET role = 'superadmin'
  WHERE email = 'jamim.moura@gmail.com';

-- ============================================================
-- Para criar o usuário visitante, use o painel Superadmin
-- ou execute via Supabase Auth API / Dashboard.
-- ============================================================
