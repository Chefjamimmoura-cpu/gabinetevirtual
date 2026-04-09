// src/app/api/cron/alia-memory-decay/route.ts
// Daily cron: reduces confidence of stale memories.
// Schedule: 0 3 * * * (3am daily)
// Auth: CRON_SECRET bearer token

import { NextResponse } from 'next/server';
import { decay } from '@/lib/alia/memory';

const GABINETE_ID = process.env.GABINETE_ID!;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const affected = await decay(GABINETE_ID);

  return NextResponse.json({
    ok: true,
    gabinete_id: GABINETE_ID,
    memories_decayed: affected,
    ran_at: new Date().toISOString(),
  });
}
