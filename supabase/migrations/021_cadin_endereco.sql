-- Migration para adicionar endereço ao CADIN (v2.1)
ALTER TABLE cadin_persons
ADD COLUMN IF NOT EXISTS endereco TEXT;
