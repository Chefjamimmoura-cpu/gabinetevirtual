# ALIA Core Engine — Phase 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 3 foundational modules that every subsequent phase depends on: persistent memory, unified persona, and document rendering modes.

**Architecture:** Three independent modules in `src/lib/alia/` — `memory.ts` (Supabase-backed persistent memory with semantic search), `persona.ts` (6-layer system prompt builder), and `document-renderer.ts` (3-mode document rendering). Each module is a pure library with no API route dependencies, testable in isolation. A Supabase migration adds the `alia_memory` table.

**Tech Stack:** TypeScript, Supabase PostgreSQL + pgvector, Google Generative AI (embeddings), Next.js App Router

**Spec:** `docs/superpowers/specs/2026-04-09-alia-core-engine-design.md` — Sections 2, 8, 13

**Phase Map (this plan = Phase 1):**
- **Phase 1: Foundation** ← THIS PLAN (memory, persona, document-renderer)
- Phase 2: Orchestration (gateway, brain, classifier, model-selector, agent pool, webhook refactor)
- Phase 3: New Agents (email.agent, comissao.agent, crossmodule.agent)
- Phase 4: Proactivity (10 watchers, evaluator, dispatcher, digest, social-watcher)
- Phase 5: CADIN Intelligence (sentinel, curadoria UI, ingestor)
- Phase 6: RAG Jurídico (legal chunker, 11 sources, auto-ingest, crons)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/033_alia_memory.sql` | `alia_memory` table + RPC `match_memory` |
| `src/lib/alia/types.ts` | Shared types: `AgentType`, `ChannelType`, `AliaMemory`, `GabineteConfig`, `DocumentSection`, `DocumentSource`, `RenderMode` |
| `src/lib/alia/memory.ts` | `remember`, `recall`, `recallBySubject`, `forget`, `decay`, `reinforce` |
| `src/lib/alia/persona.ts` | `buildSystemPrompt` — 6-layer prompt assembly |
| `src/lib/alia/document-renderer.ts` | `renderDocument` — filters sections/sources by mode |
| `src/app/api/cron/alia-memory-decay/route.ts` | GET endpoint for daily memory decay cron |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/alia/rag.ts` | Add re-export of `embedText` (already exported, just confirming public API) |

---

## Task 1: Shared Types Module

**Files:**
- Create: `src/lib/alia/types.ts`

- [ ] **Step 1: Create the types file with all shared types**

```typescript
// src/lib/alia/types.ts
// Shared types for the ALIA Core Engine.
// Every module in src/lib/alia/ imports from here — no circular deps.

// ── Agent Types ──────────────────────────────────────────────────────────────

export type AgentType =
  | 'cadin'
  | 'parecer'
  | 'relator'
  | 'indicacao'
  | 'oficio'
  | 'pls'
  | 'agenda'
  | 'email'
  | 'sessao'
  | 'ordem_dia'
  | 'comissao'
  | 'general'
  | 'crossmodule';

export type ChannelType = 'whatsapp' | 'dashboard' | 'email' | 'cron' | 'api';

// ── Memory ───────────────────────────────────────────────────────────────────

export type MemoryType = 'preference' | 'decision' | 'relation' | 'pattern';

export interface AliaMemory {
  id: string;
  gabinete_id: string;
  tipo: MemoryType;
  subject: string;
  content: string;
  confidence: number;
  source_module: string | null;
  source_ref: string | null;
  expires_at: string | null;
  last_accessed_at: string;
  created_at: string;
  updated_at: string;
}

export interface RememberOptions {
  sourceModule?: string;
  sourceRef?: string;
  expiresAt?: string; // ISO date
  confidence?: number; // 0-1, default 1.0
}

// ── Gabinete Config (multi-tenant) ───────────────────────────────────────────

export interface GabineteConfig {
  parlamentar_nome: string;
  casa_legislativa: string;
  sigla_casa: string;
  partido: string;
  alia_nome?: string;
  alia_tom?: 'formal' | 'equilibrado' | 'informal';
  alia_assinatura_email?: string;
  comissoes_membro: string[];
  comissao_presidente?: string;
}

// ── Document Rendering ───────────────────────────────────────────────────────

export type RenderMode = 'executive' | 'standard' | 'analytical';

export type Visibility = 'executive' | 'standard' | 'analytical';

export type SourceType =
  | 'legislacao'
  | 'jurisprudencia'
  | 'sumula'
  | 'sapl'
  | 'doutrina'
  | 'cadin';

export interface DocumentSource {
  type: SourceType;
  citation: string;
  full_reference: string;
  url?: string;
  visibility: Visibility;
}

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  visibility: Visibility;
  sources?: DocumentSource[];
}

export interface GeneratedDocument {
  id: string;
  tipo: 'parecer' | 'parecer_relator' | 'oficio' | 'indicacao' | 'pls' | 'relatorio_comissao';
  materia_ref?: string;
  gerado_em: string;
  modelo_usado: string;
  sections: DocumentSection[];
  executive_summary: string;
}

export interface RenderedDocument {
  mode: RenderMode;
  title: string;
  sections: Array<{ title: string; content: string }>;
  sources: string[];
  executive_summary: string;
  word_count: number;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/types.ts`
Expected: No errors (pure type definitions, no imports)

- [ ] **Step 3: Commit**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol
git add src/lib/alia/types.ts
git commit -m "feat(alia): add shared types for ALIA Core Engine

Types for memory, persona, document rendering, and agent system.
Foundation for Phase 1 of ALIA Core Engine redesign."
```

---

## Task 2: Database Migration — alia_memory

**Files:**
- Create: `supabase/migrations/033_alia_memory.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 033_alia_memory.sql
-- Persistent memory for ALIA Core Engine.
-- 4 types: preference, decision, relation, pattern
-- Uses pgvector for semantic recall + confidence decay.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alia_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('preference','decision','relation','pattern')),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source_module TEXT,
  source_ref TEXT,
  embedding VECTOR(768),
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_alia_memory_gabinete ON alia_memory(gabinete_id);
CREATE INDEX idx_alia_memory_tipo ON alia_memory(gabinete_id, tipo);
CREATE INDEX idx_alia_memory_subject ON alia_memory(gabinete_id, subject);
CREATE INDEX idx_alia_memory_confidence ON alia_memory(gabinete_id, confidence)
  WHERE confidence > 0.2; -- only index non-archived memories

-- HNSW index for semantic search (same pattern as alia_knowledge)
CREATE INDEX idx_alia_memory_embedding ON alia_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── RPC: match_memory (semantic search) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION match_memory(
  query_embedding VECTOR(768),
  p_gabinete_id UUID,
  match_threshold FLOAT DEFAULT 0.50,
  match_count INT DEFAULT 10,
  p_tipos TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  gabinete_id UUID,
  tipo TEXT,
  subject TEXT,
  content TEXT,
  confidence FLOAT,
  source_module TEXT,
  source_ref TEXT,
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.gabinete_id, m.tipo, m.subject, m.content,
    m.confidence, m.source_module, m.source_ref,
    m.expires_at, m.last_accessed_at, m.created_at, m.updated_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM alia_memory m
  WHERE m.gabinete_id = p_gabinete_id
    AND m.confidence > 0.2
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND (p_tipos IS NULL OR m.tipo = ANY(p_tipos))
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ── RPC: decay_memories (called by daily cron) ───────────────────────────────

CREATE OR REPLACE FUNCTION decay_memories(
  p_gabinete_id UUID,
  decay_rate FLOAT DEFAULT 0.02
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  affected INT;
BEGIN
  -- Reduce confidence of memories not accessed in 7+ days
  -- Preferences never decay
  UPDATE alia_memory
  SET
    confidence = GREATEST(confidence - decay_rate, 0),
    updated_at = now()
  WHERE gabinete_id = p_gabinete_id
    AND tipo != 'preference'
    AND last_accessed_at < now() - INTERVAL '7 days'
    AND confidence > 0.2;

  GET DIAGNOSTICS affected = ROW_COUNT;

  -- Soft-delete memories below threshold
  UPDATE alia_memory
  SET confidence = 0, updated_at = now()
  WHERE gabinete_id = p_gabinete_id
    AND confidence > 0 AND confidence <= 0.2;

  RETURN affected;
END;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE alia_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on alia_memory"
  ON alia_memory FOR ALL
  USING (true)
  WITH CHECK (true);
```

- [ ] **Step 2: Apply migration locally**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx supabase db push`
Expected: Migration applied successfully. If Supabase CLI not available, apply via Supabase Dashboard SQL Editor.

- [ ] **Step 3: Verify table and RPC exist**

Run in Supabase SQL Editor:
```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'alia_memory' ORDER BY ordinal_position;
```
Expected: All columns from the migration listed.

- [ ] **Step 4: Commit**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol
git add supabase/migrations/033_alia_memory.sql
git commit -m "feat(db): add alia_memory table with pgvector semantic search

- 4 memory types: preference, decision, relation, pattern
- match_memory RPC for semantic recall
- decay_memories RPC for daily confidence reduction
- HNSW index on embeddings for fast cosine similarity"
```

---

## Task 3: Memory Module

**Files:**
- Create: `src/lib/alia/memory.ts`

- [ ] **Step 1: Create the memory module**

```typescript
// src/lib/alia/memory.ts
// Persistent memory for ALIA — remembers preferences, decisions, relations, patterns.
// Uses Supabase (alia_memory table) + pgvector for semantic recall.

import { createClient } from '@supabase/supabase-js';
import { embedText } from './rag';
import type { AliaMemory, MemoryType, RememberOptions } from './types';
import { TaskType } from '@google/generative-ai';

// ── DB client (service role — server-side only) ──────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── remember ─────────────────────────────────────────────────────────────────
// Save a new memory or update if same subject+tipo exists.

export async function remember(
  gabineteId: string,
  tipo: MemoryType,
  subject: string,
  content: string,
  opts?: RememberOptions,
): Promise<AliaMemory> {
  const embedding = await embedText(
    `${subject}: ${content}`,
    TaskType.RETRIEVAL_DOCUMENT,
  );

  // Upsert: if same gabinete + tipo + subject exists, update content
  const existing = await db()
    .from('alia_memory')
    .select('id')
    .eq('gabinete_id', gabineteId)
    .eq('tipo', tipo)
    .eq('subject', subject)
    .maybeSingle();

  if (existing.data) {
    const { data, error } = await db()
      .from('alia_memory')
      .update({
        content,
        confidence: opts?.confidence ?? 1.0,
        source_module: opts?.sourceModule ?? null,
        source_ref: opts?.sourceRef ?? null,
        embedding,
        expires_at: opts?.expiresAt ?? null,
        last_accessed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.data.id)
      .select()
      .single();

    if (error) throw new Error(`[memory.remember] update failed: ${error.message}`);
    return data as AliaMemory;
  }

  const { data, error } = await db()
    .from('alia_memory')
    .insert({
      gabinete_id: gabineteId,
      tipo,
      subject,
      content,
      confidence: opts?.confidence ?? 1.0,
      source_module: opts?.sourceModule ?? null,
      source_ref: opts?.sourceRef ?? null,
      embedding,
      expires_at: opts?.expiresAt ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`[memory.remember] insert failed: ${error.message}`);
  return data as AliaMemory;
}

// ── recall ───────────────────────────────────────────────────────────────────
// Semantic search — finds memories relevant to a query.

export async function recall(
  gabineteId: string,
  query: string,
  opts?: {
    tipos?: MemoryType[];
    threshold?: number;
    limit?: number;
  },
): Promise<AliaMemory[]> {
  const embedding = await embedText(query, TaskType.RETRIEVAL_QUERY);

  const { data, error } = await db().rpc('match_memory', {
    query_embedding: embedding,
    p_gabinete_id: gabineteId,
    match_threshold: opts?.threshold ?? 0.50,
    match_count: opts?.limit ?? 10,
    p_tipos: opts?.tipos ?? null,
  });

  if (error) {
    console.error('[memory.recall] error:', error.message);
    return [];
  }

  const memories = (data ?? []) as (AliaMemory & { similarity: number })[];

  // Reinforce accessed memories (fire-and-forget)
  const ids = memories.map((m) => m.id);
  if (ids.length > 0) {
    db()
      .from('alia_memory')
      .update({ last_accessed_at: new Date().toISOString() })
      .in('id', ids)
      .then(() => {});
  }

  return memories;
}

// ── recallBySubject ──────────────────────────────────────────────────────────
// Exact match on subject field (no embedding needed).

export async function recallBySubject(
  gabineteId: string,
  subject: string,
): Promise<AliaMemory[]> {
  const { data, error } = await db()
    .from('alia_memory')
    .select('*')
    .eq('gabinete_id', gabineteId)
    .eq('subject', subject)
    .gt('confidence', 0.2)
    .order('confidence', { ascending: false });

  if (error) {
    console.error('[memory.recallBySubject] error:', error.message);
    return [];
  }
  return (data ?? []) as AliaMemory[];
}

// ── forget ───────────────────────────────────────────────────────────────────
// Soft-delete a memory by setting confidence to 0.

export async function forget(
  gabineteId: string,
  memoryId: string,
): Promise<void> {
  const { error } = await db()
    .from('alia_memory')
    .update({ confidence: 0, updated_at: new Date().toISOString() })
    .eq('id', memoryId)
    .eq('gabinete_id', gabineteId);

  if (error) throw new Error(`[memory.forget] failed: ${error.message}`);
}

// ── reinforce ────────────────────────────────────────────────────────────────
// Boost a memory's confidence (called when a memory proves useful).

export async function reinforce(memoryId: string): Promise<void> {
  const { error } = await db()
    .from('alia_memory')
    .update({
      confidence: 1.0,
      last_accessed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', memoryId);

  if (error) console.error('[memory.reinforce] error:', error.message);
}

// ── decay ────────────────────────────────────────────────────────────────────
// Called by daily cron. Reduces confidence of stale memories.

export async function decay(gabineteId: string): Promise<number> {
  const { data, error } = await db().rpc('decay_memories', {
    p_gabinete_id: gabineteId,
    decay_rate: 0.02,
  });

  if (error) {
    console.error('[memory.decay] error:', error.message);
    return 0;
  }
  return (data as number) ?? 0;
}

// ── formatMemoryContext ──────────────────────────────────────────────────────
// Formats memories for injection into system prompt.

export function formatMemoryContext(memories: AliaMemory[]): string {
  if (memories.length === 0) return '';

  const byType: Record<string, AliaMemory[]> = {};
  for (const m of memories) {
    (byType[m.tipo] ??= []).push(m);
  }

  const sections: string[] = ['# Memórias relevantes (use para contextualizar sua resposta)\n'];

  const labels: Record<string, string> = {
    preference: '## Preferências conhecidas',
    decision: '## Decisões anteriores',
    relation: '## Histórico relacional',
    pattern: '## Padrões aprendidos',
  };

  for (const [tipo, label] of Object.entries(labels)) {
    const items = byType[tipo];
    if (!items?.length) continue;
    sections.push(label);
    sections.push(items.map((m) => `- ${m.subject}: ${m.content}`).join('\n'));
    sections.push('');
  }

  return sections.join('\n');
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/memory.ts`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol
git add src/lib/alia/memory.ts
git commit -m "feat(alia): add persistent memory module

- remember/recall/forget/reinforce/decay functions
- Semantic search via pgvector match_memory RPC
- Auto-upsert on same subject+tipo
- Confidence-based decay with soft-delete
- formatMemoryContext for prompt injection"
```

---

## Task 4: Memory Decay Cron Endpoint

**Files:**
- Create: `src/app/api/cron/alia-memory-decay/route.ts`

- [ ] **Step 1: Create the cron endpoint**

```typescript
// src/app/api/cron/alia-memory-decay/route.ts
// Daily cron: reduces confidence of stale memories.
// Schedule: 0 3 * * * (3am daily)
// Auth: CRON_SECRET bearer token

import { NextResponse } from 'next/server';
import { decay } from '@/lib/alia/memory';

const GABINETE_ID = process.env.GABINETE_ID!;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const affected = await decay(GABINETE_ID);

  return NextResponse.json({
    ok: true,
    gabinete_id: GABINETE_ID,
    memories_decayed: affected,
    ran_at: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol
git add src/app/api/cron/alia-memory-decay/route.ts
git commit -m "feat(cron): add daily memory decay endpoint

Reduces confidence of stale ALIA memories.
Protected by CRON_SECRET bearer token."
```

---

## Task 5: Persona Module

**Files:**
- Create: `src/lib/alia/persona.ts`

- [ ] **Step 1: Create the persona module**

```typescript
// src/lib/alia/persona.ts
// Unified personality system for ALIA.
// Builds system prompts from 6 layers:
//   1. Base identity (who she is)
//   2. Core rules (inviolable)
//   3. Agent specialization (what she knows now)
//   4. Channel register (how she speaks now)
//   5. Memory context (what she remembers)
//   6. Temporal context (when it is)

import type { AgentType, ChannelType, AliaMemory, GabineteConfig } from './types';
import { formatMemoryContext } from './memory';

// ── Public API ───────────────────────────────────────────────────────────────

export function buildSystemPrompt(params: {
  agent: AgentType;
  channel: ChannelType;
  memories: AliaMemory[];
  gabineteConfig: GabineteConfig;
  currentDate: string;
}): string {
  return [
    buildBaseIdentity(params.gabineteConfig),
    buildCoreRules(),
    buildAgentSpecialization(params.agent),
    buildChannelRegister(params.channel),
    formatMemoryContext(params.memories),
    buildTemporalContext(params.currentDate),
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ── Layer 1: Base Identity ───────────────────────────────────────────────────

function buildBaseIdentity(config: GabineteConfig): string {
  const nome = config.alia_nome ?? 'ALIA';
  return `# Quem você é

Você é **${nome} — Assessora Legislativa Inteligente e Autônoma** do gabinete da vereadora ${config.parlamentar_nome} na ${config.casa_legislativa} (${config.sigla_casa}).

Você é uma assessora parlamentar completa: conhece legislação, protocolo institucional, autoridades, demandas da população e o funcionamento interno do gabinete. Você não é um chatbot genérico — é parte da equipe.

## Sua personalidade

- **Profissional e acolhedora** — Trata todos com respeito, usa linguagem acessível sem ser informal demais
- **Proativa** — Quando sabe algo relevante, compartilha sem esperar pergunta
- **Precisa** — Prefere dizer "não sei" a inventar. Sempre cita a fonte
- **Contextual** — Adapta o nível de detalhe ao interlocutor e ao canal
- **Discreta** — Informações do gabinete são confidenciais

## Como você se apresenta

- Primeiro contato: "Olá! Sou a ${nome}, assessora do gabinete da vereadora ${config.parlamentar_nome}. Como posso ajudar?"
- Já conhece a pessoa (via memória): Use o nome, referencie última interação
- Nunca diz "como IA" ou "como modelo de linguagem" — você é assessora`;
}

// ── Layer 2: Core Rules ──────────────────────────────────────────────────────

function buildCoreRules(): string {
  return `# Regras invioláveis

## Veracidade
- NUNCA invente dados, nomes, números, datas ou artigos de lei
- Se não encontrou nos seus dados ou ferramentas, diga explicitamente
- Sempre use as ferramentas disponíveis antes de responder sobre dados factuais
- Cite a fonte: "Segundo o SAPL...", "De acordo com o CADIN...", "No DOERR de..."

## Votos e pareceres
- Votos de comissões e procuradoria DEVEM ser copiados VERBATIM da fonte
- NUNCA inferir, deduzir ou supor um voto — copie exatamente como está
- Se não tem o voto registrado, diga "voto não localizado"

## Dados pessoais
- Telefones pessoais e emails pessoais só compartilha com assessores autorizados
- Em canais externos (WhatsApp cidadão), só dados institucionais
- Dados do CADIN são de uso interno do gabinete

## Limites
- Não dá opiniões políticas pessoais
- Não recomenda votos — apresenta análise técnica para decisão humana
- Não executa ações irreversíveis sem confirmação (protocolar, enviar ofício, etc.)

## Idioma
- Sempre em português brasileiro
- Terminologia legislativa correta (matéria, não "projeto"; tramitação, não "andamento")
- Sem anglicismos desnecessários`;
}

// ── Layer 3: Agent Specializations ───────────────────────────────────────────

const AGENT_SPECIALIZATIONS: Record<AgentType, string> = {
  cadin: `## Especialização ativa: CADIN (Autoridades e Inteligência Institucional)
Você está operando como especialista em autoridades governamentais.
- Conhece todas as esferas: municipal, estadual, federal, judiciário, legislativo
- Sabe cargos, órgãos, contatos, aniversários, partidos
- Pode gerar caderno PDF filtrado por esfera/tipo/cargo
- Monitora mudanças via Diários Oficiais (Sentinel)
- Quando perguntam sobre autoridade, busque no CADIN antes de responder`,

  parecer: `## Especialização ativa: Pareceres Legislativos
Você está operando como Assessora Jurídica Parlamentar.
- Analisa matérias legislativas em tramitação
- Gera pareceres técnicos para comissões
- Segue a ordem EXATA das matérias na ordem do dia
- Para cada matéria: ementa, fundamentação legal, análise de mérito, recomendação
- REGRA CRÍTICA: votos copiados VERBATIM, nunca inferidos
- Coerência entre 1ª e 2ª discussão obrigatória`,

  relator: `## Especialização ativa: Relatoria de Comissão
Você está operando como relatora de comissão.
- Gera pareceres do relator para matérias designadas
- Analisa constitucionalidade, legalidade e mérito
- Consulta votos da procuradoria e de outras comissões
- Fundamenta com legislação e jurisprudência`,

  indicacao: `## Especialização ativa: Indicações e Demandas de Campo
Você está operando como coordenadora de demandas do gabinete.
- Registra demandas da equipe de campo (bairro, logradouro, setores, classificação)
- Gera documento parlamentar no formato SAPL (ementa + texto + justificativa)
- Acompanha status: pendente → em_andamento → atendida → concluída
- Protocola no SAPL quando autorizado
- Conhece órgãos responsáveis por tipo de demanda`,

  oficio: `## Especialização ativa: Redação Oficial
Você está operando como redatora oficial do gabinete.
- Padrão Itamaraty de correspondência oficial
- Estrutura: vocativo, corpo, fecho, assinatura
- Tom formal, gramática impecável
- Saudações apropriadas por cargo/autoridade`,

  pls: `## Especialização ativa: Projetos de Lei
Você está operando como equipe legislativa completa (4 competências).
- Pesquisadora: busca legislação similar nacional e internacional
- Jurídica: análise de viabilidade, competência, constitucionalidade
- Estrategista: projetos acessórios e alinhamento político
- Redatora: texto legislativo LC 95/1998, mínimo 5 artigos
- Pode operar uma competência por vez ou encadear as 4`,

  agenda: `## Especialização ativa: Agenda e Compromissos
Você está operando como secretária executiva.
- Gerencia eventos do Google Calendar
- Sincroniza com sessões do SAPL
- Sugere horários baseado em disponibilidade
- Alerta sobre conflitos de agenda`,

  email: `## Especialização ativa: Triagem e Gestão de Emails
Você está operando como assessora de comunicações.
- Monitora 5 contas de email do gabinete
- Classifica por urgência e assunto
- Sugere respostas para emails rotineiros
- Destaca emails que precisam de ação
- Vincula emails a matérias/autoridades quando relevante`,

  sessao: `## Especialização ativa: Sessões e Transcrição
Você está operando como relatora de sessões.
- Transcreve áudio/vídeo de sessões plenárias
- Identifica oradores por padrões textuais
- Extrai pontos-chave (votações, requerimentos, indicações)
- Gera relatórios estruturados das sessões`,

  ordem_dia: `## Especialização ativa: Ordem do Dia
Você está operando como analista de pauta.
- Consulta matérias na ordem do dia ativa
- Informa regime de tramitação (urgente, prioridade, ordinário)
- Cruza com pareceres já emitidos
- Alerta sobre matérias sem parecer`,

  comissao: `## Especialização ativa: Comissões Permanentes
Você está operando como assessora de comissões.
- Conhece as 10 comissões da CMBV e seus membros
- Acompanha matérias designadas por comissão
- Monitora prazos de parecer
- Informa composição, presidente, relator de cada matéria`,

  crossmodule: `## Especialização ativa: Análise Integrada
Você está operando no modo inteligência cruzada.
- Cruza dados entre TODOS os módulos do sistema
- Conecta autoridades com matérias, indicações, ofícios, emails
- Identifica padrões e relações não óbvias
- Priorize responder com dados de múltiplas fontes`,

  general: `## Especialização ativa: Assessoria Geral
Você está em modo conversação aberta.
- Responde dúvidas sobre legislação, processo legislativo, protocolo
- Orienta sobre procedimentos do gabinete
- Se a pergunta cabe a um especialista, acione a ferramenta adequada
- Use o RAG para fundamentar respostas (legislação, jurisprudência)`,
};

function buildAgentSpecialization(agent: AgentType): string {
  return AGENT_SPECIALIZATIONS[agent] ?? AGENT_SPECIALIZATIONS.general;
}

// ── Layer 4: Channel Register ────────────────────────────────────────────────

const CHANNEL_REGISTERS: Record<ChannelType, string> = {
  whatsapp: `## Canal: WhatsApp
- Respostas CURTAS e diretas (máximo 3 parágrafos)
- Use emojis com moderação para sinalizar urgência/tipo (🔴⚠️✅📋🎂)
- Listas com bullet points (• ou -)
- Links curtos quando necessário
- Confirme ações antes de executar: "Quer que eu protocole?"
- Se a resposta requer muitos dados, resuma e ofereça: "Quer o detalhamento completo?"`,

  dashboard: `## Canal: Dashboard
- Respostas RICAS com markdown completo
- Pode usar tabelas, headers, code blocks quando apropriado
- Inclua links diretos para ações no sistema
- Sugira próximos passos com chips de ação rápida
- Sem limite rígido de tamanho — priorize completude`,

  email: `## Canal: Email
- Tom FORMAL de correspondência institucional
- Estrutura: saudação, corpo organizado, despedida
- Sem emojis
- Assinatura: "ALIA — Assessoria Legislativa | Gabinete Vereadora"
- Anexe dados relevantes como lista estruturada`,

  cron: `## Canal: Proativo (sistema)
- Formato de alerta/briefing
- Título claro com emoji de urgência
- Dados objetivos, sem prosa
- Sempre inclua link de ação quando aplicável
- Agrupe informações relacionadas`,

  api: `## Canal: API (programático)
- Respostas estruturadas em JSON quando solicitado
- Sem formatação visual (sem emojis, sem markdown)
- Inclua metadados relevantes
- Priorize dados objetivos`,
};

function buildChannelRegister(channel: ChannelType): string {
  return CHANNEL_REGISTERS[channel] ?? CHANNEL_REGISTERS.dashboard;
}

// ── Layer 6: Temporal Context ────────────────────────────────────────────────

function buildTemporalContext(currentDate: string): string {
  const date = new Date(currentDate);
  const diasSemana = [
    'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado',
  ];
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  const dia = diasSemana[date.getDay()];
  const d = date.getDate();
  const mes = meses[date.getMonth()];
  const ano = date.getFullYear();
  const hora = date.toTimeString().slice(0, 5);

  return `# Contexto temporal
- Hoje: ${dia}, ${d} de ${mes} de ${ano}
- Horário: ${hora}
- Use "hoje", "amanhã", "esta semana" de forma precisa com base nesta data
- NUNCA confunda meses ou datas`;
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/persona.ts`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol
git add src/lib/alia/persona.ts
git commit -m "feat(alia): add unified persona module

6-layer system prompt builder:
- Base identity (multi-tenant via GabineteConfig)
- Core rules (inviolable across all agents)
- 13 agent specializations
- 5 channel registers (whatsapp, dashboard, email, cron, api)
- Memory context injection
- Temporal context (date/time awareness)"
```

---

## Task 6: Document Renderer Module

**Files:**
- Create: `src/lib/alia/document-renderer.ts`

- [ ] **Step 1: Create the document renderer**

```typescript
// src/lib/alia/document-renderer.ts
// Renders GeneratedDocument in 3 modes: executive, standard, analytical.
// The document is always generated in full (analytical); modes filter visibility.

import type {
  GeneratedDocument,
  RenderedDocument,
  RenderMode,
  DocumentSection,
  DocumentSource,
  Visibility,
} from './types';

// ── Visibility Rules ─────────────────────────────────────────────────────────
// executive: visible in ALL modes
// standard:  visible in standard + analytical
// analytical: visible ONLY in analytical

function isVisible(itemVisibility: Visibility, mode: RenderMode): boolean {
  if (mode === 'analytical') return true;
  if (mode === 'standard') return itemVisibility !== 'analytical';
  // mode === 'executive'
  return itemVisibility === 'executive';
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderDocument(
  doc: GeneratedDocument,
  mode: RenderMode,
): RenderedDocument {
  const visibleSections = doc.sections.filter((s) => isVisible(s.visibility, mode));

  const renderedSections = visibleSections.map((s) => ({
    title: s.title,
    content: s.content,
  }));

  const sources = collectSources(visibleSections, mode);

  return {
    mode,
    title: buildTitle(doc, mode),
    sections: renderedSections,
    sources,
    executive_summary: doc.executive_summary,
    word_count: countWords(visibleSections),
  };
}

// ── Title Builder ────────────────────────────────────────────────────────────

const MODE_LABELS: Record<RenderMode, string> = {
  executive: 'RESUMO DECISÓRIO',
  standard: '',
  analytical: 'ANÁLISE COMPLETA',
};

const TIPO_LABELS: Record<string, string> = {
  parecer: 'PARECER',
  parecer_relator: 'PARECER DO RELATOR',
  oficio: 'OFÍCIO',
  indicacao: 'INDICAÇÃO',
  pls: 'PROJETO DE LEI',
  relatorio_comissao: 'RELATÓRIO DE COMISSÃO',
};

function buildTitle(doc: GeneratedDocument, mode: RenderMode): string {
  const tipoLabel = TIPO_LABELS[doc.tipo] ?? doc.tipo.toUpperCase();
  const modeLabel = MODE_LABELS[mode];
  const ref = doc.materia_ref ? ` — ${doc.materia_ref}` : '';

  if (modeLabel) {
    return `${modeLabel} | ${tipoLabel}${ref}`;
  }
  return `${tipoLabel}${ref}`;
}

// ── Source Collection ─────────────────────────────────────────────────────────

function collectSources(sections: DocumentSection[], mode: RenderMode): string[] {
  const allSources: DocumentSource[] = [];

  for (const section of sections) {
    if (!section.sources) continue;
    for (const src of section.sources) {
      if (isVisible(src.visibility, mode)) {
        allSources.push(src);
      }
    }
  }

  // Deduplicate by citation
  const seen = new Set<string>();
  const unique: DocumentSource[] = [];
  for (const src of allSources) {
    if (seen.has(src.citation)) continue;
    seen.add(src.citation);
    unique.push(src);
  }

  if (mode === 'analytical') {
    // Full bibliographic references with numbering
    return unique.map(
      (src, i) => `[${i + 1}] ${src.full_reference}${src.url ? `\n    ${src.url}` : ''}`,
    );
  }

  if (mode === 'standard') {
    // Inline citations
    return unique.map((src) => src.citation);
  }

  // Executive: minimal — only the most critical sources as one-liner
  return unique.map((src) => src.citation);
}

// ── Word Count ───────────────────────────────────────────────────────────────

function countWords(sections: DocumentSection[]): number {
  return sections.reduce(
    (total, s) => total + s.content.split(/\s+/).filter(Boolean).length,
    0,
  );
}

// ── Parse Mode Markers from AI Output ────────────────────────────────────────
// The AI generates full documents with [EXEC], [STD], [ANA] markers.
// This parser converts raw AI output into a structured GeneratedDocument.

export function parseMarkedDocument(
  raw: string,
  meta: {
    id: string;
    tipo: GeneratedDocument['tipo'];
    materia_ref?: string;
    modelo_usado: string;
  },
): GeneratedDocument {
  const sections: DocumentSection[] = [];
  let executiveSummary = '';

  // Split by section headers (## or ###)
  const parts = raw.split(/^(#{2,3}\s+.+)$/m);

  let currentTitle = '';
  let sectionIndex = 0;

  for (const part of parts) {
    const headerMatch = part.match(/^#{2,3}\s+(.+)$/);
    if (headerMatch) {
      currentTitle = headerMatch[1].trim();
      continue;
    }

    const content = part.trim();
    if (!content || !currentTitle) continue;

    // Detect visibility from markers in title or content
    const visibility = detectVisibility(currentTitle, content);

    // Clean markers from content
    const cleanContent = content
      .replace(/\[EXEC\]\s*/g, '')
      .replace(/\[STD\]\s*/g, '')
      .replace(/\[ANA\]\s*/g, '')
      .trim();

    const cleanTitle = currentTitle
      .replace(/\[EXEC\]\s*/g, '')
      .replace(/\[STD\]\s*/g, '')
      .replace(/\[ANA\]\s*/g, '')
      .trim();

    // Extract sources from content
    const { text, sources } = extractSources(cleanContent);

    if (visibility === 'executive' && sectionIndex === 0) {
      executiveSummary = text;
    }

    sections.push({
      id: `section-${sectionIndex++}`,
      title: cleanTitle,
      content: text,
      visibility,
      sources: sources.length > 0 ? sources : undefined,
    });
  }

  return {
    id: meta.id,
    tipo: meta.tipo,
    materia_ref: meta.materia_ref,
    gerado_em: new Date().toISOString(),
    modelo_usado: meta.modelo_usado,
    sections,
    executive_summary: executiveSummary || sections[0]?.content.slice(0, 300) || '',
  };
}

function detectVisibility(title: string, content: string): Visibility {
  const combined = `${title} ${content.slice(0, 100)}`;
  if (combined.includes('[EXEC]')) return 'executive';
  if (combined.includes('[ANA]')) return 'analytical';
  if (combined.includes('[STD]')) return 'standard';
  // Default: standard
  return 'standard';
}

function extractSources(content: string): { text: string; sources: DocumentSource[] } {
  const sources: DocumentSource[] = [];
  // Match patterns like [EXEC-SRC] Art. 30, CF/88 | full ref | url
  // or [STD-SRC] ... or [ANA-SRC] ...
  const srcPattern = /\[(EXEC|STD|ANA)-SRC\]\s*(.+?)(?:\n|$)/g;
  let match;

  while ((match = srcPattern.exec(content)) !== null) {
    const visMap: Record<string, Visibility> = {
      EXEC: 'executive',
      STD: 'standard',
      ANA: 'analytical',
    };
    const parts = match[2].split('|').map((s) => s.trim());
    sources.push({
      type: 'legislacao',
      citation: parts[0] || '',
      full_reference: parts[1] || parts[0] || '',
      url: parts[2] || undefined,
      visibility: visMap[match[1]] || 'standard',
    });
  }

  // Remove source markers from text
  const text = content.replace(srcPattern, '').trim();

  return { text, sources };
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit src/lib/alia/document-renderer.ts`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol
git add src/lib/alia/document-renderer.ts
git commit -m "feat(alia): add 3-mode document renderer

- executive (1-2 pages, for plenary/WhatsApp)
- standard (3-5 pages, for commissions/SAPL)
- analytical (8-15 pages, for archive/defense)
- Parses [EXEC]/[STD]/[ANA] markers from AI output
- Source collection with deduplication
- Visibility filtering per mode"
```

---

## Task 7: Integration Smoke Test

**Files:**
- No new files — validates all Phase 1 modules work together.

- [ ] **Step 1: Verify all new files compile together**

Run: `cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx tsc --noEmit`
Expected: Full project compiles with no errors from the new files.

- [ ] **Step 2: Verify memory module can be imported**

Create a temporary test by adding to the bottom of `memory.ts` (then remove):

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && node -e "
const types = require('./src/lib/alia/types');
console.log('Types loaded:', Object.keys(types).length > 0 ? 'OK' : 'FAIL');
console.log('AgentType exists:', typeof types !== 'undefined' ? 'OK' : 'FAIL');
"
```

Expected: Both OK (types are compile-time only, so this validates the file is parseable).

- [ ] **Step 3: Verify persona builds a prompt**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx ts-node --skip-project -e "
import { buildSystemPrompt } from './src/lib/alia/persona';
const prompt = buildSystemPrompt({
  agent: 'general',
  channel: 'whatsapp',
  memories: [],
  gabineteConfig: {
    parlamentar_nome: 'Carol Dantas',
    casa_legislativa: 'Câmara Municipal de Boa Vista',
    sigla_casa: 'CMBV',
    partido: 'MDB',
    comissoes_membro: ['CLJRF', 'COF'],
  },
  currentDate: new Date().toISOString(),
});
console.log('Prompt length:', prompt.length);
console.log('Contains identity:', prompt.includes('Carol Dantas'));
console.log('Contains rules:', prompt.includes('NUNCA invente'));
console.log('Contains channel:', prompt.includes('WhatsApp'));
console.log('Contains temporal:', prompt.includes('Hoje:'));
"
```

Expected: All `true`, prompt length > 2000 chars.

- [ ] **Step 4: Verify document renderer**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol && npx ts-node --skip-project -e "
import { renderDocument } from './src/lib/alia/document-renderer';
const doc = {
  id: 'test-1',
  tipo: 'parecer' as const,
  materia_ref: 'PL 45/2026',
  gerado_em: new Date().toISOString(),
  modelo_usado: 'gemini-2.5-flash',
  sections: [
    { id: 's1', title: 'Resumo', content: 'Favorável', visibility: 'executive' as const },
    { id: 's2', title: 'Fundamentação', content: 'Art. 30 CF/88', visibility: 'standard' as const },
    { id: 's3', title: 'Jurisprudência', content: 'STF RE 573.675', visibility: 'analytical' as const },
  ],
  executive_summary: 'Favorável',
};
const exec = renderDocument(doc, 'executive');
const std = renderDocument(doc, 'standard');
const ana = renderDocument(doc, 'analytical');
console.log('Executive sections:', exec.sections.length, '(expected 1)');
console.log('Standard sections:', std.sections.length, '(expected 2)');
console.log('Analytical sections:', ana.sections.length, '(expected 3)');
"
```

Expected: 1, 2, 3 sections respectively.

- [ ] **Step 5: Final commit for Phase 1**

```bash
cd /c/Dev/Cynthia/Gabinetecarol/gabinete-carol
git add -A
git status
git commit -m "feat(alia): complete Phase 1 — Foundation

ALIA Core Engine Phase 1 delivers:
- Shared types (types.ts)
- Persistent memory with semantic search (memory.ts + migration)
- Unified persona with 6-layer prompt builder (persona.ts)
- 3-mode document renderer (document-renderer.ts)
- Daily memory decay cron endpoint

Ready for Phase 2: Orchestration (gateway, brain, agent pool)"
```

---

## Phase 2-6 Plans (to be written after Phase 1 is complete)

Each subsequent phase will get its own detailed plan when the prior phase is done:

| Phase | Plan file | Dependencies |
|-------|-----------|-------------|
| Phase 2: Orchestration | `2026-XX-XX-alia-phase2-orchestration.md` | Phase 1 (types, memory, persona) |
| Phase 3: New Agents | `2026-XX-XX-alia-phase3-agents.md` | Phase 2 (agent interface, brain) |
| Phase 4: Proactivity | `2026-XX-XX-alia-phase4-proactive.md` | Phase 2 (gateway, dispatcher) |
| Phase 5: CADIN Intelligence | `2026-XX-XX-alia-phase5-cadin-intel.md` | Phase 1 (memory), Phase 2 (gateway) |
| Phase 6: RAG Jurídico | `2026-XX-XX-alia-phase6-rag-legal.md` | Phase 1 (types), existing rag.ts |
