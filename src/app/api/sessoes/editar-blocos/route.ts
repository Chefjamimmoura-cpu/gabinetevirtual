// POST /api/sessoes/editar-blocos — Persiste edições manuais (split/merge/rename) dos blocos

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

  let body: {
    sessao_id?: string;
    segments?: unknown[];
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }); }

  const { sessao_id, segments } = body;
  if (!sessao_id || !Array.isArray(segments)) {
    return NextResponse.json({ error: 'sessao_id e segments obrigatórios' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Buscar transcrição atual para preservar text e words
  const { data: sessao, error: fetchErr } = await supabase
    .from('sessoes_transcritas')
    .select('transcricao')
    .eq('id', sessao_id)
    .single();

  if (fetchErr || !sessao) {
    return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  }

  const transcricaoAtual = (sessao.transcricao as { text?: string; segments?: unknown[]; words?: unknown[] }) || {};
  const novaTranscricao = {
    ...transcricaoAtual,
    segments,
  };

  const { error: updateErr } = await supabase
    .from('sessoes_transcritas')
    .update({
      transcricao: novaTranscricao,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessao_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
