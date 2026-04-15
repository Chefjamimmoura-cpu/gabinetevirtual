// GET /api/sessoes/listar
// Lista sessões transcritas do gabinete (paginado)

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

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('per_page') || '20');
  const gabineteId = searchParams.get('gabinete_id') || process.env.GABINETE_ID;

  const supabase = getSupabase();

  let query = supabase
    .from('sessoes_transcritas')
    .select('id, titulo, data_sessao, duracao_segundos, fonte, status, error_msg, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (gabineteId) query = query.eq('gabinete_id', gabineteId);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    sessoes: data || [],
    total: count || 0,
    page,
    total_pages: Math.ceil((count || 0) / perPage),
  });
}
