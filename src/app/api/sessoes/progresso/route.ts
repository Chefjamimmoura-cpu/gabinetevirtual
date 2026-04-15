// GET /api/sessoes/progresso — Retorna sessões ativas com progresso para polling

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('sessoes_transcritas')
    .select('id, titulo, status, progresso_pct, progresso_etapa, error_msg, created_at')
    .in('status', ['processando', 'transcrevendo'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessoes: data || [] });
}
