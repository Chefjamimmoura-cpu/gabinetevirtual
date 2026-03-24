-- 020_relator_nome_padrao.sql
-- Adiciona o nome padrão do relator ao gabinete, para pré-popular
-- o campo "Relator" na aba Relatoria do módulo de Pareceres.

ALTER TABLE public.gabinetes
  ADD COLUMN IF NOT EXISTS relator_nome_padrao TEXT;

COMMENT ON COLUMN public.gabinetes.relator_nome_padrao IS
  'Nome completo do relator padrão do gabinete (ex: Vereadora Carol Dantas). '
  'Pré-popula o campo Relator na aba Relatoria de Pareceres.';
