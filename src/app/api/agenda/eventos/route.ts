// GET  /api/agenda/eventos  — lista eventos do mês (?ano=2026&mes=3)
// POST /api/agenda/eventos  — cria novo evento

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

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const ano  = parseInt(searchParams.get('ano')  ?? String(new Date().getFullYear()));
  const mes  = parseInt(searchParams.get('mes')  ?? String(new Date().getMonth() + 1)); // 1–12
  const view = searchParams.get('view') ?? 'month'; // month | week | day

  const db = supabase();

  // Calcular janela de datas
  let inicio: Date, fim: Date;

  if (view === 'day') {
    const dia = parseInt(searchParams.get('dia') ?? String(new Date().getDate()));
    inicio = new Date(ano, mes - 1, dia, 0, 0, 0);
    fim    = new Date(ano, mes - 1, dia, 23, 59, 59);
  } else if (view === 'week') {
    const dia = parseInt(searchParams.get('dia') ?? String(new Date().getDate()));
    const base = new Date(ano, mes - 1, dia);
    const dow = base.getDay(); // 0=Dom
    inicio = new Date(base); inicio.setDate(base.getDate() - dow);
    fim    = new Date(inicio); fim.setDate(inicio.getDate() + 6); fim.setHours(23, 59, 59);
  } else {
    // month — inclui dias da semana anterior/posterior para preencher o grid 7x6
    inicio = new Date(ano, mes - 1, 1);
    // Puxar 7 dias antes do início do mês (para mostrar dias do mês anterior no grid)
    inicio.setDate(inicio.getDate() - inicio.getDay());
    fim = new Date(ano, mes, 0); // último dia do mês
    // Puxar até o sábado seguinte para preencher o grid
    fim.setDate(fim.getDate() + (6 - fim.getDay()));
    fim.setHours(23, 59, 59);
  }

  const { data, error } = await db
    .from('eventos')
    .select('id, titulo, descricao, tipo, data_inicio, data_fim, local, cor, sapl_sessao_id, created_at')
    .eq('gabinete_id', GABINETE_ID)
    .gte('data_inicio', inicio.toISOString())
    .lte('data_inicio', fim.toISOString())
    .order('data_inicio', { ascending: true });

  if (error) {
    console.error('[agenda/eventos GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

interface CriarEventoBody {
  titulo: string;
  data_inicio: string;   // ISO string
  data_fim?: string;
  descricao?: string;
  tipo?: string;
  local?: string;
  cor?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const db = supabase();

  let body: CriarEventoBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  if (!body.titulo || !body.data_inicio) {
    return NextResponse.json({ error: 'titulo e data_inicio são obrigatórios' }, { status: 400 });
  }

  const tiposValidos = ['sessao_plenaria', 'reuniao_comissao', 'agenda_externa', 'reuniao', 'outro'];
  const tipo = tiposValidos.includes(body.tipo ?? '') ? body.tipo : 'reuniao';

  const { data, error } = await db
    .from('eventos')
    .insert({
      gabinete_id: GABINETE_ID,
      titulo: body.titulo,
      data_inicio: body.data_inicio,
      data_fim: body.data_fim ?? null,
      descricao: body.descricao ?? null,
      tipo,
      local: body.local ?? null,
      cor: body.cor ?? '#6366f1',
    })
    .select('id, titulo, tipo, data_inicio, data_fim, local, cor')
    .single();

  if (error) {
    console.error('[agenda/eventos POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
