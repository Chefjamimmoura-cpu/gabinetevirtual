// POST /api/sessoes/editar-pontos-chave
//
// Substitui a lista de pontos-chave de uma sessão. Usado tanto pra
// adicionar marcações manuais quanto pra remover sugestões/marcações.
// O frontend envia o array completo já com a mudança aplicada.

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

  let body: { sessao_id?: string; pontos_chave?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { sessao_id, pontos_chave } = body;
  if (!sessao_id || !Array.isArray(pontos_chave)) {
    return NextResponse.json({ error: 'sessao_id e pontos_chave obrigatórios' }, { status: 400 });
  }

  const supabase = getSupabase();

  const { error: updateErr } = await supabase
    .from('sessoes_transcritas')
    .update({
      pontos_chave,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessao_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
