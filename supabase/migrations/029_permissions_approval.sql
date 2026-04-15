-- ============================================================
-- Migration 029 — Sistema de permissões granulares + aprovação
-- Adiciona campo permissions (JSONB) e approved (BOOLEAN)
-- à tabela profiles para controle de acesso por módulo.
-- 2026-03-31
-- ============================================================

-- 1. Adiciona campo de permissões granulares por módulo
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;

-- 2. Adiciona campo de aprovação (conta pendente ou aprovada)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT TRUE;

-- 3. Usuários existentes ficam todos aprovados (sem breaking change)
UPDATE profiles SET approved = TRUE WHERE approved IS NULL;

-- 4. Usuários existentes com role admin/vereador/assessor/superadmin
--    ganham permissão total (todas as flags TRUE)
UPDATE profiles
SET permissions = '{
  "dashboard": true,
  "pareceres": true,
  "agenda": true,
  "pls": true,
  "indicacoes": true,
  "oficios": true,
  "cadin": true,
  "sessoes": true,
  "alia": true,
  "configuracoes": true
}'::jsonb
WHERE role IN ('admin', 'vereador', 'assessor', 'superadmin')
  AND (permissions IS NULL OR permissions = '{}'::jsonb);

-- 5. Visitantes existentes ficam com tudo desligado por padrão
UPDATE profiles
SET permissions = '{
  "dashboard": false,
  "pareceres": false,
  "agenda": false,
  "pls": false,
  "indicacoes": false,
  "oficios": false,
  "cadin": false,
  "sessoes": false,
  "alia": false,
  "configuracoes": false
}'::jsonb
WHERE role = 'visitante'
  AND (permissions IS NULL OR permissions = '{}'::jsonb);

-- 6. Atualiza o trigger de criação de usuário para:
--    - Contas criadas via admin API (com full_name no metadata) = approved TRUE
--    - Contas self-signup (sem metadata especial) = approved FALSE (pendente)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, approved, permissions)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    -- Se criado via admin API, vem com _admin_created = true
    coalesce((new.raw_user_meta_data->>'_admin_created')::boolean, false),
    '{}'::jsonb
  );
  RETURN new;
END;
$$;

-- ============================================================
-- Estrutura do campo permissions (JSONB):
-- {
--   "dashboard": true/false,
--   "pareceres": true/false,
--   "agenda": true/false,
--   "pls": true/false,
--   "indicacoes": true/false,
--   "oficios": true/false,
--   "cadin": true/false,
--   "sessoes": true/false,
--   "alia": true/false,
--   "configuracoes": true/false
-- }
-- ============================================================
