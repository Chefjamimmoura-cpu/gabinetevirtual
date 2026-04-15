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

// GET /api/gabinete/config
// Retorna configurações gerais do gabinete: flags de features + relator_nome_padrao.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const db = supabase();
    const { data, error } = await db
      .from('gabinetes')
      .select('configuracoes, relator_nome_padrao')
      .eq('id', GABINETE_ID)
      .single();

    if (error) {
      console.warn('[GET /api/gabinete/config] erro no DB, retornando padrão:', error.message);
      return NextResponse.json({ has_fala_cidadao: true, relator_nome_padrao: null });
    }

    const configuracoes = data?.configuracoes || {};

    return NextResponse.json({
      has_fala_cidadao: configuracoes.has_fala_cidadao === true || true,
      relator_nome_padrao: data?.relator_nome_padrao ?? null,
    });
  } catch (err) {
    console.error('[GET /api/gabinete/config]', err);
    return NextResponse.json({ has_fala_cidadao: true, relator_nome_padrao: null });
  }
}

// PATCH /api/gabinete/config
// Atualiza campos configuráveis do gabinete.
// Body aceito: { relator_nome_padrao?: string }
export async function PATCH(req: NextRequest) {
  // Auth obrigatória — altera relator_nome_padrao que aparece em pareceres oficiais
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { relator_nome_padrao?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if ('relator_nome_padrao' in body) {
    const nome = typeof body.relator_nome_padrao === 'string'
      ? body.relator_nome_padrao.trim()
      : null;
    updates.relator_nome_padrao = nome || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo válido para atualizar' }, { status: 400 });
  }

  try {
    const db = supabase();
    const { error } = await db
      .from('gabinetes')
      .update(updates)
      .eq('id', GABINETE_ID);

    if (error) throw error;
    return NextResponse.json({ success: true, updated: updates });
  } catch (err) {
    console.error('[PATCH /api/gabinete/config]', err);
    return NextResponse.json({ error: 'Falha ao salvar configuração' }, { status: 500 });
  }
}
