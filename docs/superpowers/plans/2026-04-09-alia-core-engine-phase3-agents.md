# ALIA Core Engine — Phase 3: New Agents

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 new intelligent agents that didn't exist before: Email Intelligence (triagem + enrichment), Comissões (composition, deadlines, reports), and Cross-Module (queries spanning multiple data sources).

**Architecture:** Each agent implements the `AliaAgent` interface from Phase 2. They are registered in the brain's agent registry. The email agent adds a new DB table (`email_intelligence`). The comissão agent queries SAPL. The crossmodule agent queries multiple agents in parallel.

**Tech Stack:** TypeScript, Supabase, Google Generative AI, Next.js API routes

**Spec:** `docs/superpowers/specs/2026-04-09-alia-core-engine-design.md` — Sections 9, 10, 11

**Dependencies:** Phase 2 complete (brain.ts, agent.interface.ts, gateway.ts, classifier.ts)

---

## Task 1: Email Intelligence DB Migration

**Files:**
- Create: `supabase/migrations/034_email_intelligence.sql`

Create the email_intelligence table for storing triaged email metadata.

## Task 2: Email Intelligence Agent

**Files:**
- Create: `src/lib/alia/agents/email.agent.ts`

Agent that triages emails by urgency/category, enriches with CADIN cross-references, and suggests actions. Actions: triagem (classify batch), consultar (query specific email), sugerir_resposta (draft reply).

## Task 3: Comissões Agent

**Files:**
- Create: `src/lib/alia/agents/comissao.agent.ts`

Agent that queries commission composition, pending matters, deadlines, and generates reports. Actions: consultar (composition + status), pendencias (matters without parecer), relatorio (weekly/monthly report).

## Task 4: Cross-Module Agent

**Files:**
- Create: `src/lib/alia/agents/crossmodule.agent.ts`

Agent that queries multiple data sources in parallel to answer complex questions spanning CADIN + Indicações + Pareceres + Agenda. Action: consultar (parallel search across modules).

## Task 5: Register New Agents in Brain + Classifier

**Files:**
- Modify: `src/lib/alia/brain.ts` — add imports and registry entries
- Modify: `src/lib/alia/classifier.ts` — already has email/comissao keywords, verify crossmodule signals

## Task 6: Integration Verification

Verify all compiles, git log clean.
