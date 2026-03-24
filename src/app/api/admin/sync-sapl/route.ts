// POST /api/admin/sync-sapl
// ──────────────────────────────────────────────────────────────
// Endpoint protegido para sincronizar o cache do SAPL no Supabase.
// Chamado pelo cron da VPS toda madrugada (3h):
//
//   0 3 * * * curl -s -X POST \
//     https://gabinete.wonetechnology.cloud/api/admin/sync-sapl \
//     -H "Authorization: Bearer $SYNC_SECRET"
//
// Autenticação: Bearer token via env SYNC_SECRET.
// Tempo máximo: 5 minutos (limite Next.js self-hosted).
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { syncSapl } from '@/lib/sapl/sync';

// 5 minutos — necessário para sincronizar PDFs e materias em lote
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'SYNC_SECRET não configurado no servidor' },
      { status: 500 },
    );
  }

  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const result = await syncSapl();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro no sync';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
