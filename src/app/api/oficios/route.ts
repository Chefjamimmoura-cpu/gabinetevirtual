// GET  /api/oficios  — lista os ofícios salvos do gabinete (mais recentes primeiro)
// POST /api/oficios  — salva um ofício gerado pela IA com numeração oficial

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ─── GET — listar ────────────────────────────────────────────────────────────

export async function GET() {
  const db = supabase();

  const { data, error } = await db
    .from('oficios')
    .select('id, numero_seq, ano, destinatario, cargo_dest, assunto, status, dados_json, created_at')
    .eq('gabinete_id', GABINETE_ID)
    .order('ano', { ascending: false })
    .order('numero_seq', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[oficios GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// ─── POST — salvar ───────────────────────────────────────────────────────────

interface SalvarBody {
  destinatario: string;
  cargo: string;
  assunto: string;
  corpo: string;
  dados_json: Record<string, unknown>; // objeto completo retornado pelo /api/oficios/gerar
}

export async function POST(req: NextRequest) {
  const db = supabase();

  let body: SalvarBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  if (!body.destinatario || !body.assunto || !body.corpo) {
    return NextResponse.json({ error: 'destinatario, assunto e corpo são obrigatórios' }, { status: 400 });
  }

  // Obtém próximo número sequencial via função do banco
  const { data: seqData, error: seqError } = await db
    .rpc('next_oficio_numero', { p_gabinete_id: GABINETE_ID });

  if (seqError) {
    console.error('[oficios POST] seq error', seqError);
    return NextResponse.json({ error: 'Falha ao gerar número de ofício' }, { status: 500 });
  }

  const numero_seq: number = seqData;
  const ano = new Date().getFullYear();

  const { data, error } = await db
    .from('oficios')
    .insert({
      gabinete_id: GABINETE_ID,
      numero_seq,
      ano,
      destinatario: body.destinatario,
      cargo_dest: body.cargo ?? null,
      assunto: body.assunto,
      corpo: body.corpo,
      status: 'rascunho',
      dados_json: body.dados_json ?? {},
    })
    .select('id, numero_seq, ano, status')
    .single();

  if (error) {
    console.error('[oficios POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const numeroFormatado = `${String(data.numero_seq).padStart(3, '0')}/${data.ano}`;

  return NextResponse.json({
    ok: true,
    id: data.id,
    numero_seq: data.numero_seq,
    ano: data.ano,
    numero: numeroFormatado,
    status: data.status,
    mensagem: `Ofício OF. GAB. Nº ${numeroFormatado} salvo com sucesso.`,
  }, { status: 201 });
}
