// POST /api/pareceres/sync-sapl
// ──────────────────────────────────────────────────────────────
// Endpoint público (chamado pelo botão "Sincronizar SAPL" no dashboard).
// Dispara o mesmo syncSapl() do admin/sync-sapl, mas sem necessidade
// de Bearer token — acessível apenas por usuários autenticados no frontend.
//
// Limita a execução a sessões recentes (últimas 20) para ser rápido.
// O sync completo (cron noturno) usa /api/admin/sync-sapl.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { syncSapl } from '@/lib/sapl/sync';

// 2 minutos — suficiente para sincronizar sessões recentes
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const result = await syncSapl();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro no sync';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
