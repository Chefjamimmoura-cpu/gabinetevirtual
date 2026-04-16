// POST /api/laia/sessions/[id]/takeover
// Assessor assume controle da conversa. A partir deste momento,
// o webhook da ALIA não responde automaticamente nessa sessão.
//
// NOTA: Em produção, o profile_id deve vir do JWT da sessão autenticada.
// Por ora usa GABINETE_ID como referência — a autenticação formal
// será adicionada quando NextAuth estiver configurado.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const db = supabase();

  // Verificar que a sessão pertence ao gabinete e está ativa
  const { data: sessao } = await db
    .from('laia_sessions')
    .select('id, status, canal, telefone')
    .eq('id', id)
    .eq('gabinete_id', GABINETE_ID)
    .single();

  if (!sessao) {
    return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  }

  if (sessao.status === 'humano') {
    return NextResponse.json({ error: 'Sessão já está em modo humano' }, { status: 409 });
  }

  const agora = new Date().toISOString();

  // Atualizar status para 'humano'
  const { error } = await db
    .from('laia_sessions')
    .update({ status: 'humano', assumido_em: agora })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Registrar evento de sistema na conversa
  await db.from('laia_messages').insert({
    session_id: id,
    role: 'system',
    content: '👤 Um assessor assumiu o controle da conversa.',
    metadata: { evento: 'takeover', timestamp: agora },
  });

  await db.from('laia_sessions').update({ ultima_msg_em: agora }).eq('id', id);

  return NextResponse.json({
    ok: true,
    session_id: id,
    status: 'humano',
    assumido_em: agora,
  });
}
