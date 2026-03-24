// GET /api/alia/status — saúde da knowledge base por domínio

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;
const DOMINIOS    = ['legislacao','cadin','sapl','redacao','indicacoes','jurisprudencia'];

export async function GET() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await db
    .from('alia_knowledge')
    .select('dominio, updated_at')
    .eq('gabinete_id', GABINETE_ID);

  if (error) return NextResponse.json({ error: 'Falha ao consultar status' }, { status: 500 });

  const stats: Record<string, { total: number; ultima_atualizacao: string | null }> = {};
  for (const d of DOMINIOS) stats[d] = { total: 0, ultima_atualizacao: null };

  for (const row of data ?? []) {
    if (!stats[row.dominio]) continue;
    stats[row.dominio].total++;
    const atual = stats[row.dominio].ultima_atualizacao;
    if (!atual || row.updated_at > atual) {
      stats[row.dominio].ultima_atualizacao = row.updated_at;
    }
  }

  const total = Object.values(stats).reduce((s, v) => s + v.total, 0);
  const faltando = DOMINIOS.filter(d => stats[d].total === 0);

  return NextResponse.json({
    total_chunks: total,
    por_dominio: stats,
    dominios_faltando: faltando,
    rag_pronto: faltando.length === 0,
    endpoints_ingest: DOMINIOS.map(d => `POST /api/alia/ingest/${d}`),
  });
}
