// POST /api/alia/sessions/[id]/release
// Devolve a conversa à IA. LAIA volta a responder automaticamente.
// Body: { mensagem_retorno?: string }  — opcional, LAIA envia aviso ao usuário

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

  const { mensagem_retorno } = await req.json().catch(() => ({}));

  const { data: sessao } = await db
    .from('laia_sessions')
    .select('id, status, canal, telefone')
    .eq('id', id)
    .eq('gabinete_id', GABINETE_ID)
    .single();

  if (!sessao) {
    return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  }

  const agora = new Date().toISOString();

  await db
    .from('laia_sessions')
    .update({
      status: 'ativa',
      assumido_por: null,
      assumido_em: null,
      ultima_msg_em: agora,
    })
    .eq('id', id);

  // Registrar evento de sistema
  await db.from('laia_messages').insert({
    session_id: id,
    role: 'system',
    content: '🤖 A conversa foi devolvida à LAIA.',
    metadata: { evento: 'release', timestamp: agora },
  });

  // Se solicitado, enviar mensagem de aviso via WhatsApp
  if (mensagem_retorno && sessao.canal === 'whatsapp' && sessao.telefone) {
    try {
      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instance = process.env.EVOLUTION_INSTANCE;

      if (evolutionUrl && evolutionKey && instance) {
        await fetch(`${evolutionUrl}/message/sendText/${instance}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': evolutionKey,
          },
          body: JSON.stringify({
            number: sessao.telefone,
            text: mensagem_retorno,
          }),
        });
      }
    } catch (err) {
      console.error('[alia/release] erro ao enviar mensagem WhatsApp:', err);
      // não bloqueia o release
    }
  }

  return NextResponse.json({
    ok: true,
    session_id: id,
    status: 'ativa',
  });
}
