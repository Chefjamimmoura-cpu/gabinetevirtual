// GET /api/laia/sessions
// Lista sessões do gabinete com preview da última mensagem.
// Query: ?status=ativa&canal=whatsapp&limit=50

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

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const canal = searchParams.get('canal');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100);

  const db = supabase();

  let query = db
    .from('laia_sessions')
    .select(`
      id,
      canal,
      agente,
      telefone,
      contato_nome,
      status,
      assumido_por,
      assumido_em,
      ultima_msg_em,
      created_at,
      profiles!laia_sessions_assumido_por_fkey (
        full_name
      ),
      laia_messages (
        role,
        content,
        created_at
      )
    `)
    .eq('gabinete_id', GABINETE_ID)
    .order('ultima_msg_em', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (canal) query = query.eq('canal', canal);

  const { data, error } = await query;

  if (error) {
    console.error('[laia/sessions GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enriquecer: última mensagem preview + contagem
  const sessoes = (data ?? []).map((s: any) => {
    const msgs: any[] = s.laia_messages ?? [];
    const ultima = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const { laia_messages: _, profiles: prof, ...base } = s;

    return {
      ...base,
      assumido_por_nome: prof?.full_name ?? null,
      total_msgs: msgs.length,
      ultima_msg_preview: ultima
        ? ultima.content.slice(0, 100) + (ultima.content.length > 100 ? '...' : '')
        : null,
      ultima_msg_role: ultima?.role ?? null,
    };
  });

  return NextResponse.json(sessoes);
}
