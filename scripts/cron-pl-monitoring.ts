#!/usr/bin/env -S npx tsx
// scripts/cron-pl-monitoring.ts
// Sprint 5 — Cron de Monitoramento de Tramitação de PLs
//
// Execução:
//   npx tsx scripts/cron-pl-monitoring.ts
//
// Deploy (Vercel Cron):
//   vercel.json → crons: [{ path: "/api/pls/sincronizar-sapl", schedule: "0 */6 * * *" }]
//   Header: x-sync-secret: $SYNC_SECRET
//
// Deploy (Linux crontab):
//   0 */6 * * * SYNC_SECRET=<secret> npx tsx /path/to/scripts/cron-pl-monitoring.ts >> /var/log/pl-cron.log 2>&1
//
// O script também pode ser chamado diretamente como verificação manual.

import 'dotenv/config';

const BASE_URL = process.env.NEXTAUTH_URL || 'https://gabinete.wonetechnology.cloud';
const SYNC_SECRET = process.env.SYNC_SECRET;

if (!SYNC_SECRET) {
  console.error('[cron-pl] SYNC_SECRET não configurada. Abortando.');
  process.exit(1);
}

async function runSync(): Promise<void> {
  const started = Date.now();
  console.log(`[cron-pl] Iniciando sincronização SAPL — ${new Date().toISOString()}`);

  try {
    const res = await fetch(`${BASE_URL}/api/pls/sincronizar-sapl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-secret': SYNC_SECRET!,
      },
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      console.error('[cron-pl] Sincronização falhou:', data.error || JSON.stringify(data));
      process.exit(1);
    }

    const { sincronizados, mudancas, erros, tempo_ms } = data;
    console.log(`[cron-pl] ✅ OK — PLs verificados: ${sincronizados} | Mudanças: ${mudancas} | Erros: ${erros} | Tempo SAPL: ${tempo_ms}ms | Total: ${Date.now() - started}ms`);

    if (erros > 0 && data.erros_detalhes) {
      console.warn('[cron-pl] Erros:', JSON.stringify(data.erros_detalhes, null, 2));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron-pl] Erro inesperado:', message);
    process.exit(1);
  }
}

runSync();
