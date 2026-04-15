# ALIA Core Engine — Phase 2: Orchestration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 2 monolithic routes (webhook 809 lines + chat 689 lines) with a clean Gateway → Brain → Agent Pool architecture. Every channel flows through the same orchestrator, all agents share the unified persona and memory from Phase 1.

**Architecture:** 
- **Gateway** normalizes input from any channel (WhatsApp, Dashboard, Email, Cron) into `AliaRequest` and formats output into channel-specific responses.
- **Brain** is the single orchestrator: classifies intent, selects model, injects memory + RAG, executes agents, synthesizes response.
- **Agent Pool** provides a standard `AliaAgent` interface. Phase 2 migrates the 9 existing webhook tools + 4 chat tools into proper agents.
- **Model Selector** routes to Gemini Flash (routine), Gemini Pro (complex), or Claude (deep analysis) based on agent and complexity signals.

**Tech Stack:** TypeScript, Next.js App Router, Supabase, Google Generative AI, Anthropic SDK, existing Evolution API helpers

**Spec:** `docs/superpowers/specs/2026-04-09-alia-core-engine-design.md` — Section 6

**Dependencies from Phase 1:** `types.ts`, `memory.ts` (recall, formatMemoryContext), `persona.ts` (buildSystemPrompt)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/alia/gateway.ts` | `AliaRequest`/`AliaResponse` types + `normalizeRequest()` + `formatResponse()` |
| `src/lib/alia/adapters/whatsapp.ts` | Evolution API ↔ AliaRequest adapter (extract text/media, send response) |
| `src/lib/alia/adapters/dashboard.ts` | Dashboard chat ↔ AliaRequest adapter |
| `src/lib/alia/classifier.ts` | Intent classification — determines which agent(s) to invoke |
| `src/lib/alia/model-selector.ts` | Model selection per agent type + complexity signals |
| `src/lib/alia/brain.ts` | Central orchestrator: classify → plan → execute → synthesize |
| `src/lib/alia/agents/agent.interface.ts` | `AliaAgent` interface + `AgentResult` type |
| `src/lib/alia/agents/cadin.agent.ts` | CADIN queries (authorities, birthdays, contacts) |
| `src/lib/alia/agents/indicacao.agent.ts` | Indicações (register, list, protocol, status) |
| `src/lib/alia/agents/oficio.agent.ts` | Official letter drafting |
| `src/lib/alia/agents/agenda.agent.ts` | Calendar events |
| `src/lib/alia/agents/parecer.agent.ts` | Parecer relator generation |
| `src/lib/alia/agents/ordem-dia.agent.ts` | Order of the day queries |
| `src/lib/alia/agents/general.agent.ts` | General conversation + RAG |
| `src/lib/alia/agents/caderno-pdf.agent.ts` | CADIN PDF generation |

### Modified Files

| File | Change |
|------|--------|
| `src/app/api/alia/webhook/route.ts` | Slim down to ~120 lines: parse Evolution webhook → adapter → brain → send response |
| `src/app/api/laia/chat/route.ts` | Slim down to ~80 lines: parse request → adapter → brain → return JSON |

---

## Task 1: Gateway Types & Normalization

**Files:**
- Create: `src/lib/alia/gateway.ts`

- [ ] **Step 1: Create the gateway module**

```typescript
// src/lib/alia/gateway.ts
// Normalizes input from any channel into AliaRequest and formats output.

import type { AgentType, ChannelType, RenderMode } from './types';

// ── Request ──────────────────────────────────────────────────────────────────

export interface MediaAttachment {
  type: 'image' | 'audio' | 'document' | 'video';
  base64: string;
  filename?: string;
  mime: string;
  caption?: string;
}

export interface AliaRequest {
  channel: ChannelType;
  session_id: string;
  gabinete_id: string;
  sender: {
    phone?: string;
    profile_id?: string;
    email?: string;
    name: string;
  };
  content: {
    text: string;
    media?: MediaAttachment[];
  };
  page_context?: string;
  timestamp: string;
  is_proactive: boolean;
}

// ── Response ─────────────────────────────────────────────────────────────────

export interface AliaAction {
  tool: string;
  params: Record<string, unknown>;
  result: string;
}

export interface AliaResponse {
  text: string;
  channel_format: {
    whatsapp?: string;
    dashboard?: string;
    email?: string;
  };
  actions: AliaAction[];
  memories_created: string[];
  agent_used: AgentType;
  model_used: string;
  suggestions?: string[];
  render_mode?: RenderMode;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/gateway.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/alia/gateway.ts
git commit -m "feat(alia): add gateway types for request/response normalization

AliaRequest and AliaResponse interfaces for the orchestrator.
Every channel adapter converts to/from these types."
```

---

## Task 2: Agent Interface

**Files:**
- Create: `src/lib/alia/agents/agent.interface.ts`

- [ ] **Step 1: Create the agent interface**

```typescript
// src/lib/alia/agents/agent.interface.ts
// Standard interface that every ALIA agent implements.

import type { AgentType } from '../types';
import type { AliaMemory } from '../types';

// ── Agent Context ────────────────────────────────────────────────────────────

export interface AgentContext {
  memories: AliaMemory[];
  ragContext?: string;
  crossModuleData?: Record<string, unknown>;
  gabineteId: string;
  sessionId: string;
  channel: string;
}

// ── Agent Result ─────────────────────────────────────────────────────────────

export interface AgentResult {
  success: boolean;
  content: string;
  structured?: Record<string, unknown>;
  actions_taken?: string[];
  suggested_memories?: Array<{
    tipo: 'preference' | 'decision' | 'relation' | 'pattern';
    subject: string;
    content: string;
  }>;
}

// ── Agent Interface ──────────────────────────────────────────────────────────

export interface AliaAgent {
  name: AgentType;
  description: string;

  execute(params: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult>;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/agents/agent.interface.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/alia/agents/agent.interface.ts
git commit -m "feat(alia): add standard AliaAgent interface

AliaAgent, AgentContext, AgentResult types.
Every agent module implements this interface."
```

---

## Task 3: Model Selector

**Files:**
- Create: `src/lib/alia/model-selector.ts`

- [ ] **Step 1: Create the model selector**

```typescript
// src/lib/alia/model-selector.ts
// Selects AI model per agent type and complexity signals.
// Gemini Flash (routine) → Gemini Pro (complex) → Claude (deep analysis)

import type { AgentType, ChannelType } from './types';

export type ModelId =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-6'
  | 'groq-whisper';

interface ModelConfig {
  default: ModelId;
  upgrade?: ModelId;
}

// ── Agent → Model mapping ────────────────────────────────────────────────────

const AGENT_MODELS: Record<AgentType, ModelConfig> = {
  cadin:       { default: 'gemini-2.5-flash' },
  indicacao:   { default: 'gemini-2.5-flash' },
  agenda:      { default: 'gemini-2.5-flash' },
  oficio:      { default: 'gemini-2.5-flash' },
  ordem_dia:   { default: 'gemini-2.5-flash' },
  comissao:    { default: 'gemini-2.5-flash' },
  general:     { default: 'gemini-2.5-flash' },
  parecer:     { default: 'gemini-2.5-pro', upgrade: 'claude-sonnet-4-6' },
  relator:     { default: 'gemini-2.5-pro', upgrade: 'claude-sonnet-4-6' },
  pls:         { default: 'claude-sonnet-4-6' },
  crossmodule: { default: 'claude-sonnet-4-6' },
  email:       { default: 'gemini-2.5-flash', upgrade: 'claude-sonnet-4-6' },
  sessao:      { default: 'gemini-2.5-flash' },
};

// ── Complexity signals ───────────────────────────────────────────────────────

interface ComplexitySignals {
  multiIntent?: boolean;     // Multiple agents needed
  longContext?: boolean;      // Large RAG context or history
  legalAnalysis?: boolean;   // Requires legal reasoning
  crossModule?: boolean;     // Cross-module data needed
}

// ── Public API ───────────────────────────────────────────────────────────────

export function selectModel(
  agent: AgentType,
  channel: ChannelType,
  signals?: ComplexitySignals,
): ModelId {
  const config = AGENT_MODELS[agent] ?? AGENT_MODELS.general;

  // If complexity signals suggest upgrade and upgrade model exists
  if (config.upgrade && signals) {
    const shouldUpgrade =
      signals.multiIntent ||
      signals.legalAnalysis ||
      signals.crossModule ||
      signals.longContext;

    if (shouldUpgrade) return config.upgrade;
  }

  return config.default;
}

export function isGeminiModel(model: ModelId): boolean {
  return model.startsWith('gemini-');
}

export function isClaudeModel(model: ModelId): boolean {
  return model.startsWith('claude-');
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/model-selector.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/alia/model-selector.ts
git commit -m "feat(alia): add model selector for multi-provider routing

Gemini Flash (routine), Gemini Pro (complex), Claude (deep analysis).
Complexity signals trigger model upgrades per agent."
```

---

## Task 4: Intent Classifier

**Files:**
- Create: `src/lib/alia/classifier.ts`

- [ ] **Step 1: Create the classifier module**

The classifier detects which agent(s) should handle a request. It uses keyword matching (evolved from the existing `router.ts`) plus optional Gemini classification for ambiguous cases.

```typescript
// src/lib/alia/classifier.ts
// Intent classification — determines which agent(s) to invoke.
// First pass: keyword matching (fast, no API call).
// Ambiguous cases: Gemini Flash classification (slower, more accurate).

import type { AgentType, ChannelType } from './types';

export interface Intent {
  agent: AgentType;
  action: string;
  confidence: number;
  priority: number;
}

// ── Keyword signals ──────────────────────────────────────────────────────────

interface KeywordSignal {
  keywords: string[];
  agent: AgentType;
  action: string;
  boost: number;
}

const SIGNALS: KeywordSignal[] = [
  // CADIN: authorities, contacts
  {
    keywords: [
      'secretário', 'secretaria', 'secretária', 'prefeito', 'governador',
      'vereador', 'deputado', 'autoridade', 'contato', 'telefone',
      'quem é', 'quem ocupa', 'responsável', 'titular', 'cargo', 'órgão',
      'autarquia', 'fundação', 'procurador', 'juiz', 'desembargador',
    ],
    agent: 'cadin',
    action: 'consultar',
    boost: 2,
  },
  // CADIN: birthdays
  {
    keywords: [
      'aniversário', 'aniversários', 'aniversariante', 'nasceu', 'faz anos',
      'parabéns', 'data de nascimento', 'quem faz aniversário',
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    ],
    agent: 'cadin',
    action: 'aniversarios',
    boost: 3,
  },
  // Indicações
  {
    keywords: [
      'indicação', 'indicacao', 'demanda', 'buraco', 'iluminação',
      'tapa-buraco', 'rua', 'bairro', 'registrar', 'protocolar',
      '!nova', '!lista', '!protocolar', '!status',
    ],
    agent: 'indicacao',
    action: 'registrar',
    boost: 2,
  },
  // Pareceres
  {
    keywords: [
      'parecer', 'relator', 'relatoria', 'voto', 'favorável', 'contrário',
      'comissão', 'matéria', 'pl ', 'pll ', 'projeto de lei',
    ],
    agent: 'parecer',
    action: 'gerar',
    boost: 2,
  },
  // Ordem do dia
  {
    keywords: [
      'ordem do dia', 'pauta', 'sessão', 'plenária', 'plenário',
      'votação', 'discussão', 'segunda discussão', 'primeira discussão',
    ],
    agent: 'ordem_dia',
    action: 'consultar',
    boost: 2,
  },
  // Ofícios
  {
    keywords: [
      'ofício', 'oficio', 'carta', 'correspondência', 'redigir',
      'minuta', 'redação oficial',
    ],
    agent: 'oficio',
    action: 'criar',
    boost: 2,
  },
  // Agenda
  {
    keywords: [
      'agenda', 'evento', 'compromisso', 'reunião', 'agendar',
      'marcar', 'calendário', 'horário',
    ],
    agent: 'agenda',
    action: 'marcar',
    boost: 1,
  },
  // Comissões
  {
    keywords: [
      'comissão', 'comissao', 'cljrf', 'cof', 'casp', 'cecej',
      'membros', 'composição', 'presidente da comissão',
    ],
    agent: 'comissao',
    action: 'consultar',
    boost: 2,
  },
  // Sessões / Transcrição
  {
    keywords: [
      'transcrição', 'transcrever', 'áudio', 'sessão gravada',
      'vídeo da sessão', 'youtube',
    ],
    agent: 'sessao',
    action: 'transcrever',
    boost: 2,
  },
  // PLS
  {
    keywords: [
      'projeto de lei', 'redigir lei', 'proposta legislativa',
      'análise jurídica', 'pesquisar legislação', 'lc 95',
    ],
    agent: 'pls',
    action: 'redigir',
    boost: 2,
  },
  // Email
  {
    keywords: [
      'email', 'e-mail', 'mensagem', 'caixa de entrada', 'inbox',
      'responder email', 'rascunho',
    ],
    agent: 'email',
    action: 'triagem',
    boost: 1,
  },
  // Caderno PDF
  {
    keywords: [
      'caderno', 'pdf', 'exportar', 'gerar caderno', 'caderno de autoridades',
    ],
    agent: 'cadin',
    action: 'gerar_caderno',
    boost: 2,
  },
];

// ── Classification ───────────────────────────────────────────────────────────

export function classifyIntent(
  text: string,
  pageContext?: string,
): Intent[] {
  const lower = text.toLowerCase();
  const scores = new Map<string, { agent: AgentType; action: string; score: number }>();

  for (const signal of SIGNALS) {
    let matchCount = 0;
    for (const kw of signal.keywords) {
      if (lower.includes(kw.toLowerCase())) matchCount++;
    }
    if (matchCount === 0) continue;

    const score = matchCount * signal.boost;
    const key = signal.agent;
    const existing = scores.get(key);

    if (!existing || score > existing.score) {
      scores.set(key, { agent: signal.agent, action: signal.action, score });
    }
  }

  // Page context boost: if user is on a specific page, boost that agent
  if (pageContext) {
    const contextMap: Record<string, AgentType> = {
      pareceres: 'parecer',
      cadin: 'cadin',
      indicacoes: 'indicacao',
      comissoes: 'comissao',
      agenda: 'agenda',
      sessoes: 'sessao',
      oficios: 'oficio',
      laia: 'general',
    };
    const boosted = contextMap[pageContext];
    if (boosted) {
      const existing = scores.get(boosted);
      if (existing) {
        existing.score += 3;
      } else {
        scores.set(boosted, { agent: boosted, action: 'consultar', score: 3 });
      }
    }
  }

  // Convert to sorted intents
  const intents: Intent[] = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((s, i) => ({
      agent: s.agent,
      action: s.action,
      confidence: Math.min(s.score / 6, 1),
      priority: i,
    }));

  // If no intents detected, default to general
  if (intents.length === 0) {
    return [{ agent: 'general', action: 'chat', confidence: 0.5, priority: 0 }];
  }

  return intents;
}

// ── Multi-intent detection ───────────────────────────────────────────────────

export function isMultiIntent(intents: Intent[]): boolean {
  if (intents.length < 2) return false;
  // Two agents with similar confidence = multi-intent
  return intents[0].confidence - intents[1].confidence < 0.3;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/classifier.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/alia/classifier.ts
git commit -m "feat(alia): add intent classifier for agent routing

Keyword-based classification with boost signals.
Supports multi-intent detection and page context boosting.
Evolved from existing router.ts for the orchestrator."
```

---

## Task 5: WhatsApp Adapter

**Files:**
- Create: `src/lib/alia/adapters/whatsapp.ts`

- [ ] **Step 1: Read the existing webhook route to extract helper functions**

Read: `src/app/api/alia/webhook/route.ts` — extract the logic for:
- `extractText()` (lines 480-491)
- `sendWhatsAppMessage()` (lines 493-517)
- `fetchMediaBase64()` (lines 521-537)
- `obterOuCriarSessao()` (lines 541-581)
- `salvarMensagem()` (lines 583-598)

- [ ] **Step 2: Create the WhatsApp adapter**

The adapter converts Evolution API webhook payloads into `AliaRequest` and sends `AliaResponse` back via Evolution API. It extracts the helper functions from the existing webhook route.

```typescript
// src/lib/alia/adapters/whatsapp.ts
// WhatsApp adapter: Evolution API ↔ AliaRequest/AliaResponse
// Extracts, normalizes, and sends messages via Evolution API.

import { createClient } from '@supabase/supabase-js';
import type { AliaRequest, AliaResponse, MediaAttachment } from '../gateway';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'gabinete-carol';
const GABINETE_ID = process.env.GABINETE_ID!;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Parse Evolution webhook into AliaRequest ─────────────────────────────────

export interface EvolutionMessage {
  key: { remoteJid: string; fromMe: boolean; id: string };
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string; mimetype?: string };
    videoMessage?: { caption?: string; mimetype?: string };
    audioMessage?: { mimetype?: string };
    documentMessage?: { fileName?: string; caption?: string; mimetype?: string };
  };
  messageTimestamp?: number;
}

export function shouldProcess(body: { event?: string; data?: EvolutionMessage }): boolean {
  if (body.event !== 'messages.upsert') return false;
  const msg = body.data;
  if (!msg?.key) return false;
  if (msg.key.fromMe) return false;
  if (msg.key.remoteJid?.endsWith('@g.us')) return false;
  return true;
}

export function extractText(msg: EvolutionMessage): string {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

export function extractMedia(msg: EvolutionMessage): MediaAttachment[] {
  const m = msg.message;
  if (!m) return [];
  const media: MediaAttachment[] = [];

  if (m.imageMessage) {
    media.push({
      type: 'image',
      base64: '', // fetched separately via fetchMediaBase64
      mime: m.imageMessage.mimetype || 'image/jpeg',
    });
  }
  if (m.audioMessage) {
    media.push({
      type: 'audio',
      base64: '',
      mime: m.audioMessage.mimetype || 'audio/ogg',
    });
  }
  if (m.documentMessage) {
    media.push({
      type: 'document',
      base64: '',
      filename: m.documentMessage.fileName,
      mime: m.documentMessage.mimetype || 'application/pdf',
    });
  }

  return media;
}

export async function fetchMediaBase64(messageId: string): Promise<string> {
  try {
    const url = `${EVOLUTION_API_URL}/message/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}/${messageId}`;
    const res = await fetch(url, {
      headers: { apikey: EVOLUTION_API_KEY },
    });
    if (!res.ok) return '';
    const json = await res.json();
    return json.base64 || '';
  } catch {
    return '';
  }
}

export function parseWebhookToRequest(
  msg: EvolutionMessage,
  sessionId: string,
): AliaRequest {
  const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '');
  return {
    channel: 'whatsapp',
    session_id: sessionId,
    gabinete_id: GABINETE_ID,
    sender: {
      phone,
      name: msg.pushName || 'Cidadão',
    },
    content: {
      text: extractText(msg),
      media: extractMedia(msg),
    },
    timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString(),
    is_proactive: false,
  };
}

// ── Send response via Evolution API ──────────────────────────────────────────

export async function sendWhatsAppMessage(phone: string, text: string): Promise<void> {
  const url = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_API_KEY,
    },
    body: JSON.stringify({
      number: phone,
      text,
      delay: 1000,
    }),
  });
}

// ── Session management ───────────────────────────────────────────────────────

export async function getOrCreateSession(
  phone: string,
  contactName: string,
): Promise<{ id: string; status: string }> {
  const supabase = db();

  // Try to find existing active session for this phone
  const { data: existing } = await supabase
    .from('laia_sessions')
    .select('id, status')
    .eq('gabinete_id', GABINETE_ID)
    .eq('canal', 'whatsapp')
    .eq('telefone', phone)
    .in('status', ['ativa', 'humano'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Update last message timestamp
    await supabase
      .from('laia_sessions')
      .update({ ultima_msg_em: new Date().toISOString(), contato_nome: contactName })
      .eq('id', existing.id);
    return { id: existing.id, status: existing.status };
  }

  // Create new session
  const { data: created, error } = await supabase
    .from('laia_sessions')
    .insert({
      gabinete_id: GABINETE_ID,
      canal: 'whatsapp',
      agente: 'alia',
      telefone: phone,
      contato_nome: contactName,
      status: 'ativa',
    })
    .select('id, status')
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return { id: created.id, status: created.status };
}

// ── Message persistence ──────────────────────────────────────────────────────

export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'human_agent',
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db()
    .from('laia_messages')
    .insert({
      session_id: sessionId,
      role,
      content,
      metadata: metadata ?? {},
    });
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/adapters/whatsapp.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/alia/adapters/whatsapp.ts
git commit -m "feat(alia): add WhatsApp adapter for gateway

Extracts helpers from webhook route into reusable adapter:
- parseWebhookToRequest (Evolution → AliaRequest)
- sendWhatsAppMessage (response delivery)
- getOrCreateSession, saveMessage (session management)
- extractText, extractMedia, fetchMediaBase64"
```

---

## Task 6: Dashboard Adapter

**Files:**
- Create: `src/lib/alia/adapters/dashboard.ts`

- [ ] **Step 1: Create the dashboard adapter**

```typescript
// src/lib/alia/adapters/dashboard.ts
// Dashboard chat adapter: HTTP request ↔ AliaRequest/AliaResponse

import { createClient } from '@supabase/supabase-js';
import type { AliaRequest, AliaResponse } from '../gateway';

const GABINETE_ID = process.env.GABINETE_ID!;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Parse dashboard request into AliaRequest ─────────────────────────────────

export interface DashboardChatBody {
  message: string;
  agente?: string;
  session_id?: string;
  page_context?: string;
}

export function parseChatToRequest(
  body: DashboardChatBody,
  sessionId: string,
  profileId?: string,
): AliaRequest {
  return {
    channel: 'dashboard',
    session_id: sessionId,
    gabinete_id: GABINETE_ID,
    sender: {
      profile_id: profileId,
      name: 'Assessor',
    },
    content: {
      text: body.message,
    },
    page_context: body.page_context,
    timestamp: new Date().toISOString(),
    is_proactive: false,
  };
}

// ── Format AliaResponse for dashboard JSON ───────────────────────────────────

export function formatDashboardResponse(
  response: AliaResponse,
  sessionId: string,
  messageId?: string,
) {
  // Extract chips/suggestions from response text if present
  let content = response.channel_format.dashboard || response.text;
  let suggestions: string[] = response.suggestions || [];

  const chipsMatch = content.match(/<chips>([\s\S]*?)<\/chips>/);
  if (chipsMatch) {
    content = content.replace(/<chips>[\s\S]*?<\/chips>/, '').trim();
    suggestions = chipsMatch[1]
      .split('\n')
      .map((s) => s.replace(/^-\s*/, '').trim())
      .filter(Boolean);
  }

  return {
    session_id: sessionId,
    message_id: messageId,
    role: 'assistant',
    content,
    suggestions,
    agente: response.agent_used,
    model: response.model_used,
    created_at: new Date().toISOString(),
  };
}

// ── Session management ───────────────────────────────────────────────────────

export async function getOrCreateDashboardSession(
  sessionId: string | undefined,
  agente: string,
): Promise<string> {
  const supabase = db();

  if (sessionId) {
    // Verify session exists
    const { data } = await supabase
      .from('laia_sessions')
      .select('id')
      .eq('id', sessionId)
      .maybeSingle();
    if (data) return data.id;
  }

  // Create new session
  const { data, error } = await supabase
    .from('laia_sessions')
    .insert({
      gabinete_id: GABINETE_ID,
      canal: 'interno',
      agente,
      status: 'ativa',
    })
    .select('id')
    .single();

  if (error) {
    // Fallback to random UUID if DB fails
    return crypto.randomUUID();
  }
  return data.id;
}

// ── Message persistence ──────────────────────────────────────────────────────

export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>,
): Promise<string | undefined> {
  const { data, error } = await db()
    .from('laia_messages')
    .insert({
      session_id: sessionId,
      role,
      content,
      metadata: metadata ?? {},
    })
    .select('id')
    .maybeSingle();

  if (error) return undefined;
  return data?.id;
}

// ── Fetch message history ────────────────────────────────────────────────────

export async function fetchHistory(
  sessionId: string,
  limit: number = 20,
): Promise<Array<{ role: string; content: string }>> {
  const { data } = await db()
    .from('laia_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);

  return (data ?? []).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    content: m.content,
  }));
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/adapters/dashboard.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/alia/adapters/dashboard.ts
git commit -m "feat(alia): add dashboard adapter for gateway

Extracts helpers from chat route into reusable adapter:
- parseChatToRequest (HTTP → AliaRequest)
- formatDashboardResponse (AliaResponse → JSON)
- getOrCreateDashboardSession, saveMessage, fetchHistory"
```

---

## Task 7: Agent Implementations (CADIN, Indicação, Ofício, Agenda, Parecer, Ordem do Dia, General, Caderno PDF)

**Files:**
- Create: `src/lib/alia/agents/cadin.agent.ts`
- Create: `src/lib/alia/agents/indicacao.agent.ts`
- Create: `src/lib/alia/agents/oficio.agent.ts`
- Create: `src/lib/alia/agents/agenda.agent.ts`
- Create: `src/lib/alia/agents/parecer.agent.ts`
- Create: `src/lib/alia/agents/ordem-dia.agent.ts`
- Create: `src/lib/alia/agents/general.agent.ts`
- Create: `src/lib/alia/agents/caderno-pdf.agent.ts`

Each agent wraps the logic currently inside `executeLocalFunction()` (webhook lines 168-440) and `executeTool()` (chat lines 220-481).

- [ ] **Step 1: Read existing tool implementations**

Read: `src/app/api/alia/webhook/route.ts` lines 168-440 to understand each tool's implementation.
Read: `src/app/api/laia/chat/route.ts` lines 220-481 for the dashboard tool implementations.

- [ ] **Step 2: Create all 8 agent files**

Each agent file follows the same pattern:

```typescript
// src/lib/alia/agents/[name].agent.ts
import { createClient } from '@supabase/supabase-js';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const GABINETE_ID = process.env.GABINETE_ID!;
const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

export const cadinAgent: AliaAgent = {
  name: 'cadin',
  description: 'Consultas ao CADIN — autoridades, contatos, aniversários',
  async execute({ action, data, context }) {
    // ... implementation extracted from executeLocalFunction/executeTool
  },
};
```

**Important:** The agent `execute()` method should call the same Supabase queries and internal API endpoints that the current webhook/chat routes call. Do NOT refactor the internal logic — just extract it into the agent interface. The internal APIs (`/api/cadin/*`, `/api/sapl/*`, `/api/pareceres/*`, `/api/indicacoes/*`) remain unchanged.

For `general.agent.ts`: This agent handles general conversation. It uses RAG search (from `@/lib/alia/rag`) and Gemini to generate a response. It receives RAG context in `context.ragContext`.

- [ ] **Step 3: Verify all agents compile**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit`
Expected: No new errors from agent files.

- [ ] **Step 4: Commit**

```bash
git add src/lib/alia/agents/
git commit -m "feat(alia): add 8 agent implementations for agent pool

Extracted from webhook executeLocalFunction() and chat executeTool():
- cadin.agent (authorities, birthdays, contacts)
- indicacao.agent (register, list, protocol, status)
- oficio.agent (official letter drafting)
- agenda.agent (calendar events)
- parecer.agent (relator opinion generation)
- ordem-dia.agent (order of the day queries)
- general.agent (RAG-based conversation)
- caderno-pdf.agent (CADIN PDF export)"
```

---

## Task 8: Brain — Central Orchestrator

**Files:**
- Create: `src/lib/alia/brain.ts`

- [ ] **Step 1: Create the brain module**

The brain is the central orchestrator. It receives an `AliaRequest`, classifies intent, recalls memory, searches RAG, selects model, executes agents, and returns `AliaResponse`.

```typescript
// src/lib/alia/brain.ts
// Central orchestrator for ALIA.
// classify → recall memory → search RAG → select model → execute agent → synthesize

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AliaRequest, AliaResponse } from './gateway';
import type { GabineteConfig } from './types';
import { classifyIntent, isMultiIntent } from './classifier';
import { selectModel, isGeminiModel } from './model-selector';
import { recall, remember, formatMemoryContext } from './memory';
import { buildSystemPrompt } from './persona';
import { searchHybrid, formatRagContext } from './rag';
import { routeDominios } from './router';
import type { AliaAgent, AgentResult } from './agents/agent.interface';

// Import agents
import { cadinAgent } from './agents/cadin.agent';
import { indicacaoAgent } from './agents/indicacao.agent';
import { oficioAgent } from './agents/oficio.agent';
import { agendaAgent } from './agents/agenda.agent';
import { parecerAgent } from './agents/parecer.agent';
import { ordemDiaAgent } from './agents/ordem-dia.agent';
import { generalAgent } from './agents/general.agent';
import { cadernoPdfAgent } from './agents/caderno-pdf.agent';

// ── Agent Registry ───────────────────────────────────────────────────────────

const AGENTS: Record<string, AliaAgent> = {
  cadin: cadinAgent,
  indicacao: indicacaoAgent,
  oficio: oficioAgent,
  agenda: agendaAgent,
  parecer: parecerAgent,
  relator: parecerAgent,  // relator uses same agent with different action
  ordem_dia: ordemDiaAgent,
  general: generalAgent,
  caderno_pdf: cadernoPdfAgent,
  // Phase 3 will add: email, comissao, crossmodule
};

// ── Gabinete config (hardcoded for now, multi-tenant later) ──────────────────

const GABINETE_CONFIG: GabineteConfig = {
  parlamentar_nome: 'Carol Dantas',
  casa_legislativa: 'Câmara Municipal de Boa Vista',
  sigla_casa: 'CMBV',
  partido: 'MDB',
  comissoes_membro: ['CLJRF', 'COF', 'CASP'],
};

const GABINETE_ID = process.env.GABINETE_ID!;

// ── Main process function ────────────────────────────────────────────────────

export async function process(request: AliaRequest): Promise<AliaResponse> {
  // 1. Classify intent
  const intents = classifyIntent(request.content.text, request.page_context);
  const primaryIntent = intents[0];
  const agent = AGENTS[primaryIntent.agent] ?? AGENTS.general;

  // 2. Recall relevant memories
  const memories = await recall(GABINETE_ID, request.content.text, { limit: 5 });

  // 3. Search RAG for knowledge context
  const dominios = routeDominios(request.content.text);
  const ragResult = await searchHybrid(request.content.text, {
    gabineteId: GABINETE_ID,
    dominios: dominios ?? undefined,
  });
  const ragContext = formatRagContext(ragResult);

  // 4. Select model
  const model = selectModel(primaryIntent.agent, request.channel, {
    multiIntent: isMultiIntent(intents),
    crossModule: primaryIntent.agent === 'crossmodule',
    legalAnalysis: ['parecer', 'relator', 'pls'].includes(primaryIntent.agent),
  });

  // 5. Build system prompt
  const systemPrompt = buildSystemPrompt({
    agent: primaryIntent.agent,
    channel: request.channel,
    memories,
    gabineteConfig: GABINETE_CONFIG,
    currentDate: new Date().toISOString(),
  });

  // 6. Execute agent
  const result = await agent.execute({
    action: primaryIntent.action,
    data: { text: request.content.text, media: request.content.media },
    context: {
      memories,
      ragContext,
      gabineteId: GABINETE_ID,
      sessionId: request.session_id,
      channel: request.channel,
    },
    model,
  });

  // 7. Maybe remember something from this interaction
  if (result.suggested_memories) {
    for (const mem of result.suggested_memories) {
      await remember(GABINETE_ID, mem.tipo, mem.subject, mem.content, {
        sourceModule: primaryIntent.agent,
      }).catch(() => {});
    }
  }

  // 8. Build response
  return {
    text: result.content,
    channel_format: {
      whatsapp: request.channel === 'whatsapp' ? result.content : undefined,
      dashboard: request.channel === 'dashboard' ? result.content : undefined,
    },
    actions: (result.actions_taken ?? []).map((a) => ({
      tool: primaryIntent.agent,
      params: {},
      result: a,
    })),
    memories_created: (result.suggested_memories ?? []).map((m) => m.subject),
    agent_used: primaryIntent.agent,
    model_used: model,
    suggestions: [],
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/brain.ts`
Expected: No errors (may need to adjust imports if agent exports differ slightly).

- [ ] **Step 3: Commit**

```bash
git add src/lib/alia/brain.ts
git commit -m "feat(alia): add brain — central orchestrator

classify → recall memory → search RAG → select model → execute agent → synthesize.
Routes all channels through single pipeline.
Agent registry for 8 current agents, extensible for Phase 3."
```

---

## Task 9: Refactor Webhook Route

**Files:**
- Modify: `src/app/api/alia/webhook/route.ts`

- [ ] **Step 1: Read the current webhook route completely**

Read: `src/app/api/alia/webhook/route.ts` (full file)

- [ ] **Step 2: Rewrite the webhook route to use gateway + brain**

The new webhook route should be ~120 lines. It:
1. Validates webhook auth (EVOLUTION_WEBHOOK_SECRET)
2. Checks rate limit
3. Uses `shouldProcess()` from whatsapp adapter to filter
4. Uses `parseWebhookToRequest()` to create AliaRequest
5. Checks human takeover
6. Calls `brain.process(request)`
7. Sends response via `sendWhatsAppMessage()`
8. Saves messages via adapter

**Keep the old file as a backup first:** Rename to `route.ts.bak` before rewriting.

The new route should import from:
- `@/lib/alia/adapters/whatsapp` (shouldProcess, parseWebhookToRequest, sendWhatsAppMessage, getOrCreateSession, saveMessage, extractText, fetchMediaBase64)
- `@/lib/alia/brain` (process)
- `@/lib/rate-limit` (existing rate limiter)

- [ ] **Step 3: Verify the build**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/alia/webhook/route.ts
git commit -m "refactor(webhook): slim down to gateway + brain architecture

809 lines → ~120 lines.
Logic moved to adapters/whatsapp.ts, agents/, and brain.ts.
Same behavior, clean separation of concerns."
```

---

## Task 10: Refactor Chat Route

**Files:**
- Modify: `src/app/api/laia/chat/route.ts`

- [ ] **Step 1: Read the current chat route completely**

Read: `src/app/api/laia/chat/route.ts` (full file)

- [ ] **Step 2: Rewrite the chat route to use gateway + brain**

The new chat route should be ~80 lines. It:
1. Parses request body (message, agente, session_id, page_context)
2. Uses `getOrCreateDashboardSession()` from dashboard adapter
3. Uses `parseChatToRequest()` to create AliaRequest
4. Saves user message
5. Calls `brain.process(request)`
6. Saves assistant message
7. Returns formatted JSON via `formatDashboardResponse()`

- [ ] **Step 3: Verify the build**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/laia/chat/route.ts
git commit -m "refactor(chat): slim down to gateway + brain architecture

689 lines → ~80 lines.
Logic moved to adapters/dashboard.ts, agents/, and brain.ts.
Same behavior, unified pipeline with webhook."
```

---

## Task 11: Integration Verification

- [ ] **Step 1: Verify all new files compile**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit`
Expected: Only pre-existing errors (youtube auth route).

- [ ] **Step 2: Verify file structure**

```bash
ls -R src/lib/alia/
```

Expected:
```
src/lib/alia/:
adapters/  agents/  brain.ts  classifier.ts  document-renderer.ts
gateway.ts  memory.ts  model-selector.ts  persona.ts  rag.ts  router.ts  types.ts

src/lib/alia/adapters:
dashboard.ts  whatsapp.ts

src/lib/alia/agents:
agent.interface.ts  agenda.agent.ts  caderno-pdf.agent.ts  cadin.agent.ts
general.agent.ts  indicacao.agent.ts  oficio.agent.ts  ordem-dia.agent.ts  parecer.agent.ts
```

- [ ] **Step 3: Verify git log**

```bash
git log --oneline -15
```

Expected: ~10 new commits from Phase 2.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(alia): complete Phase 2 — Orchestration

ALIA Core Engine Phase 2 delivers:
- Gateway with AliaRequest/AliaResponse normalization
- WhatsApp adapter (extracted from 809-line webhook)
- Dashboard adapter (extracted from 689-line chat)
- Intent classifier with keyword signals
- Model selector (Gemini Flash/Pro, Claude Sonnet)
- 8 agent implementations (agent pool)
- Brain orchestrator (central pipeline)
- Webhook refactored: 809 → ~120 lines
- Chat refactored: 689 → ~80 lines

Ready for Phase 3: New Agents (email, comissao, crossmodule)"
```
