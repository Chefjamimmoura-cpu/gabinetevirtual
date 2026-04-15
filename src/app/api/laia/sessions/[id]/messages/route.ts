// GET /api/laia/sessions/[id]/messages
// Retorna todas as mensagens de uma sessão em ordem cronológica.

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const db = supabase();

  // Verificar que a sessão pertence ao gabinete
  const { data: sessao } = await db
    .from('laia_sessions')
    .select('id')
    .eq('id', id)
    .eq('gabinete_id', GABINETE_ID)
    .single();

  if (!sessao) {
    return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  }

  const { data, error } = await db
    .from('laia_messages')
    .select('id, role, content, metadata, created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[laia/messages GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
