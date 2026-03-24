// GET /api/pareceres/sessoes
// ──────────────────────────────────────────────────────────────
// Retorna sessões plenárias recentes.
//
// Estratégia DB-first (V3-F1):
//  1. Tenta servir do cache Supabase (sapl_sessoes_cache) — 0ms
//  2. Se cache vazio, cai no SAPL ao vivo (fallback)
//
// O cache é preenchido pelo cron POST /api/admin/sync-sapl.
// ──────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { fetchRecentSessions } from '@/lib/sapl/client';
import { getCachedSessoes } from '@/lib/sapl/sync';

export async function GET() {
  // 1. Tenta cache
  try {
    const cached = await getCachedSessoes();
    if (cached) {
      return NextResponse.json({ ...cached, fonte: 'cache' });
    }
  } catch {
    // Cache indisponível — continua para SAPL ao vivo
  }

  // 2. Fallback: SAPL ao vivo
  try {
    const data = await fetchRecentSessions(100);
    return NextResponse.json({ ...data, fonte: 'sapl_live' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar sessões';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
