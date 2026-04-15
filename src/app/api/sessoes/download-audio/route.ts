// POST /api/sessoes/download-audio — Gera URL assinada para download do áudio
// Usuário baixa antes do timebomb de 30 dias expirar.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { sessao_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }); }

  const { sessao_id } = body;
  if (!sessao_id) return NextResponse.json({ error: 'sessao_id obrigatório' }, { status: 400 });

  const supabase = getSupabase();

  const { data: sessao, error } = await supabase
    .from('sessoes_transcritas')
    .select('titulo, audio_storage_path, audio_expira_em')
    .eq('id', sessao_id)
    .single();

  if (error || !sessao) {
    return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  }

  if (!sessao.audio_storage_path) {
    return NextResponse.json({
      error: 'Áudio não disponível — já foi removido ou nunca foi salvo',
    }, { status: 404 });
  }

  // URL assinada válida por 1 hora, com download direto
  const slug = (sessao.titulo || 'sessao')
    .replace(/[^a-zA-Z0-9À-ÿ _-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 60);

  const { data: signed, error: signErr } = await supabase.storage
    .from('gabinete_media')
    .createSignedUrl(sessao.audio_storage_path, 3600, {
      download: `${slug}.mp3`,
    });

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({
      error: signErr?.message || 'Falha ao gerar URL de download',
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    url: signed.signedUrl,
    filename: `${slug}.mp3`,
    expira_em: sessao.audio_expira_em,
  });
}
