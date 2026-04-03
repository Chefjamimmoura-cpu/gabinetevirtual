// GET /api/sessoes/youtube — Lista vídeos recentes do canal @camaraboavista
// POST /api/sessoes/youtube — Recebe URL do YouTube, extrai áudio, transcreve

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectSpeakers } from '@/lib/sessoes/speaker-detector';
import { detectKeyPoints } from '@/lib/sessoes/key-points';

// ── Helpers de autenticação OAuth yt-dlp ─────────────────────────────────────

const YT_DLP_CACHE = path.join(os.homedir(), '.cache', 'yt-dlp');
const COOKIES_PATH = path.join(YT_DLP_CACHE, 'cookies.txt');

function isAuthenticated(): boolean {
  try {
    const files = fs.readdirSync(YT_DLP_CACHE);
    const hasOAuth = files.some(f => f.includes('oauth2') || f.includes('token'));
    const hasCookies = fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 100;
    return hasOAuth || hasCookies;
  } catch { return false; }
}

function getAuthArgs(): string[] {
  try {
    // 1) Tentar cookies.txt (mais confiável, funciona em qualquer versão)
    if (fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 100) {
      return ['--cookies', COOKIES_PATH];
    }
    // 2) Fallback: OAuth2 token cacheado
    const files = fs.readdirSync(YT_DLP_CACHE);
    const hasToken = files.some(f => f.includes('oauth2') || f.includes('token'));
    if (hasToken) {
      return ['--username', 'oauth2', '--password', ''];
    }
  } catch { /* cache dir não existe */ }
  return [];
}

export const maxDuration = 600; // 10 min (download + transcrição de sessões longas)

const execFileAsync = promisify(execFile);

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
// Channel ID do @camaraboavista (Câmara Municipal de Boa Vista)
const CHANNEL_ID = 'UCm5iVtgBmnzacLBZJCPna9g';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Helpers YouTube Data API v3 ─────────────────────────────────────────────

function parseDuration(iso: string): number {
  // PT1H55M30S → seconds
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0');
}

function formatDuration(seconds: number): string {
  if (seconds > 3600) {
    return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`;
  }
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ── GET: Lista vídeos recentes do canal via YouTube Data API v3 ─────────────

export async function GET() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY não configurada' }, { status: 500 });
  }

  try {
    // 1. Buscar uploads playlist ID do canal
    const channelRes = await fetch(
      `${YT_API_BASE}/channels?part=contentDetails&id=${CHANNEL_ID}&key=${apiKey}`,
      { next: { revalidate: 3600 } }, // cache 1h
    );
    if (!channelRes.ok) {
      const err = await channelRes.text();
      console.error('[youtube GET] channels error:', err);
      return NextResponse.json({ error: 'Erro ao acessar canal YouTube' }, { status: 502 });
    }
    const channelData = await channelRes.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return NextResponse.json({ error: 'Canal não encontrado' }, { status: 404 });
    }

    // 2. Listar últimos 30 vídeos do playlist de uploads
    const playlistRes = await fetch(
      `${YT_API_BASE}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=30&key=${apiKey}`,
    );
    if (!playlistRes.ok) {
      const err = await playlistRes.text();
      console.error('[youtube GET] playlist error:', err);
      return NextResponse.json({ error: 'Erro ao listar vídeos' }, { status: 502 });
    }
    const playlistData = await playlistRes.json();
    const videoIds = (playlistData.items || [])
      .map((item: any) => item.snippet?.resourceId?.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) {
      return NextResponse.json({ ok: true, videos: [], total: 0 });
    }

    // 3. Buscar detalhes (duração, views) dos vídeos
    const detailsRes = await fetch(
      `${YT_API_BASE}/videos?part=contentDetails,statistics&id=${videoIds.join(',')}&key=${apiKey}`,
    );
    const detailsData = detailsRes.ok ? await detailsRes.json() : { items: [] };
    const detailsMap = new Map(
      (detailsData.items || []).map((v: any) => [v.id, v]),
    );

    // 4. Montar resposta
    const videos = (playlistData.items || []).map((item: any) => {
      const videoId = item.snippet?.resourceId?.videoId;
      const details: any = detailsMap.get(videoId) || {};
      const dur = parseDuration(details.contentDetails?.duration || '');
      const publishedAt = item.snippet?.publishedAt;
      const dateStr = publishedAt ? publishedAt.slice(0, 10) : null;

      return {
        id: videoId,
        title: item.snippet?.title || 'Sem título',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: item.snippet?.thumbnails?.medium?.url
          || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        duration: dur,
        duration_fmt: formatDuration(dur),
        upload_date: dateStr,
        views: parseInt(details.statistics?.viewCount || '0') || 0,
      };
    });

    return NextResponse.json({ ok: true, videos, total: videos.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao listar vídeos';
    console.error('[sessoes/youtube GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: Extrair áudio de URL + transcrever ─────────────────────────────────

export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json({ error: 'GROQ_API_KEY não configurada' }, { status: 500 });

  let body: { url?: string; titulo?: string; gabinete_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }); }

  const { url, titulo, gabinete_id } = body;
  if (!url) return NextResponse.json({ error: 'Campo "url" é obrigatório' }, { status: 400 });

  const supabase = getSupabase();
  const gId = gabinete_id || process.env.GABINETE_ID || null;

  // Criar registro
  const { data: sessao, error: insertErr } = await supabase
    .from('sessoes_transcritas')
    .insert({
      gabinete_id: gId,
      titulo: titulo || 'Sessão YouTube',
      fonte: 'youtube',
      youtube_url: url,
      status: 'processando',
    })
    .select('id')
    .single();

  if (insertErr || !sessao) {
    return NextResponse.json({ error: 'Falha ao criar sessão', details: insertErr?.message }, { status: 500 });
  }

  const sessaoId = sessao.id;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt_sessao_'));
  const rawPath = path.join(tmpDir, 'raw_audio');
  const compressedPath = path.join(tmpDir, 'audio.mp3');

  try {
    // ── 1. Download áudio via yt-dlp ──
    await supabase.from('sessoes_transcritas').update({ status: 'processando' }).eq('id', sessaoId);

    const authArgs = getAuthArgs();
    const baseArgs = [
      '-x', '--audio-format', 'mp3',
      '--no-playlist',
      '--no-check-certificates',
      '--js-runtimes', 'nodejs',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--extractor-args', 'youtube:player_client=web',
      '--no-warnings',
      '-o', rawPath + '.%(ext)s',
      url,
    ];

    try {
      // Tenta com auth se disponível, senão tenta sem (vídeos públicos não precisam)
      await execFileAsync('yt-dlp', [
        ...authArgs,
        ...baseArgs,
      ], { timeout: 300_000 });
    } catch (dlErr: any) {
      const dlMsg = dlErr?.message || dlErr?.stderr || '';
      console.error('[sessoes/youtube] yt-dlp falhou:', dlMsg.slice(0, 500));

      // Se tinha auth e falhou, tenta sem auth (token pode estar corrompido)
      if (authArgs.length > 0) {
        console.log('[sessoes/youtube] Retentando sem auth args...');
        try {
          await execFileAsync('yt-dlp', baseArgs, { timeout: 300_000 });
        } catch (retryErr: any) {
          const retryMsg = retryErr?.message || retryErr?.stderr || '';
          if (retryMsg.includes('Sign in') || retryMsg.includes('cookies') || retryMsg.includes('bot')) {
            throw new Error('YouTube bloqueou o download. Tente novamente em alguns minutos.');
          }
          throw retryErr;
        }
      } else {
        // Sem auth e falhou
        if (dlMsg.includes('Sign in') || dlMsg.includes('cookies') || dlMsg.includes('bot')) {
          throw new Error('YouTube bloqueou o download. Tente novamente em alguns minutos.');
        }
        throw dlErr;
      }
    }

    // Encontrar arquivo baixado (yt-dlp adiciona extensão)
    const downloadedFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('raw_audio'));
    if (downloadedFiles.length === 0) throw new Error('yt-dlp não gerou arquivo de áudio');
    const downloadedPath = path.join(tmpDir, downloadedFiles[0]);

    // ── 2. Comprimir: mono, 16kHz, 32kbps (mantém qualidade de voz, reduz tamanho) ──
    await execFileAsync('ffmpeg', [
      '-i', downloadedPath,
      '-ac', '1',          // mono
      '-ar', '16000',      // 16kHz (suficiente para voz)
      '-b:a', '32k',       // 32kbps
      '-y', compressedPath,
    ], { timeout: 120_000 });

    const audioSize = fs.statSync(compressedPath).size;
    const sizeMB = audioSize / (1024 * 1024);

    // ── 3. Chunking se > 24MB ──
    const MAX_CHUNK = 24 * 1024 * 1024;
    const chunkPaths: string[] = [];

    if (audioSize <= MAX_CHUNK) {
      chunkPaths.push(compressedPath);
    } else {
      // Calcular duração do áudio
      const { stdout: probeOut } = await execFileAsync('ffprobe', [
        '-v', 'quiet', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', compressedPath,
      ], { timeout: 10_000 });
      const totalDuration = parseFloat(probeOut.trim()) || 7200;

      // Dividir em chunks de ~20 minutos
      const chunkDuration = 1200; // 20 min
      const numChunks = Math.ceil(totalDuration / chunkDuration);

      for (let i = 0; i < numChunks; i++) {
        const chunkPath = path.join(tmpDir, `chunk_${i}.mp3`);
        const startSec = i * chunkDuration;
        await execFileAsync('ffmpeg', [
          '-i', compressedPath,
          '-ss', String(startSec),
          '-t', String(chunkDuration),
          '-ac', '1', '-ar', '16000', '-b:a', '32k',
          '-y', chunkPath,
        ], { timeout: 60_000 });
        if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 1000) {
          chunkPaths.push(chunkPath);
        }
      }
    }

    // ── 4. Transcrever cada chunk via Groq (com retry) ──
    await supabase.from('sessoes_transcritas').update({ status: 'transcrevendo' }).eq('id', sessaoId);

    const allSegments: any[] = [];
    const allWords: any[] = [];
    let fullText = '';
    let totalDuration = 0;
    let segIdOffset = 0;
    let timeOffset = 0;

    for (let ci = 0; ci < chunkPaths.length; ci++) {
      const chunkBuf = fs.readFileSync(chunkPaths[ci]);
      const chunkBlob = new Blob([chunkBuf], { type: 'audio/mp3' });
      const chunkFile = new File([chunkBlob], `chunk_${ci}.mp3`, { type: 'audio/mp3' });

      // Retry com backoff (rate limit 20 RPM)
      let groqData: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const groqForm = new FormData();
        groqForm.append('file', chunkFile, `chunk_${ci}.mp3`);
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

        if (groqRes.ok) {
          groqData = await groqRes.json();
          break;
        }

        if (groqRes.status === 429) {
          // Rate limited — esperar e tentar novamente
          const retryAfter = parseInt(groqRes.headers.get('retry-after') || '30');
          const waitMs = Math.max(retryAfter * 1000, (attempt + 1) * 15_000);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        const errText = await groqRes.text();
        throw new Error(`Groq API error ${groqRes.status}: ${errText}`);
      }

      if (!groqData) throw new Error('Groq API: rate limit excedido após 3 tentativas');

      // Merge segments com offset de tempo
      const chunkSegs = (groqData.segments || []).map((seg: any, idx: number) => ({
        id: segIdOffset + idx,
        start: seg.start + timeOffset,
        end: seg.end + timeOffset,
        text: (seg.text || '').trim(),
        avgLogprob: seg.avg_logprob || 0,
        noSpeechProb: seg.no_speech_prob || 0,
        isUnclear: (seg.no_speech_prob || 0) > 0.8 || (seg.avg_logprob || 0) < -1.5,
      }));

      const chunkWords = (groqData.words || []).map((w: any) => ({
        word: (w.word || '').trim(),
        start: w.start + timeOffset,
        end: w.end + timeOffset,
      }));

      allSegments.push(...chunkSegs);
      allWords.push(...chunkWords);
      fullText += (fullText ? ' ' : '') + (groqData.text || '');
      segIdOffset += chunkSegs.length;

      const chunkDur = groqData.duration || (chunkSegs.length > 0 ? chunkSegs[chunkSegs.length - 1].end - timeOffset : 0);
      timeOffset += chunkDur;
      totalDuration += chunkDur;

      // Pausa entre chunks para não bater rate limit
      if (ci < chunkPaths.length - 1) {
        await new Promise(r => setTimeout(r, 4000));
      }
    }

    // ── 5. Speaker detection + key points ──
    const speakerBlocks = detectSpeakers(allSegments, allWords, 'plenario');
    const keyPoints = detectKeyPoints(speakerBlocks);

    // ── 6. Salvar resultado ──
    await supabase.from('sessoes_transcritas').update({
      status: 'concluida',
      titulo: titulo || fullText?.substring(0, 80) || 'Sessão YouTube',
      duracao_segundos: Math.round(totalDuration),
      transcricao: { text: fullText, segments: speakerBlocks, words: allWords },
      pontos_chave: keyPoints,
      updated_at: new Date().toISOString(),
    }).eq('id', sessaoId);

    return NextResponse.json({
      ok: true,
      sessao_id: sessaoId,
      duracao: Math.round(totalDuration),
      total_blocos: speakerBlocks.length,
      total_pontos_chave: keyPoints.length,
      chunks_processados: chunkPaths.length,
      tamanho_comprimido_mb: sizeMB.toFixed(1),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro na extração YouTube';
    console.error('[sessoes/youtube POST]', msg);
    await supabase.from('sessoes_transcritas').update({
      status: 'erro', error_msg: msg, updated_at: new Date().toISOString(),
    }).eq('id', sessaoId);
    return NextResponse.json({ error: msg, sessao_id: sessaoId }, { status: 502 });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  }
}
