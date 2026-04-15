# Cobalt API — Substituir yt-dlp para Extração de Áudio YouTube

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir yt-dlp (bloqueado pelo YouTube) pelo Cobalt API self-hosted para extrair áudio MP3 de vídeos do YouTube, mantendo o pipeline de transcrição Groq Whisper intacto.

**Architecture:** Deploy do Cobalt como container Docker na mesma VPS, na rede `proxy` do Traefik. A rota POST `/api/sessoes/youtube` chama Cobalt via HTTP interno (`http://cobalt:9000`) em vez de spawnar `yt-dlp`. O resto do pipeline (ffmpeg compress → Groq Whisper → speaker detection → key points) não muda.

**Tech Stack:** Docker, Cobalt API (self-hosted), Next.js API Routes, ffmpeg, Groq Whisper API

---

## File Structure

| Ação | Arquivo | Responsabilidade |
|------|---------|-----------------|
| Modify | `docker-compose.yml` | Adicionar serviço `cobalt` |
| Modify | `Dockerfile` | Remover `pip3 install yt-dlp` |
| Create | `src/lib/sessoes/cobalt-client.ts` | Cliente HTTP para Cobalt API |
| Modify | `src/app/api/sessoes/youtube/route.ts` | Substituir yt-dlp por Cobalt client |
| Remove | `src/app/api/sessoes/youtube/auth/route.ts` | OAuth device code flow (não precisa mais) |

---

### Task 1: Adicionar Cobalt ao docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Adicionar serviço cobalt ao docker-compose.yml**

Adicionar o serviço `cobalt` após o serviço `gabinete-virtual`. Cobalt v10+ usa a imagem `ghcr.io/imputnet/cobalt:10`. A API roda na porta 9000 internamente. Não precisa de label Traefik (acesso somente interno).

No `docker-compose.yml`, adicionar antes do bloco `volumes:`:

```yaml
  cobalt:
    image: ghcr.io/imputnet/cobalt:10
    container_name: cobalt
    restart: unless-stopped
    environment:
      - API_URL=http://cobalt:9000
      - CORS_WILDCARD=0
      - DURATION_LIMIT=18000
    networks:
      - proxy
```

`DURATION_LIMIT=18000` = 5 horas (sessões plenárias podem ter 2-3h).

- [ ] **Step 2: Adicionar env COBALT_API_URL ao gabinete-virtual**

No bloco `environment` do serviço `gabinete-virtual`, adicionar:

```yaml
      # Cobalt API (extração de áudio YouTube)
      - COBALT_API_URL=http://cobalt:9000
```

- [ ] **Step 3: Remover volume yt-dlp-cache**

Remover do serviço `gabinete-virtual`:
```yaml
    volumes:
      - yt-dlp-cache:/home/nextjs/.cache/yt-dlp
```

E remover do bloco `volumes:` no final:
```yaml
volumes:
  yt-dlp-cache:
    driver: local
```

O bloco `volumes:` inteiro pode ser removido pois era o único volume.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(sessoes): add Cobalt container for YouTube audio extraction"
```

---

### Task 2: Criar cliente HTTP para Cobalt API

**Files:**
- Create: `src/lib/sessoes/cobalt-client.ts`

- [ ] **Step 1: Criar src/lib/sessoes/cobalt-client.ts**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sessoes/cobalt-client.ts
git commit -m "feat(sessoes): add Cobalt API client for audio download"
```

---

### Task 3: Substituir yt-dlp por Cobalt na rota POST /api/sessoes/youtube

**Files:**
- Modify: `src/app/api/sessoes/youtube/route.ts`

- [ ] **Step 1: Remover imports e helpers de yt-dlp**

Remover do topo do arquivo (linhas 5-6, 14-41):

- O import de `execFile` e `promisify` (não serão mais necessários para download; manter apenas se usados pelo ffmpeg — verificar)
- Todo o bloco `YT_DLP_CACHE`, `COOKIES_PATH`, `isAuthenticated()`, `getAuthArgs()`

Na verdade, `execFile`/`promisify`/`execFileAsync` ainda são usados pelo ffmpeg (compressão e chunking). Manter esses imports. Remover apenas:

```typescript
// REMOVER linhas 14-41:
const YT_DLP_CACHE = path.join(os.homedir(), '.cache', 'yt-dlp');
const COOKIES_PATH = path.join(YT_DLP_CACHE, 'cookies.txt');
function isAuthenticated(): boolean { ... }
function getAuthArgs(): string[] { ... }
```

- [ ] **Step 2: Adicionar import do cobalt-client**

Após o import de `detectKeyPoints`, adicionar:

```typescript
import { downloadAudioViaCobalt } from '@/lib/sessoes/cobalt-client';
```

- [ ] **Step 3: Substituir bloco de download yt-dlp por Cobalt**

Substituir todo o bloco de download (linhas 195-245 aproximadamente) por:

```typescript
    // ── 1. Download áudio via Cobalt API ──
    await supabase.from('sessoes_transcritas').update({ status: 'processando' }).eq('id', sessaoId);

    const downloadedPath = path.join(tmpDir, 'raw_audio.mp3');
    await downloadAudioViaCobalt(url, downloadedPath);
```

Isso substitui ~50 linhas de yt-dlp (args, auth, retry, fallback) por 2 linhas.

O resto do pipeline permanece idêntico:
- ffmpeg comprime para mono/16kHz/32kbps (linha 248+)
- Chunking se > 24MB (linha 260+)
- Groq Whisper transcreve (linha 293+)
- Speaker detection + key points (linha 376+)

- [ ] **Step 4: Remover o import de `os` se não for mais usado**

Verificar: `os` era usado para `os.homedir()` (yt-dlp cache) e `os.tmpdir()`. Como `os.tmpdir()` ainda é usado na linha 190, manter o import de `os`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sessoes/youtube/route.ts
git commit -m "feat(sessoes): replace yt-dlp with Cobalt API for YouTube download"
```

---

### Task 4: Limpar Dockerfile (remover yt-dlp)

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Remover yt-dlp do Dockerfile**

Na linha 41-42, substituir:

```dockerfile
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-por poppler-utils ffmpeg python3 py3-pip nodejs-current \
    && pip3 install --break-system-packages yt-dlp
```

Por:

```dockerfile
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-por poppler-utils ffmpeg
```

Remover `python3`, `py3-pip`, `nodejs-current` — eram necessários apenas para yt-dlp.

- [ ] **Step 2: Remover criação do diretório cache yt-dlp**

Na linha 65, remover:

```dockerfile
RUN mkdir -p /home/nextjs/.cache/yt-dlp && chown -R nextjs:nodejs /home/nextjs
```

Substituir por (ainda precisa do home dir para Node):

```dockerfile
RUN chown -R nextjs:nodejs /home/nextjs
```

- [ ] **Step 3: Atualizar comentário**

Na linha 39, alterar:

```dockerfile
# OCR para extração de matérias de PDFs baseados em imagem (pautas da CMBV)
# yt-dlp + ffmpeg para extração de áudio de vídeos do YouTube (módulo Transcrição)
# Instala yt-dlp via pip (versão mais recente) pois a do Alpine pode estar desatualizada
```

Para:

```dockerfile
# OCR para extração de matérias de PDFs baseados em imagem (pautas da CMBV)
# ffmpeg para compressão de áudio (módulo Transcrição de Sessões)
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "chore: remove yt-dlp from Dockerfile, audio extraction now via Cobalt"
```

---

### Task 5: Remover rota de autenticação OAuth (não mais necessária)

**Files:**
- Remove: `src/app/api/sessoes/youtube/auth/route.ts`

- [ ] **Step 1: Verificar se há referências à rota auth no frontend**

Buscar por `/api/sessoes/youtube/auth` no codebase. Se houver referências no frontend (ex: botão "Autenticar YouTube"), remover o botão/código correspondente.

- [ ] **Step 2: Remover o arquivo**

```bash
rm src/app/api/sessoes/youtube/auth/route.ts
```

Se o diretório `auth/` ficar vazio, remover também:

```bash
rmdir src/app/api/sessoes/youtube/auth/
```

- [ ] **Step 3: Commit**

```bash
git add -A src/app/api/sessoes/youtube/auth/
git commit -m "chore: remove YouTube OAuth auth route, no longer needed with Cobalt"
```

---

### Task 6: Deploy e Teste na VPS

**Files:** Nenhum arquivo novo — operações na VPS.

- [ ] **Step 1: Fazer deploy na VPS**

No servidor, no diretório do projeto:

```bash
docker compose pull cobalt
docker compose up -d --build
```

Isso vai:
1. Baixar a imagem do Cobalt
2. Rebuildar gabinete-virtual (sem yt-dlp)
3. Subir ambos os containers

- [ ] **Step 2: Verificar que Cobalt está rodando**

```bash
docker compose ps
# cobalt deve estar "Up"

# Testar Cobalt diretamente:
docker exec gabinete-virtual curl -s -X POST http://cobalt:9000 \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","downloadMode":"audio","audioFormat":"mp3"}'
```

Resposta esperada: `{"status":"tunnel","url":"https://..."}`

- [ ] **Step 3: Testar transcrição end-to-end**

Na UI em `gabinete.wonetechnology.cloud/sessoes`:
1. Ir na aba "YouTube CMBV"
2. Clicar "Transcrever" em um vídeo recente
3. Verificar que status muda para "Processando..." → "Transcrevendo..." → "Concluída"
4. Abrir sessão e verificar transcrição com blocos de interlocutores

- [ ] **Step 4: Verificar logs se houver erro**

```bash
docker compose logs gabinete-virtual --tail 50
docker compose logs cobalt --tail 20
```
