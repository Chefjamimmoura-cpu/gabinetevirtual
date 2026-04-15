// GET/POST /api/cron/expirar-audios-sessoes
// Cron diário: apaga áudios de sessões expiradas (>30 dias) do Storage.
// Transcrição, relatório e metadados permanecem intactos.
//
// Segurança: requer header `x-cron-secret` igual a CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function handler(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const agora = new Date().toISOString();

  // Buscar sessões com áudio expirado
  const { data: sessoes, error: fetchErr } = await supabase
    .from('sessoes_transcritas')
    .select('id, audio_storage_path, audio_expira_em')
    .not('audio_storage_path', 'is', null)
    .lt('audio_expira_em', agora)
    .limit(100);

  if (fetchErr) {
    console.error('[cron/expirar-audios] erro busca:', fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!sessoes || sessoes.length === 0) {
    return NextResponse.json({ ok: true, expiradas: 0 });
  }

  let apagadas = 0;
  const erros: string[] = [];

  for (const s of sessoes) {
    try {
      const { error: delErr } = await supabase.storage
        .from('gabinete_media')
        .remove([s.audio_storage_path]);
      if (delErr) {
        erros.push(`${s.id}: ${delErr.message}`);
        continue;
      }

      await supabase
        .from('sessoes_transcritas')
        .update({
          audio_storage_path: null,
          audio_expira_em: null,
          updated_at: agora,
        })
        .eq('id', s.id);

      apagadas++;
    } catch (err) {
      erros.push(`${s.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    total_encontradas: sessoes.length,
    apagadas,
    erros: erros.length > 0 ? erros : undefined,
  });
}

export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }
