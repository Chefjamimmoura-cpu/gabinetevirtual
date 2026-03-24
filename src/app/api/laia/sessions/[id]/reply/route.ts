// POST /api/laia/sessions/[id]/reply
// Assessor envia uma mensagem manual durante o modo de takeover humano.
// Se canal=whatsapp, a mensagem é enviada via Evolution API.
// A mensagem é salva como role='human_agent' no histórico.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  const { id } = await params;
  const db = supabase();

  let body: { content: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  if (!body.content?.trim()) {
    return NextResponse.json({ error: 'content é obrigatório' }, { status: 400 });
  }

  // Verificar que a sessão pertence ao gabinete e está em modo humano
  const { data: sessao } = await db
    .from('laia_sessions')
    .select('id, status, canal, telefone')
    .eq('id', id)
    .eq('gabinete_id', GABINETE_ID)
    .single();

  if (!sessao) {
    return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  }

  if (sessao.status !== 'humano') {
    return NextResponse.json(
      { error: 'Só é possível responder manualmente quando a sessão está em modo takeover (status: humano)' },
      { status: 409 },
    );
  }

  const agora = new Date().toISOString();

  // Salvar mensagem do assessor
  const { data: msg, error: msgErr } = await db
    .from('laia_messages')
    .insert({
      session_id: id,
      role: 'human_agent',
      content: body.content,
      metadata: { via: 'dashboard' },
    })
    .select('id, created_at')
    .single();

  if (msgErr) {
    console.error('[laia/reply]', msgErr);
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  await db.from('laia_sessions').update({ ultima_msg_em: agora }).eq('id', id);

  // Se canal WhatsApp, enviar via Evolution API
  let enviado_whatsapp = false;
  if (sessao.canal === 'whatsapp' && sessao.telefone) {
    try {
      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instance = process.env.EVOLUTION_INSTANCE;

      if (evolutionUrl && evolutionKey && instance) {
        const resp = await fetch(`${evolutionUrl}/message/sendText/${instance}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': evolutionKey,
          },
          body: JSON.stringify({
            number: sessao.telefone,
            text: body.content,
          }),
        });
        enviado_whatsapp = resp.ok;
      }
    } catch (err) {
      console.error('[laia/reply] erro Evolution API:', err);
      // não bloqueia — mensagem já foi salva no histórico
    }
  }

  return NextResponse.json({
    ok: true,
    message_id: msg.id,
    role: 'human_agent',
    enviado_whatsapp,
    created_at: msg.created_at,
  });
}
