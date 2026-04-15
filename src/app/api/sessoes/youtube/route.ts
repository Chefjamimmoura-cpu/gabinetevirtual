// GET /api/sessoes/youtube — Lista vídeos recentes do canal @camaraboavista
// POST /api/sessoes/youtube — Recebe URL do YouTube, extrai áudio, transcreve (fire-and-forget)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectSpeakers } from '@/lib/sessoes/speaker-detector';
import { detectKeyPoints } from '@/lib/sessoes/key-points';
import { requireAuth } from '@/lib/supabase/auth-guard';

export const maxDuration = 600; // 10 min (download + transcrição de sessões longas)

const execFileAsync = promisify(execFile);
const COOKIES_PATH = '/app/youtube-cookies.txt';

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

// ── Progress helper ──────────────────────────────────────────────────────────

async function updateProgress(
  supabase: ReturnType<typeof getSupabase>,
  sessaoId: string,
  pct: number,
  etapa: string,
  status?: string,
) {
  const update: Record<string, unknown> = {
    progresso_pct: pct,
    progresso_etapa: etapa,
    updated_at: new Date().toISOString(),
  };
  if (status) update.status = status;
  await supabase.from('sessoes_transcritas').update(update).eq('id', sessaoId);
}

// ── Auto-report generator ────────────────────────────────────────────────────

async function gerarRelatorioAutomatico(
  sessaoId: string,
  fullText: string,
  speakerBlocks: any[],
  keyPoints: any[],
  titulo: string,
  totalDuration: number,
  supabase: ReturnType<typeof getSupabase>,
) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || !fullText) return;

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const segmentos = speakerBlocks.map((b: any) => {
    const mins = Math.floor(b.start / 60);
    const secs = Math.floor(b.start % 60);
    const ts = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const label = b.isUnclear ? '[INAUDÍVEL]' : b.speaker || 'Comunicador';
    return `${ts} [${label}]: ${b.text}`;
  }).join('\n');

  const pontosTexto = (keyPoints || []).map((p: any) =>
    `- [${Math.floor(p.start / 60)}:${String(Math.floor(p.start % 60)).padStart(2, '0')}] ${p.title}: ${p.description}`
  ).join('\n');

  const durFmt = totalDuration > 3600
    ? `${Math.floor(totalDuration / 3600)}h${String(Math.floor((totalDuration % 3600) / 60)).padStart(2, '0')}m`
    : `${Math.floor(totalDuration / 60)}:${String(Math.floor(totalDuration % 60)).padStart(2, '0')}`;

  const prompt = `Gere um relatório estruturado desta sessão plenária da Câmara Municipal de Boa Vista.

TÍTULO: ${titulo}
DURAÇÃO: ${durFmt}

PONTOS-CHAVE DETECTADOS:
${pontosTexto || '(nenhum detectado)'}

TRANSCRIÇÃO COMPLETA COM INTERLOCUTORES:
${segmentos}

FORMATO DO RELATÓRIO:
### Abertura e Expediente
(resumo da abertura, quórum, ata anterior)

### Matérias em Discussão
(projetos discutidos, autores, posições dos vereadores)

### Votações e Deliberações
(resultado de cada votação: aprovado/rejeitado, placar se mencionado)

### Pronunciamentos na Tribuna
(resumo dos discursos, tema de cada um, quem falou)

### Encerramento
(horário, próxima sessão se mencionado)

REGRAS:
1. Use APENAS informações presentes na transcrição
2. Trechos marcados [INAUDÍVEL] → "(trecho inaudível)"
3. Mantenha nomes dos interlocutores como estão
4. Seja objetivo e factual
5. Para pronunciamentos na tribuna, resuma cada discurso em 2-3 frases no máximo
6. O relatório COMPLETO deve caber em até 3 páginas — seja conciso
7. NUNCA interrompa o relatório no meio — sempre termine com a seção Encerramento`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
  });

  const relatorio = result.response?.text();
  if (relatorio) {
    await supabase.from('sessoes_transcritas').update({
      relatorio,
      updated_at: new Date().toISOString(),
    }).eq('id', sessaoId);
  }
}

// ── Fallback: transcrição via Gemini ─────────────────────────────────────────

async function transcreverComGemini(
  audioPath: string,
  chunkIndex: number,
): Promise<any | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.error('[sessoes] Gemini fallback: GEMINI_API_KEY não configurada');
    return null;
  }

  try {
    const audioBuffer = fs.readFileSync(audioPath);
    const base64Audio = audioBuffer.toString('base64');

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: base64Audio,
            },
          },
          {
            text: `Transcreva este áudio em português brasileiro. Retorne APENAS um JSON válido (sem markdown, sem backticks) neste formato exato:
{
  "text": "texto completo da transcrição",
  "duration": 600,
  "segments": [
    {"start": 0.0, "end": 5.2, "text": "frase transcrita", "avg_logprob": -0.3, "no_speech_prob": 0.01},
    {"start": 5.5, "end": 10.1, "text": "outra frase", "avg_logprob": -0.3, "no_speech_prob": 0.01}
  ],
  "words": [
    {"word": "palavra", "start": 0.0, "end": 0.5},
    {"word": "outra", "start": 0.6, "end": 1.0}
  ]
}

Regras:
- Segmentos de 3-8 segundos cada
- Timestamps precisos em segundos (float)
- Inclua TODAS as palavras no array words
- duration = duração total do áudio em segundos
- Retorne APENAS o JSON, nada mais`,
          },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 65536 },
    });

    const responseText = result.response?.text()?.trim();
    if (!responseText) return null;

    // Limpar possíveis backticks/markdown
    const cleaned = responseText
      .replace(/^```json?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    console.log(`[sessoes] Gemini fallback chunk ${chunkIndex}: ${parsed.segments?.length || 0} segments`);
    return parsed;
  } catch (err: any) {
    console.error(`[sessoes] Gemini fallback falhou chunk ${chunkIndex}:`, err?.message?.slice(0, 200));
    return null;
  }
}

// ── Background processing function ──────────────────────────────────────────

async function processarTranscricao(
  sessaoId: string,
  url: string,
  titulo: string,
  groqKey: string,
  supabase: ReturnType<typeof getSupabase>,
  gId: string | null,
) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt_sessao_'));
  const rawPath = path.join(tmpDir, 'raw_audio');
  const compressedPath = path.join(tmpDir, 'audio.mp3');

  try {
    // ── 1. Download áudio ──
    // Detecta se é URL YouTube (ou plataforma suportada por yt-dlp) ou link direto
    // de arquivo (Nextcloud, Drive, OneDrive, S3, http genérico).
    const isYoutube = /(?:youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|facebook\.com|instagram\.com)/i.test(url);

    if (isYoutube) {
      await updateProgress(supabase, sessaoId, 5, 'Baixando áudio do YouTube...');
      const cookieArgs = fs.existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
      await execFileAsync('yt-dlp', [
        ...cookieArgs,
        '-x', '--audio-format', 'mp3',
        '--no-playlist',
        '--no-check-certificates',
        '--js-runtimes', 'node',
        '--remote-components', 'ejs:github',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        '--no-warnings',
        '-o', rawPath + '.%(ext)s',
        url,
      ], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });
    } else {
      // Link direto de arquivo (Nextcloud/Drive/OneDrive/HTTP genérico)
      await updateProgress(supabase, sessaoId, 5, 'Baixando arquivo da nuvem...');

      // Nextcloud public share → adicionar /download se não estiver
      let downloadUrl = url;
      if (/\/index\.php\/s\/[A-Za-z0-9]+\/?$/.test(url)) {
        downloadUrl = url.replace(/\/?$/, '/download');
      }

      const res = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GabineteVirtual/1.0)',
        },
        // Sem timeout do AbortSignal — arquivos grandes demoram
      });
      if (!res.ok || !res.body) {
        throw new Error(`Falha ao baixar do link (HTTP ${res.status})`);
      }

      // Detecta extensão pelo Content-Disposition ou Content-Type
      const cd = res.headers.get('content-disposition') || '';
      const ct = res.headers.get('content-type') || '';
      let ext = 'mp3';
      const filenameMatch = cd.match(/filename\*?=(?:UTF-8'')?[\"']?([^\"';]+)[\"']?/i);
      if (filenameMatch) {
        const fn = decodeURIComponent(filenameMatch[1]);
        const m = fn.match(/\.([a-z0-9]{2,5})$/i);
        if (m) ext = m[1].toLowerCase();
      } else if (ct.includes('mpeg')) ext = 'mp3';
      else if (ct.includes('wav')) ext = 'wav';
      else if (ct.includes('ogg')) ext = 'ogg';
      else if (ct.includes('mp4') || ct.includes('m4a')) ext = 'm4a';

      const rawFilePath = `${rawPath}.${ext}`;
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(rawFilePath, buf);

      const sizeMB = buf.length / (1024 * 1024);
      await updateProgress(
        supabase,
        sessaoId,
        15,
        `Arquivo baixado (${sizeMB.toFixed(1)} MB) — preparando...`,
      );
    }

    // Encontrar arquivo baixado (yt-dlp adiciona extensão)
    const downloadedFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('raw_audio'));
    if (downloadedFiles.length === 0) throw new Error('Nenhum arquivo de áudio foi gerado/baixado');
    const downloadedPath = path.join(tmpDir, downloadedFiles[0]);

    // ── 2. Comprimir: mono, 16kHz, 32kbps (mantém qualidade de voz, reduz tamanho) ──
    await updateProgress(supabase, sessaoId, 20, 'Comprimindo áudio...');

    await execFileAsync('ffmpeg', [
      '-i', downloadedPath,
      '-ac', '1',          // mono
      '-ar', '16000',      // 16kHz (suficiente para voz)
      '-b:a', '32k',       // 32kbps
      '-nostdin',          // sem input interativo
      '-y', compressedPath,
    ], { timeout: 300_000, maxBuffer: 50 * 1024 * 1024 });

    const audioSize = fs.statSync(compressedPath).size;
    const sizeMB = audioSize / (1024 * 1024);

    // ── 3. Chunking se > 24MB ──
    await updateProgress(supabase, sessaoId, 25, 'Preparando transcrição...');

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

      // Dividir em chunks de ~10 minutos (menor pressão no rate limit)
      const chunkDuration = 600; // 10 min
      const numChunks = Math.ceil(totalDuration / chunkDuration);

      for (let i = 0; i < numChunks; i++) {
        const chunkPath = path.join(tmpDir, `chunk_${i}.mp3`);
        const startSec = i * chunkDuration;
        await execFileAsync('ffmpeg', [
          '-i', compressedPath,
          '-ss', String(startSec),
          '-t', String(chunkDuration),
          '-ac', '1', '-ar', '16000', '-b:a', '32k',
          '-nostdin', '-y', chunkPath,
        ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
        if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 1000) {
          chunkPaths.push(chunkPath);
        }
      }
    }

    // ── 4. Transcrever cada chunk via Groq (com retry) ──
    await updateProgress(supabase, sessaoId, 30, 'Transcrevendo...', 'transcrevendo');

    const allSegments: any[] = [];
    const allWords: any[] = [];
    let fullText = '';
    let totalDuration = 0;
    let segIdOffset = 0;
    let timeOffset = 0;

    for (let ci = 0; ci < chunkPaths.length; ci++) {
      const chunkPct = Math.round(30 + (ci / chunkPaths.length) * 60);
      await updateProgress(supabase, sessaoId, chunkPct, `Transcrevendo trecho ${ci + 1} de ${chunkPaths.length}...`);

      const chunkBuf = fs.readFileSync(chunkPaths[ci]);
      const chunkBlob = new Blob([chunkBuf], { type: 'audio/mp3' });
      const chunkFile = new File([chunkBlob], `chunk_${ci}.mp3`, { type: 'audio/mp3' });

      // Retry com backoff (rate limit 20 RPM) + fallback Gemini
      let groqData: any = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        const groqForm = new FormData();
        groqForm.append('file', chunkFile, `chunk_${ci}.mp3`);
        groqForm.append('model', 'whisper-large-v3-turbo');
        groqForm.append('response_format', 'verbose_json');
        groqForm.append('language', 'pt');
        groqForm.append('timestamp_granularities[]', 'word');
        groqForm.append('timestamp_granularities[]', 'segment');

        const abortCtrl = new AbortController();
        const fetchTimeout = setTimeout(() => abortCtrl.abort(), 120_000); // 2 min timeout

        try {
          const groqRes = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqKey}` },
            body: groqForm,
            signal: abortCtrl.signal,
          });

          clearTimeout(fetchTimeout);

          if (groqRes.ok) {
            groqData = await groqRes.json();
            break;
          }

          if (groqRes.status === 429) {
            const retryAfter = parseInt(groqRes.headers.get('retry-after') || '30');
            const waitMs = Math.max(retryAfter * 1000, (attempt + 1) * 15_000);
            console.log(`[sessoes] Groq 429 chunk ${ci}, esperando ${waitMs}ms...`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }

          const errText = await groqRes.text();
          console.error(`[sessoes] Groq erro ${groqRes.status} chunk ${ci}:`, errText.slice(0, 200));
        } catch (fetchErr: any) {
          clearTimeout(fetchTimeout);
          if (fetchErr?.name === 'AbortError') {
            console.error(`[sessoes] Groq timeout chunk ${ci}, tentativa ${attempt + 1}`);
          } else {
            console.error(`[sessoes] Groq fetch erro chunk ${ci}:`, fetchErr?.message?.slice(0, 200));
          }
        }
      }

      // Fallback: Gemini se Groq falhou
      if (!groqData) {
        await updateProgress(supabase, sessaoId, chunkPct,
          `Groq falhou no trecho ${ci + 1}, tentando Gemini...`);

        const geminiResult = await transcreverComGemini(chunkPaths[ci], ci);
        if (geminiResult) {
          groqData = geminiResult;
        } else {
          throw new Error(`Falha na transcrição do trecho ${ci + 1}: Groq e Gemini falharam`);
        }
      }

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
    await updateProgress(supabase, sessaoId, 92, 'Detectando interlocutores...');

    // ── 6. Upload do áudio comprimido para Storage (player + waveform) ──
    let audioStoragePath: string | null = null;
    try {
      const audioBuf = fs.readFileSync(compressedPath);
      const gIdFolder = (gId || 'shared').replace(/[^a-zA-Z0-9_-]/g, '_');
      audioStoragePath = `sessoes/${gIdFolder}/${sessaoId}.mp3`;
      const { error: upErr } = await supabase.storage
        .from('gabinete_media')
        .upload(audioStoragePath, audioBuf, {
          contentType: 'audio/mpeg',
          upsert: true,
        });
      if (upErr) {
        console.error('[sessoes/youtube] Upload áudio falhou:', upErr.message);
        audioStoragePath = null;
      }
    } catch (upErr) {
      console.error('[sessoes/youtube] Erro ao fazer upload do áudio:', upErr);
      audioStoragePath = null;
    }

    // ── 7. Salvar transcrição ──
    const expiraEm = new Date();
    expiraEm.setDate(expiraEm.getDate() + 30); // timebomb: áudio expira em 30 dias

    const updatePayload: Record<string, unknown> = {
      titulo: titulo || fullText?.substring(0, 80) || 'Sessão YouTube',
      duracao_segundos: Math.round(totalDuration),
      transcricao: { text: fullText, segments: speakerBlocks, words: allWords },
      pontos_chave: keyPoints,
      audio_storage_path: audioStoragePath,
      updated_at: new Date().toISOString(),
    };
    if (audioStoragePath) {
      updatePayload.audio_expira_em = expiraEm.toISOString();
    }

    const { error: updFinalErr } = await supabase
      .from('sessoes_transcritas')
      .update(updatePayload)
      .eq('id', sessaoId);

    if (updFinalErr && updFinalErr.message?.includes('audio_expira_em')) {
      // Campo ainda não existe no banco (migration 038 pendente) — retry sem ele
      delete updatePayload.audio_expira_em;
      await supabase.from('sessoes_transcritas').update(updatePayload).eq('id', sessaoId);
    }

    await updateProgress(supabase, sessaoId, 95, 'Gerando relatório...');

    // ── 7. Gerar relatório automaticamente ──
    try {
      await gerarRelatorioAutomatico(sessaoId, fullText, speakerBlocks, keyPoints, titulo, totalDuration, supabase);
    } catch (relErr) {
      console.error('[sessoes/youtube] Falha no relatório automático:', relErr);
    }

    // ── 8. Concluído ──
    await updateProgress(supabase, sessaoId, 100, 'Concluída!', 'concluida');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro na extração YouTube';
    console.error('[sessoes/youtube POST]', msg);
    await supabase.from('sessoes_transcritas').update({
      status: 'erro',
      error_msg: msg,
      progresso_pct: 0,
      progresso_etapa: '',
      updated_at: new Date().toISOString(),
    }).eq('id', sessaoId);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  }
}

// ── GET: Lista vídeos recentes do canal via YouTube Data API v3 ─────────────

export async function GET(req: NextRequest) {
  // Auth obrigatória — consome YouTube Data API (quota)
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

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

// ── POST: Extrair áudio de URL + transcrever (fire-and-forget) ───────────────

export async function POST(req: NextRequest) {
  // Auth obrigatória — consome Groq API + yt-dlp (custo alto)
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json({ error: 'GROQ_API_KEY não configurada' }, { status: 500 });

  let body: { url?: string; titulo?: string; gabinete_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }); }

  const { url, titulo, gabinete_id } = body;
  if (!url) return NextResponse.json({ error: 'Campo "url" é obrigatório' }, { status: 400 });

  const supabase = getSupabase();
  const gId = gabinete_id || process.env.GABINETE_ID || null;

  // Detecta tipo de fonte para metadados
  const isYoutubeUrl = /(?:youtube\.com|youtu\.be|vimeo\.com|twitch\.tv)/i.test(url);
  // NOTA: check constraint atual só permite upload|youtube|gravacao — usamos 'youtube'
  // para links externos também (a URL original fica em youtube_url).
  const fonte = 'youtube';
  const tituloDefault = isYoutubeUrl ? 'Sessão YouTube' : 'Áudio externo';

  const { data: sessao, error: insertErr } = await supabase
    .from('sessoes_transcritas')
    .insert({
      gabinete_id: gId,
      titulo: titulo || tituloDefault,
      fonte,
      youtube_url: url, // campo reaproveitado — guarda a URL original
      status: 'processando',
      progresso_pct: 0,
      progresso_etapa: 'Iniciando...',
    })
    .select('id')
    .single();

  if (insertErr || !sessao) {
    return NextResponse.json({ error: 'Falha ao criar sessão', details: insertErr?.message }, { status: 500 });
  }

  // Fire-and-forget: processar em background
  processarTranscricao(sessao.id, url, titulo || tituloDefault, groqKey, supabase, gId)
    .catch(err => console.error('[sessoes/youtube] Background error:', err));

  return NextResponse.json({ ok: true, sessao_id: sessao.id });
}
