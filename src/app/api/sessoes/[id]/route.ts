// GET /api/sessoes/[id]
// Retorna uma sessão transcrita pelo ID

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(_req);
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sessoes_transcritas')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  }

  // Gerar URL assinada do áudio (válida 2h, funciona com bucket privado ou público)
  let audioUrl: string | null = null;
  if (data.audio_storage_path) {
    const { data: signed } = await supabase.storage
      .from('gabinete_media')
      .createSignedUrl(data.audio_storage_path, 7200); // 2h
    audioUrl = signed?.signedUrl || null;
    // Fallback para URL pública se signed falhar (bucket público)
    if (!audioUrl) {
      const { data: publicUrl } = supabase.storage
        .from('gabinete_media')
        .getPublicUrl(data.audio_storage_path);
      audioUrl = publicUrl?.publicUrl || null;
    }
  }

  return NextResponse.json({ ...data, audio_url: audioUrl });
}
