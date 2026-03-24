-- Migration 018: Add photo_url to cadin_persons and create storage bucket

-- Adiciona a coluna photo_url
ALTER TABLE cadin_persons ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Cria o bucket cadin-photos com acesso público
INSERT INTO storage.buckets (id, name, public) 
VALUES ('cadin-photos', 'cadin-photos', true) 
ON CONFLICT (id) DO NOTHING;

-- Policies
CREATE POLICY "Public Access cadin-photos" 
ON storage.objects FOR SELECT 
USING ( bucket_id = 'cadin-photos' );

CREATE POLICY "Auth Insert cadin-photos" 
ON storage.objects FOR INSERT 
WITH CHECK ( bucket_id = 'cadin-photos' AND auth.role() = 'authenticated' );

CREATE POLICY "Auth Update cadin-photos" 
ON storage.objects FOR UPDATE 
USING ( bucket_id = 'cadin-photos' AND auth.role() = 'authenticated' );
