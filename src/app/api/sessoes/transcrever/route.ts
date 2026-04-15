// POST /api/sessoes/transcrever
// Recebe arquivo de áudio, transcreve via Groq Whisper, detecta interlocutores,
// salva no Supabase e retorna o ID da sessão.
//
// Body: FormData com campo "audio" (arquivo) + "titulo" + "data_sessao" (opcional)
// Response: { ok, sessao_id, segments, keyPoints }

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { detectSpeakers } from '@/lib/sessoes/speaker-detector';
import { detectKeyPoints } from '@/lib/sessoes/key-points';
import { requireAuth } from '@/lib/supabase/auth-guard';

export const maxDuration = 300; // 5 min timeout (áudios grandes)

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  // Auth obrigatória — endpoint consome Groq API (custo)
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY não configurada' }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Envie FormData com campo "audio"' }, { status: 400 });
  }

  const audioFile = formData.get('audio') as File | null;
  const titulo = (formData.get('titulo') as string) || 'Sessão sem título';
  const dataSessao = (formData.get('data_sessao') as string) || null;
  const gabineteId = (formData.get('gabinete_id') as string) || process.env.GABINETE_ID || null;

  if (!audioFile) {
    return NextResponse.json({ error: 'Campo "audio" é obrigatório' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Criar registro no banco com status "transcrevendo"
  const { data: sessao, error: insertErr } = await supabase
    .from('sessoes_transcritas')
    .insert({
      gabinete_id: gabineteId,
      titulo,
      data_sessao: dataSessao,
      fonte: 'upload',
      status: 'transcrevendo',
    })
    .select('id')
    .single();

  if (insertErr || !sessao) {
    return NextResponse.json({ error: 'Falha ao criar sessão no banco', details: insertErr?.message }, { status: 500 });
  }

  const sessaoId = sessao.id;

  try {
    // ── Enviar para Groq Whisper ──
    const groqForm = new FormData();
    groqForm.append('file', audioFile, audioFile.name);
    groqForm.append('model', 'whisper-large-v3-turbo');
    groqForm.append('response_format', 'verbose_json');
    groqForm.append('language', 'pt');
    groqForm.append('timestamp_granularities[]', 'word');
    groqForm.append('timestamp_granularities[]', 'segment');

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}` },
      body: groqForm,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      throw new Error(`Groq API error ${groqRes.status}: ${errText}`);
    }

    const groqData = await groqRes.json();

    // ── Normalizar segmentos ──
    const segments = (groqData.segments || []).map((seg: any, idx: number) => ({
      id: idx,
      start: seg.start,
      end: seg.end,
      text: (seg.text || '').trim(),
      avgLogprob: seg.avg_logprob || 0,
      noSpeechProb: seg.no_speech_prob || 0,
      isUnclear: (seg.no_speech_prob || 0) > 0.8 || (seg.avg_logprob || 0) < -1.5,
    }));

    const words = (groqData.words || []).map((w: any) => ({
      word: (w.word || '').trim(),
      start: w.start,
      end: w.end,
    }));

    // ── Speaker detection ──
    const speakerBlocks = detectSpeakers(segments, words, 'plenario');

    // ── Key points ──
    const keyPoints = detectKeyPoints(speakerBlocks);

    // ── Calcular duração ──
    const duracao = groqData.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0);

    // ── Salvar áudio no storage ──
    let audioPath: string | null = null;
    try {
      const buf = Buffer.from(await audioFile.arrayBuffer());
      const ext = audioFile.name.split('.').pop() || 'webm';
      const storagePath = `sessoes/${sessaoId}.${ext}`;
      await supabase.storage.from('gabinete_media').upload(storagePath, buf, {
        contentType: audioFile.type || 'audio/webm',
        upsert: true,
      });
      audioPath = storagePath;
    } catch {
      // Silencioso — transcrição funciona sem áudio salvo
    }

    // ── Atualizar banco ──
    await supabase
      .from('sessoes_transcritas')
      .update({
        status: 'concluida',
        duracao_segundos: Math.round(duracao),
        audio_storage_path: audioPath,
        transcricao: { text: groqData.text, segments: speakerBlocks, words },
        pontos_chave: keyPoints,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessaoId);

    return NextResponse.json({
      ok: true,
      sessao_id: sessaoId,
      duracao: Math.round(duracao),
      total_blocos: speakerBlocks.length,
      total_pontos_chave: keyPoints.length,
      texto_completo: groqData.text,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro na transcrição';
    console.error('[sessoes/transcrever]', msg);

    await supabase
      .from('sessoes_transcritas')
      .update({ status: 'erro', error_msg: msg, updated_at: new Date().toISOString() })
      .eq('id', sessaoId);

    return NextResponse.json({ error: msg, sessao_id: sessaoId }, { status: 502 });
  }
}
