// GET /api/cadin/do-jobs  — lista fila de processamento de D.O.
// POST /api/cadin/do-jobs — enfileira manualmente um PDF por URL

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, isCronAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status'); // pending | processing | done | error | null (todos)
  const limit  = Math.min(50, parseInt(searchParams.get('limit') ?? '20'));

  let q = db()
    .from('cadin_do_jobs')
    .select('id,source,source_url,edition_date,status,appointments_found,error_msg,started_at,finished_at,created_at', { count: 'exact' })
    .eq('gabinete_id', GABINETE_ID)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) q = q.eq('status', status);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: 'Falha ao listar jobs' }, { status: 500 });

  return NextResponse.json({ jobs: data ?? [], total: count ?? 0 });
}

export async function POST(req: NextRequest) {
  // Aceita: cron (Bearer CRON_SECRET) OU usuário autenticado
  if (!isCronAuth(req)) {
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;
  }

  let body: { source_url: string; source: string; edition_date?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  if (!body.source_url || !body.source) {
    return NextResponse.json({ error: 'source_url e source obrigatórios' }, { status: 400 });
  }

  const { data, error } = await db()
    .from('cadin_do_jobs')
    .upsert({
      gabinete_id:   GABINETE_ID,
      source:        body.source,
      source_url:    body.source_url,
      edition_date:  body.edition_date ?? null,
      status:        'pending',
    }, { onConflict: 'gabinete_id,source_url', ignoreDuplicates: true })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: 'Falha ao enfileirar' }, { status: 500 });

  return NextResponse.json({ ok: true, job_id: data?.id });
}
