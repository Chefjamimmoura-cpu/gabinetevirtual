// GET /api/cadin/pdf-history
// Retorna até 10 PDFs gerados recentemente, válidos dentro dos próximos 7 dias.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET() {
  const svc = getServiceSupabase();

  const { data, error } = await svc
    .from('cadin_pdf_cache')
    .select('id, label, authority_count, created_at, expires_at, pdf_public_url')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
