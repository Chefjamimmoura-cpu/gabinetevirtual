// src/app/api/cron/alia-proactive/route.ts
// Cron endpoint for ALIA proactive engine.
// Can run all watchers or specific ones via ?watchers=name1,name2
// Auth: CRON_SECRET bearer token

import { NextResponse } from 'next/server';
import { runWatchers } from '@/lib/alia/proactive/scheduler';
import { buildAndSendDigest } from '@/lib/alia/proactive/digest';

const GABINETE_ID = process.env.GABINETE_ID!;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const watcherParam = url.searchParams.get('watchers');
  const isDigest = url.searchParams.get('digest') === 'true';

  try {
    if (isDigest) {
      const result = await buildAndSendDigest(GABINETE_ID);
      return NextResponse.json({ ok: true, type: 'digest', ...result, ran_at: new Date().toISOString() });
    }

    const watcherNames = watcherParam ? watcherParam.split(',') : undefined;
    const result = await runWatchers(GABINETE_ID, watcherNames);

    // ── Processar próxima tarefa da fila ──────────────────────────────────────
    let tasksProcessed = 0;
    try {
      const taskRes = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/alia/task/process`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        },
      );
      if (taskRes.ok) {
        const taskData = await taskRes.json() as { task_id?: string };
        if (taskData.task_id) tasksProcessed = 1;
      }
    } catch {
      // silencioso — falha no processador não deve derrubar os watchers
    }

    return NextResponse.json({
      ok: true,
      type: 'watchers',
      ...result,
      tasks_processed: tasksProcessed,
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[alia-proactive] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
