// GET /api/agenda/emails
// Lista emails do cache agenda_emails.
// Query: ?conta=all | oficial | agenda | pessoal | canais | comissao
//        &limit=50
//        &apenas_nao_lidos=true

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
  const conta = searchParams.get('conta') ?? 'all';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 200);
  const apenasNaoLidos = searchParams.get('apenas_nao_lidos') === 'true';

  const db = supabase();

  let query = db
    .from('agenda_emails')
    .select('id, conta, remetente, assunto, preview, data_recebimento, lido, evento_criado_id')
    .eq('gabinete_id', GABINETE_ID)
    .order('data_recebimento', { ascending: false })
    .limit(limit);

  if (conta !== 'all') query = query.eq('conta', conta);
  if (apenasNaoLidos) query = query.eq('lido', false);

  const { data, error } = await query;

  if (error) {
    console.error('[agenda/emails GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Calcular badges (não lidos por conta)
  const { data: badges } = await db
    .from('agenda_emails')
    .select('conta')
    .eq('gabinete_id', GABINETE_ID)
    .eq('lido', false);

  const naoLidosPorConta: Record<string, number> = {};
  for (const row of badges ?? []) {
    naoLidosPorConta[row.conta] = (naoLidosPorConta[row.conta] ?? 0) + 1;
  }

  return NextResponse.json({
    emails: data ?? [],
    nao_lidos: naoLidosPorConta,
    total: data?.length ?? 0,
  });
}
