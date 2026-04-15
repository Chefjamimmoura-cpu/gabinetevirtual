// GET    /api/alia/knowledge?tipo=cadin&page=0&limit=20
// POST   /api/alia/knowledge  { chunks: KnowledgeChunk[] }
// DELETE /api/alia/knowledge?id=uuid

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { upsertKnowledge, type KnowledgeChunk, type Dominio } from '@/lib/alia/rag';
import { requireAuth } from '@/lib/supabase/auth-guard';

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
  const dominio = searchParams.get('dominio') as Dominio | null;
  const page    = Math.max(0, parseInt(searchParams.get('page')  ?? '0'));
  const limit   = Math.min(50, parseInt(searchParams.get('limit') ?? '20'));

  let q = db()
    .from('alia_knowledge')
    .select('id,dominio,source_ref,chunk_text,metadata,created_at,updated_at', { count: 'exact' })
    .eq('gabinete_id', GABINETE_ID)
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (dominio) q = q.eq('dominio', dominio);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: 'Falha ao listar' }, { status: 500 });

  return NextResponse.json({ chunks: data ?? [], total: count ?? 0, page, limit });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { chunks?: KnowledgeChunk[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  if (!Array.isArray(body.chunks) || body.chunks.length === 0)
    return NextResponse.json({ error: 'chunks[] obrigatório' }, { status: 400 });

  if (body.chunks.length > 200)
    return NextResponse.json({ error: 'Máximo 200 chunks por chamada' }, { status: 400 });

  const result = await upsertKnowledge(body.chunks, GABINETE_ID);
  return NextResponse.json({ ...result });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  const { error } = await db()
    .from('alia_knowledge')
    .delete()
    .eq('id', id)
    .eq('gabinete_id', GABINETE_ID);

  if (error) return NextResponse.json({ error: 'Falha ao deletar' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
