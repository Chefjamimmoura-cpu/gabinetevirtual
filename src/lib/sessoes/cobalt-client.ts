// Cobalt API client — extrai áudio de vídeos do YouTube
// Docs: https://github.com/imputnet/cobalt/blob/main/docs/api.md

import fs from 'fs';
import path from 'path';

const COBALT_URL = process.env.COBALT_API_URL || 'http://cobalt:9000';

interface CobaltResponse {
  status: 'tunnel' | 'redirect' | 'error';
  url?: string;
  error?: string;
}

/**
 * Extrai URL de download de áudio via Cobalt API.
 * Retorna a URL direta do stream de áudio.
 */
async function getCobaltAudioUrl(youtubeUrl: string): Promise<string> {
  const res = await fetch(COBALT_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: youtubeUrl,
      downloadMode: 'audio',
      audioFormat: 'mp3',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cobalt API erro ${res.status}: ${text}`);
  }

  const data: CobaltResponse = await res.json();

  if (data.status === 'error') {
    throw new Error(`Cobalt: ${data.error || 'Erro desconhecido'}`);
  }

  if (!data.url) {
    throw new Error('Cobalt não retornou URL de download');
  }

  return data.url;
}

/**
 * Baixa áudio de um vídeo do YouTube para um arquivo local via Cobalt.
 * @param youtubeUrl - URL do vídeo no YouTube
 * @param outputPath - Caminho absoluto do arquivo de saída (ex: /tmp/xyz/raw_audio.mp3)
 * @param timeoutMs - Timeout em ms (default 5 min)
 */
export async function downloadAudioViaCobalt(
  youtubeUrl: string,
  outputPath: string,
  timeoutMs = 300_000,
): Promise<void> {
  // 1. Obter URL do stream de áudio
  const audioUrl = await getCobaltAudioUrl(youtubeUrl);

  // 2. Baixar o stream para arquivo local
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(audioUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Download falhou: HTTP ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    // Garantir que o diretório existe
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);

    if (fs.statSync(outputPath).size < 1000) {
      throw new Error('Arquivo de áudio muito pequeno — download pode ter falhado');
    }
  } finally {
    clearTimeout(timeout);
  }
}
