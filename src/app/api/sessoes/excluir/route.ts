// POST /api/sessoes/excluir
// Exclui uma sessão transcrita pelo ID
// Body: { sessao_id: string }

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

  // Remover áudio do storage se existir
  const { data: sessao } = await supabase
    .from('sessoes_transcritas')
    .select('audio_storage_path')
    .eq('id', sessao_id)
    .single();

  if (sessao?.audio_storage_path) {
    await supabase.storage.from('gabinete_media').remove([sessao.audio_storage_path]);
  }

  const { error } = await supabase
    .from('sessoes_transcritas')
    .delete()
    .eq('id', sessao_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
