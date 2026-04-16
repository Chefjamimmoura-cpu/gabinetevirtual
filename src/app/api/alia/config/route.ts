import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const db = supabase();
    const { data, error } = await db
      .from('gabinetes')
      .select('config_json')
      .eq('id', GABINETE_ID)
      .single();

    if (error) {
      console.error('[alia/config] getter error:', error);
      return NextResponse.json({ error: 'Falha ao buscar configurações' }, { status: 500 });
    }

    return NextResponse.json(data?.config_json || {});
  } catch (err) {
    console.error('[alia/config] fetch error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const db = supabase();

    // Buscar config atual primeiro
    const { data: current, error: currentErr } = await db
      .from('gabinetes')
      .select('config_json')
      .eq('id', GABINETE_ID)
      .single();

    if (currentErr) {
      return NextResponse.json({ error: 'Gabinete não encontrado' }, { status: 404 });
    }

    const currentConfig = current?.config_json || {};
    const newConfig = { ...currentConfig, alia_config: body };

    const { error: updateErr } = await db
      .from('gabinetes')
      .update({ config_json: newConfig })
      .eq('id', GABINETE_ID);

    if (updateErr) {
      console.error('[alia/config] setter update error:', updateErr);
      return NextResponse.json({ error: 'Falha ao salvar configurações' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, config: newConfig });
  } catch (err) {
    console.error('[alia/config] post error:', err);
    return NextResponse.json({ error: 'Erro interno ao salvar configurações' }, { status: 500 });
  }
}
