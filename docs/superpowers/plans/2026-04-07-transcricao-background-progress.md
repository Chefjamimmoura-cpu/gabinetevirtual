# Transcrição em Background com Barra de Progresso e Relatório

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a transcrição de sessões assíncrona — o usuário clica "Transcrever", a API retorna imediatamente, e o frontend mostra progresso em tempo real via polling. O usuário pode navegar para outros menus e voltar sem perder o progresso. Ao concluir, relatório é gerado automaticamente.

**Architecture:** A rota POST `/api/sessoes/youtube` passa a retornar imediatamente após criar o registro no banco. O processamento pesado (download, compressão, transcrição, diarização) roda em background via `Promise` fire-and-forget. O progresso é atualizado no banco (`progresso_pct` + `progresso_etapa`) a cada etapa. O frontend faz polling a cada 5s enquanto houver sessões em processamento. Uma nova rota GET `/api/sessoes/progresso` retorna o estado atual das sessões ativas.

**Tech Stack:** Next.js API Routes, Supabase (banco + polling), React state management

---

## File Structure

| Ação | Arquivo | Responsabilidade |
|------|---------|-----------------|
| Modify | `src/app/api/sessoes/youtube/route.ts` | Tornar POST assíncrono, reportar progresso |
| Modify | `src/app/api/sessoes/transcrever/route.ts` | Mesmo pattern assíncrono para upload |
| Create | `src/app/api/sessoes/progresso/route.ts` | GET endpoint para polling de progresso |
| Modify | `src/app/(dashboard)/sessoes/page.tsx` | Barra de progresso, polling, background nav |
| Modify | `src/app/api/sessoes/relatorio/route.ts` | Aceitar chamada automática pós-transcrição |

---

### Task 1: Adicionar campos de progresso no banco

**Files:**
- Create: `supabase/migrations/032_sessoes_progresso.sql`

- [ ] **Step 1: Criar migration para campos de progresso**

```sql
-- Adiciona campos de progresso para tracking em tempo real
ALTER TABLE sessoes_transcritas
  ADD COLUMN IF NOT EXISTS progresso_pct SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progresso_etapa TEXT DEFAULT '';
  
COMMENT ON COLUMN sessoes_transcritas.progresso_pct IS 'Porcentagem de progresso 0-100';
COMMENT ON COLUMN sessoes_transcritas.progresso_etapa IS 'Descrição da etapa atual: Baixando áudio, Comprimindo, Transcrevendo chunk 2/5, etc';
```

- [ ] **Step 2: Executar migration no Supabase**

Aplicar via Supabase Dashboard (SQL Editor) ou CLI.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/032_sessoes_progresso.sql
git commit -m "feat(sessoes): add progress tracking fields to sessoes_transcritas"
```

---

### Task 2: Criar endpoint de polling de progresso

**Files:**
- Create: `src/app/api/sessoes/progresso/route.ts`

- [ ] **Step 1: Criar rota GET /api/sessoes/progresso**

```typescript
// GET /api/sessoes/progresso — Retorna sessões ativas (processando/transcrevendo) com progresso

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('sessoes_transcritas')
    .select('id, titulo, status, progresso_pct, progresso_etapa, error_msg, created_at')
    .in('status', ['processando', 'transcrevendo'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessoes: data || [] });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/sessoes/progresso/route.ts
git commit -m "feat(sessoes): add progress polling endpoint"
```

---

### Task 3: Tornar POST /api/sessoes/youtube assíncrono com progresso

**Files:**
- Modify: `src/app/api/sessoes/youtube/route.ts`

- [ ] **Step 1: Criar helper de atualização de progresso**

No topo do arquivo, após as constantes, adicionar:

```typescript
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
```

- [ ] **Step 2: Extrair o pipeline de processamento para uma função separada**

Mover todo o bloco `try { ... }` do POST handler (download → compress → chunk → transcribe → speakers → save) para uma função separada `processarTranscricao(sessaoId, url, titulo, supabase)` que roda em background.

A função deve chamar `updateProgress()` em cada etapa:
- 5%: `Baixando áudio do YouTube...`
- 20%: `Comprimindo áudio...`
- 25%: `Preparando transcrição...`
- 30-90%: `Transcrevendo trecho N de M...` (distribuir proporcionalmente)
- 92%: `Detectando interlocutores...`
- 95%: `Gerando relatório automático...`
- 100%: (status → concluida)

- [ ] **Step 3: Fazer POST retornar imediatamente**

O handler POST deve:
1. Validar input
2. Criar registro no banco com status `processando`
3. Disparar `processarTranscricao()` em background (fire-and-forget com `.catch()`)
4. Retornar imediatamente com `{ ok: true, sessao_id }`

```typescript
export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json({ error: 'GROQ_API_KEY não configurada' }, { status: 500 });

  let body: { url?: string; titulo?: string; gabinete_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }); }

  const { url, titulo, gabinete_id } = body;
  if (!url) return NextResponse.json({ error: 'Campo "url" é obrigatório' }, { status: 400 });

  const supabase = getSupabase();
  const gId = gabinete_id || process.env.GABINETE_ID || null;

  const { data: sessao, error: insertErr } = await supabase
    .from('sessoes_transcritas')
    .insert({
      gabinete_id: gId,
      titulo: titulo || 'Sessão YouTube',
      fonte: 'youtube',
      youtube_url: url,
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
  processarTranscricao(sessao.id, url, titulo || 'Sessão YouTube', groqKey, supabase)
    .catch(err => {
      console.error('[sessoes/youtube] Background error:', err);
    });

  return NextResponse.json({ ok: true, sessao_id: sessao.id });
}
```

- [ ] **Step 4: Dentro de processarTranscricao, adicionar progresso granular**

```typescript
async function processarTranscricao(
  sessaoId: string,
  url: string,
  titulo: string,
  groqKey: string,
  supabase: ReturnType<typeof getSupabase>,
) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt_sessao_'));
  const rawPath = path.join(tmpDir, 'raw_audio');
  const compressedPath = path.join(tmpDir, 'audio.mp3');

  try {
    // ── 1. Download ──
    await updateProgress(supabase, sessaoId, 5, 'Baixando áudio do YouTube...');
    const cookieArgs = fs.existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
    await execFileAsync('yt-dlp', [
      ...cookieArgs,
      '-x', '--audio-format', 'mp3',
      '--no-playlist', '--no-check-certificates',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--no-warnings',
      '-o', rawPath + '.%(ext)s',
      url,
    ], { timeout: 300_000 });

    const downloadedFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('raw_audio'));
    if (downloadedFiles.length === 0) throw new Error('yt-dlp não gerou arquivo de áudio');
    const downloadedPath = path.join(tmpDir, downloadedFiles[0]);

    // ── 2. Comprimir ──
    await updateProgress(supabase, sessaoId, 20, 'Comprimindo áudio...');
    await execFileAsync('ffmpeg', [
      '-i', downloadedPath,
      '-ac', '1', '-ar', '16000', '-b:a', '32k',
      '-y', compressedPath,
    ], { timeout: 120_000 });

    // ── 3. Chunking ──
    await updateProgress(supabase, sessaoId, 25, 'Preparando transcrição...');
    const audioSize = fs.statSync(compressedPath).size;
    const MAX_CHUNK = 24 * 1024 * 1024;
    const chunkPaths: string[] = [];

    if (audioSize <= MAX_CHUNK) {
      chunkPaths.push(compressedPath);
    } else {
      // ... (chunking existente, sem mudança)
    }

    // ── 4. Transcrever cada chunk ──
    await updateProgress(supabase, sessaoId, 30, 'Transcrevendo...', 'transcrevendo');

    const allSegments: any[] = [];
    const allWords: any[] = [];
    let fullText = '';
    let totalDuration = 0;
    let segIdOffset = 0;
    let timeOffset = 0;

    for (let ci = 0; ci < chunkPaths.length; ci++) {
      const pctBase = 30;
      const pctRange = 60; // 30% a 90%
      const chunkPct = Math.round(pctBase + (ci / chunkPaths.length) * pctRange);
      await updateProgress(supabase, sessaoId, chunkPct,
        `Transcrevendo trecho ${ci + 1} de ${chunkPaths.length}...`
      );

      // ... (transcrição Groq existente, sem mudança na lógica)
    }

    // ── 5. Speaker detection ──
    await updateProgress(supabase, sessaoId, 92, 'Detectando interlocutores...');
    const speakerBlocks = detectSpeakers(allSegments, allWords, 'plenario');
    const keyPoints = detectKeyPoints(speakerBlocks);

    // ── 6. Salvar transcrição ──
    await updateProgress(supabase, sessaoId, 95, 'Gerando relatório...');
    await supabase.from('sessoes_transcritas').update({
      titulo: titulo || fullText?.substring(0, 80) || 'Sessão YouTube',
      duracao_segundos: Math.round(totalDuration),
      transcricao: { text: fullText, segments: speakerBlocks, words: allWords },
      pontos_chave: keyPoints,
      updated_at: new Date().toISOString(),
    }).eq('id', sessaoId);

    // ── 7. Gerar relatório automaticamente ──
    try {
      await gerarRelatorioAutomatico(sessaoId, fullText, speakerBlocks, keyPoints, titulo, totalDuration, supabase);
    } catch (relErr) {
      console.error('[sessoes/youtube] Falha no relatório automático:', relErr);
      // Não falha a transcrição se o relatório falhar
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
```

- [ ] **Step 5: Adicionar geração automática de relatório dentro da função**

```typescript
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
4. Seja objetivo e factual`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  });

  const relatorio = result.response?.text();
  if (relatorio) {
    await supabase.from('sessoes_transcritas').update({
      relatorio,
      updated_at: new Date().toISOString(),
    }).eq('id', sessaoId);
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/sessoes/youtube/route.ts
git commit -m "feat(sessoes): async transcription with progress tracking and auto-report"
```

---

### Task 4: Atualizar frontend com barra de progresso e navegação livre

**Files:**
- Modify: `src/app/(dashboard)/sessoes/page.tsx`

- [ ] **Step 1: Adicionar interface e estado para progresso**

Após as interfaces existentes, adicionar:

```typescript
interface SessaoProgresso {
  id: string;
  titulo: string;
  status: string;
  progresso_pct: number;
  progresso_etapa: string;
  error_msg: string | null;
}
```

No componente, adicionar estados:

```typescript
const [progressos, setProgressos] = useState<SessaoProgresso[]>([]);
const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

- [ ] **Step 2: Implementar polling automático**

Criar função de polling e useEffect:

```typescript
const fetchProgresso = useCallback(async () => {
  try {
    const res = await fetch('/api/sessoes/progresso');
    if (res.ok) {
      const data = await res.json();
      setProgressos(data.sessoes || []);

      // Se não há mais sessões ativas, parar polling e atualizar lista
      if ((data.sessoes || []).length === 0 && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        fetchSessoes(); // Atualizar lista completa
      }
    }
  } catch { /* silent */ }
}, [fetchSessoes]);

// Iniciar polling se houver sessões ativas
const startPolling = useCallback(() => {
  if (pollingRef.current) return; // Já rodando
  fetchProgresso(); // Buscar imediatamente
  pollingRef.current = setInterval(fetchProgresso, 5000);
}, [fetchProgresso]);

// Ao montar: verificar se há sessões ativas
useEffect(() => {
  fetchProgresso().then(() => {
    // Se encontrou sessões ativas, iniciar polling
  });
  return () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
  };
}, []);

// Iniciar polling quando progressos tiver itens
useEffect(() => {
  if (progressos.length > 0 && !pollingRef.current) {
    pollingRef.current = setInterval(fetchProgresso, 5000);
  }
}, [progressos.length, fetchProgresso]);
```

- [ ] **Step 3: Alterar handleYtTranscribe para retorno imediato**

```typescript
const handleYtTranscribe = async (video: { id: string; title: string; url: string }) => {
  setYtTranscribing(video.id);
  try {
    const res = await fetch('/api/sessoes/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: video.url, titulo: video.title, gabinete_id: gabineteId }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setToast({ open: true, message: 'Transcrição iniciada! Você pode navegar livremente.', variant: 'success' });
      startPolling();
      fetchSessoes();
    } else {
      setToast({ open: true, message: `Erro: ${data.error || 'Falha'}`, variant: 'danger' });
    }
  } catch {
    setToast({ open: true, message: 'Erro de rede.', variant: 'danger' });
  } finally {
    setYtTranscribing(null);
  }
};
```

- [ ] **Step 4: Criar componente de barra de progresso**

Renderizar acima da lista de sessões, para cada sessão ativa:

```tsx
{/* Barras de progresso para sessões ativas */}
{progressos.map(p => (
  <div key={p.id} style={{
    background: '#f0fdf4', border: '1px solid #bbf7d0',
    borderRadius: 12, padding: '12px 16px', marginBottom: 8,
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ fontWeight: 600, fontSize: 14, color: '#166534' }}>
        {p.titulo?.substring(0, 60) || 'Sessão'}
      </span>
      <span style={{ fontSize: 13, color: '#15803d' }}>{p.progresso_pct}%</span>
    </div>
    {/* Barra de progresso */}
    <div style={{
      background: '#dcfce7', borderRadius: 8, height: 8, overflow: 'hidden',
    }}>
      <div style={{
        background: 'linear-gradient(90deg, #22c55e, #16a34a)',
        height: '100%', borderRadius: 8,
        width: `${p.progresso_pct}%`,
        transition: 'width 0.5s ease-in-out',
      }} />
    </div>
    <div style={{ fontSize: 12, color: '#4ade80', marginTop: 4 }}>
      {p.progresso_etapa || 'Processando...'}
    </div>
  </div>
))}
```

- [ ] **Step 5: Remover bloqueio de UI durante transcrição**

Remover ou simplificar os estados `uploading`/`uploadProgress` que atualmente bloqueiam a interface. O banner antigo de "Processando..." deve ser substituído pelas barras de progresso individuais acima.

- [ ] **Step 6: Ao montar a página, verificar sessões ativas e iniciar polling**

No `useEffect` de init (que já busca o gabineteId), adicionar:

```typescript
useEffect(() => {
  fetchProgresso();
}, []);
```

Isso garante que ao voltar de outro menu, as barras de progresso aparecem imediatamente.

- [ ] **Step 7: Quando polling detectar sessão concluída, atualizar lista e mostrar toast**

Dentro de `fetchProgresso`, comparar com o estado anterior:

```typescript
const fetchProgresso = useCallback(async () => {
  try {
    const res = await fetch('/api/sessoes/progresso');
    if (res.ok) {
      const data = await res.json();
      const novas = data.sessoes || [];
      
      // Detectar sessões que terminaram (estavam no progresso anterior, agora não estão)
      const idsAtivos = new Set(novas.map((s: SessaoProgresso) => s.id));
      const concluidas = progressos.filter(p => !idsAtivos.has(p.id));
      if (concluidas.length > 0) {
        fetchSessoes();
        setToast({ open: true, message: `Transcrição concluída: ${concluidas[0].titulo}`, variant: 'success' });
      }

      setProgressos(novas);

      if (novas.length === 0 && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
  } catch { /* silent */ }
}, [fetchSessoes, progressos]);
```

- [ ] **Step 8: Commit**

```bash
git add src/app/(dashboard)/sessoes/page.tsx
git commit -m "feat(sessoes): progress bar, background processing, auto-refresh on completion"
```

---

### Task 5: Aplicar mesmo pattern assíncrono ao upload de áudio

**Files:**
- Modify: `src/app/api/sessoes/transcrever/route.ts`

- [ ] **Step 1: Aplicar o mesmo padrão fire-and-forget ao upload**

O upload de áudio local deve seguir o mesmo pattern:
1. Receber arquivo, salvar no storage
2. Criar registro com status `processando`
3. Retornar imediatamente
4. Processar em background com `updateProgress()`

As etapas de progresso para upload:
- 10%: `Recebendo arquivo...`
- 20%: `Comprimindo áudio...`
- 30-90%: `Transcrevendo trecho N de M...`
- 92%: `Detectando interlocutores...`
- 95%: `Gerando relatório...`
- 100%: Concluída

Reutilizar a mesma função `updateProgress()` e o pattern de `gerarRelatorioAutomatico()` — copiar as funções necessárias ou extraí-las para um helper compartilhado em `src/lib/sessoes/`.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/sessoes/transcrever/route.ts
git commit -m "feat(sessoes): async upload transcription with progress tracking"
```

---

### Task 6: Deploy e Teste

**Files:** Nenhum arquivo novo — operações na VPS.

- [ ] **Step 1: Executar migration no Supabase**

Via SQL Editor no Supabase Dashboard, executar:
```sql
ALTER TABLE sessoes_transcritas
  ADD COLUMN IF NOT EXISTS progresso_pct SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progresso_etapa TEXT DEFAULT '';
```

- [ ] **Step 2: Deploy na VPS**

```bash
scp arquivos-alterados root@76.13.170.230:/opt/gv/...
ssh root@76.13.170.230 "cd /opt/gv && docker compose build --no-cache && docker compose up -d"
```

- [ ] **Step 3: Testar cenários**

1. Clicar "Transcrever" → deve retornar em <1s e mostrar barra de progresso
2. Navegar para outro menu (ex: Pareceres) → voltar → barra deve continuar aparecendo
3. Aguardar conclusão → toast "Transcrição concluída" + lista atualizada
4. Abrir sessão concluída → relatório já gerado automaticamente
5. Testar upload de arquivo de áudio → mesmo comportamento assíncrono
