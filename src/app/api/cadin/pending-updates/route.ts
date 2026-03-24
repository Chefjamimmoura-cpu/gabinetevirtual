// GET /api/cadin/pending-updates
// Retorna fila de sugestões de atualização geradas pelo monitoramento de
// Diários Oficiais (tabela cadin_pending_updates).
//
// Query params:
//   status   — 'pendente' (default) | 'aprovado' | 'rejeitado' | 'todos'
//   limit    — máx registros (default 50)
//   offset   — paginação

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const db = supabase();
  const { searchParams } = new URL(req.url);

  const status = searchParams.get('status') ?? 'pendente';
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '50'), 200);
  const offset = parseInt(searchParams.get('offset') ?? '0');

  try {
    let query = db
      .from('cadin_pending_updates')
      .select(`
        id,
        update_type,
        extracted_text,
        source_url,
        source_date,
        suggested_changes,
        confidence,
        gemini_summary,
        status,
        reviewed_at,
        review_notes,
        created_at,
        cadin_persons    ( id, full_name, phone ),
        cadin_organizations ( id, name, acronym ),
        cadin_monitor_sources ( id, name, source_type )
      `, { count: 'exact' })
      .eq('gabinete_id', GABINETE_ID)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    if (status !== 'todos') {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // Estatísticas agregadas para o header do painel
    const [statsRes] = await Promise.allSettled([
      db.from('cadin_pending_updates')
        .select('status', { count: 'exact', head: false })
        .eq('gabinete_id', GABINETE_ID),
    ]);

    let stats = { pendente: 0, aprovado: 0, rejeitado: 0, aplicado: 0 };
    if (statsRes.status === 'fulfilled' && statsRes.value.data) {
      for (const row of statsRes.value.data as { status: string }[]) {
        const s = row.status as keyof typeof stats;
        if (s in stats) stats[s]++;
      }
    }

    return NextResponse.json({ total: count ?? 0, offset, limit, stats, results: data ?? [] });
  } catch (error) {
    console.error('[GET /api/cadin/pending-updates]', error);
    return NextResponse.json({ error: 'Falha ao buscar atualizações pendentes' }, { status: 500 });
  }
}
