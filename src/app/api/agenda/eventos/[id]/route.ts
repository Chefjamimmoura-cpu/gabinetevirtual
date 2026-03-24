// PATCH  /api/agenda/eventos/[id]  — atualiza evento
// DELETE /api/agenda/eventos/[id]  — remove evento

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = supabase();

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 }); }

  // Campos editáveis — previne sobrescrever gabinete_id ou sapl_sessao_id acidentalmente
  const { titulo, data_inicio, data_fim, descricao, tipo, local, cor } = body as Record<string, string>;
  const update: Record<string, unknown> = {};
  if (titulo     !== undefined) update.titulo     = titulo;
  if (data_inicio !== undefined) update.data_inicio = data_inicio;
  if (data_fim   !== undefined) update.data_fim   = data_fim;
  if (descricao  !== undefined) update.descricao  = descricao;
  if (tipo       !== undefined) update.tipo       = tipo;
  if (local      !== undefined) update.local      = local;
  if (cor        !== undefined) update.cor        = cor;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 });
  }

  const { data, error } = await db
    .from('eventos')
    .update(update)
    .eq('id', id)
    .eq('gabinete_id', GABINETE_ID)
    .select('id, titulo, tipo, data_inicio, data_fim, local, cor')
    .single();

  if (error) {
    console.error('[agenda/eventos PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = supabase();

  const { error } = await db
    .from('eventos')
    .delete()
    .eq('id', id)
    .eq('gabinete_id', GABINETE_ID);

  if (error) {
    console.error('[agenda/eventos DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
