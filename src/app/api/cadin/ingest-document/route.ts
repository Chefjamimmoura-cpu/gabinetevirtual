// src/app/api/cadin/ingest-document/route.ts
// POST — Triggers bulk ingestion of an authority document (PDF/DOCX).
// Body: { fileUrl: string, filename: string, esfera?: string }
// Auth: requireAuth Supabase

import { NextRequest, NextResponse } from 'next/server';
import { ingestDocument } from '@/lib/alia/cadin-ingestor';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { fileUrl, filename, esfera } = body;

    if (!fileUrl || !filename) {
      return NextResponse.json(
        { error: 'fileUrl and filename are required' },
        { status: 400 }
      );
    }

    const result = await ingestDocument(GABINETE_ID, fileUrl, filename, esfera);

    return NextResponse.json({
      ok: true,
      job_id: result.job_id,
      records_found: result.records_found,
      records_new: result.records_new,
      records_update: result.records_update,
      records_ambiguous: result.records_ambiguous,
    });
  } catch (err) {
    console.error('[cadin/ingest-document] error:', err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
