-- 015_relatoria_settings_and_history.sql
-- Migration para adicionar as configurações de relatoria no gabinete e criar a tabela de histórico de pareceres gerados pela relatoria.

-- 1. Adicionar comissões de relatoria ao gabinete (array de siglas)
ALTER TABLE public.gabinetes
ADD COLUMN IF NOT EXISTS comissoes_relatoria TEXT[] DEFAULT '{}'::TEXT[];

-- 2. Tabela para salvar os pareceres de relator gerados
CREATE TABLE IF NOT EXISTS public.pareceres_relator (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gabinete_id UUID NOT NULL REFERENCES public.gabinetes(id) ON DELETE CASCADE,
  materia_id INTEGER NOT NULL,
  materia_tipo TEXT,
  commission_sigla TEXT NOT NULL,
  relator_nome TEXT NOT NULL,
  voto TEXT NOT NULL,
  texto_gerado TEXT NOT NULL,
  model_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE public.pareceres_relator ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso para a tabela pareceres_relator
CREATE POLICY "Usuários podem ver pareceres de relator do seu gabinete"
  ON public.pareceres_relator FOR SELECT
  USING (
    gabinete_id IN (
      SELECT gabinete_id FROM public.profiles WHERE profiles.id = auth.uid()
    )
  );

CREATE POLICY "Usuários podem inserir pareceres de relator no seu gabinete"
  ON public.pareceres_relator FOR INSERT
  WITH CHECK (
    gabinete_id IN (
      SELECT gabinete_id FROM public.profiles WHERE profiles.id = auth.uid()
    )
  );

-- Garantir que roles de sistema possam gerenciar (service_role)
CREATE POLICY "Service Role tem permissão total"
  ON public.pareceres_relator FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');
