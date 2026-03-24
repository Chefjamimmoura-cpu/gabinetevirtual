// DELETE /api/oficios/[id]  — exclui um ofício salvo
// PATCH  /api/oficios/[id]  — atualiza status: 'rascunho' | 'enviado' | 'arquivado'

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolvedParams = await params;
  const db = supabase();

  const { error } = await db
    .from('oficios')
    .delete()
    .eq('id', resolvedParams.id)
    .eq('gabinete_id', GABINETE_ID);

  if (error) {
    console.error('[oficios DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ─── PATCH — atualizar status ─────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolvedParams = await params;
  const db = supabase();

  let body: { status: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const statusValidos = ['rascunho', 'enviado', 'arquivado'];
  if (!statusValidos.includes(body.status)) {
    return NextResponse.json(
      { error: `Status inválido. Use: ${statusValidos.join(', ')}` },
      { status: 400 },
    );
  }

  const { data, error } = await db
    .from('oficios')
    .update({ status: body.status })
    .eq('id', resolvedParams.id)
    .eq('gabinete_id', GABINETE_ID)
    .select('id, status')
    .single();

  if (error) {
    console.error('[oficios PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, status: data.status });
}
