# ALIA Autônoma — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir a ALIA de chat passivo para orquestradora semi-autônoma de pareceres com acionamento e notificação via WhatsApp, em 3 fases incrementais.

**Architecture:** Estender infraestrutura existente (gateway, brain, classifier, watchers, dispatcher) sem criar serviços novos. Fila assíncrona via tabela Supabase. Permissões por role no gateway antes de ações. Config de automação por gabinete.

**Tech Stack:** Next.js 15 (App Router), Supabase (Postgres + Auth), Gemini AI, Evolution API (WhatsApp)

**Spec:** `docs/superpowers/specs/2026-04-15-alia-autonoma-pareceres-design.md`

---

## Estrutura de Arquivos

### Criar
- `supabase/migrations/039_alia_autonoma.sql` — migration única (3 tabelas/colunas)
- `src/lib/alia/agents/consulta-materia.agent.ts` — agente de consulta de matérias (Fase 2)
- `src/lib/alia/auth-guard.ts` — validação de permissão por role para ações via WhatsApp
- `src/app/api/alia/task/process/route.ts` — processador de tarefas assíncronas (Fase 3)
- `src/app/api/admin/alia-config/route.ts` — CRUD de gabinete_alia_config (Fase 3)

### Modificar
- `src/lib/alia/types.ts` — adicionar `'consulta_materia'` ao AgentType
- `src/lib/alia/proactive/watcher.interface.ts` — adicionar EventType `'parecer_gerado'`
- `src/lib/alia/classifier.ts` — adicionar keyword signals para consulta_materia e gerar_parecer
- `src/lib/alia/proactive/watchers/sapl-watcher.ts` — enriquecer mensagens com contagem por tipo
- `src/lib/alia/proactive/dispatcher.ts` — formatar mensagens enriquecidas para WhatsApp
- `src/lib/alia/proactive/scheduler.ts` — importar config do gabinete para auto_parecer
- `src/app/api/alia/webhook/route.ts` — integrar auth-guard antes do brain
- `src/lib/permissions.ts` — adicionar module `'whatsapp_config'`
- `src/lib/alia/agents/ordem-dia.agent.ts` — estender para criar tarefas na queue (Fase 3)

---

## FASE 1 — Notificação Proativa via WhatsApp

### Task 1: Migration — tabelas e colunas novas

**Files:**
- Create: `supabase/migrations/039_alia_autonoma.sql`

- [ ] **Step 1: Criar arquivo de migration**

```sql
-- 039_alia_autonoma.sql
-- ALIA Autônoma: config por gabinete, task queue, action permissions em recipients.

-- ── gabinete_alia_config ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gabinete_alia_config (
  gabinete_id TEXT PRIMARY KEY,
  auto_parecer_on_ordem_dia BOOLEAN DEFAULT false,
  notify_ordem_dia BOOLEAN DEFAULT true,
  notify_materia_comissao BOOLEAN DEFAULT true,
  parecer_model TEXT DEFAULT 'flash',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- ── alia_task_queue ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alia_task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pendente',
  resultado JSONB,
  erro TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_queue_status
  ON alia_task_queue(status, created_at);

CREATE INDEX IF NOT EXISTS idx_task_queue_gabinete
  ON alia_task_queue(gabinete_id, status);

-- ── action_permissions em recipients ─────────────────────────────────────────
ALTER TABLE gabinete_whatsapp_recipients
  ADD COLUMN IF NOT EXISTS action_permissions TEXT[]
  DEFAULT ARRAY['receber_notificacoes', 'consultar_materias'];

-- Seed config padrão para gabinete carol-dantas
INSERT INTO gabinete_alia_config (gabinete_id, notify_ordem_dia, notify_materia_comissao)
VALUES ('carol-dantas-cmbv', true, true)
ON CONFLICT (gabinete_id) DO NOTHING;
```

- [ ] **Step 2: Aplicar migration no Supabase local**

Run: `cd gabinete-carol && npx supabase db push` (ou aplicar manualmente via Studio)
Expected: Tabelas criadas sem erro.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/039_alia_autonoma.sql
git commit -m "feat(migration): tabelas alia_autonoma — config, task_queue, action_permissions"
```

---

### Task 2: Enriquecer mensagens do sapl-watcher

**Files:**
- Modify: `src/lib/alia/proactive/watchers/sapl-watcher.ts`

- [ ] **Step 1: Ler estado atual do sapl-watcher**

Verificar como o watcher gera eventos hoje. Os campos relevantes do ProactiveEvent são:
- `title`: título curto
- `detail`: corpo da mensagem
- `action_url`: link para o painel

- [ ] **Step 2: Enriquecer evento `ordem_dia_publicada`**

No trecho onde o watcher cria o evento de ordem do dia publicada, substituir o detail simples por uma mensagem enriquecida com contagem de matérias por tipo:

```typescript
// Dentro do check() do saplWatcher, ao criar evento ordem_dia_publicada:

// Buscar matérias da sessão para contagem
let materiasDetail = '';
try {
  const resOrdem = await fetch(`${INTERNAL_BASE}/api/pareceres/ordem-dia?sessao_id=${ordem.id}`);
  if (resOrdem.ok) {
    const ordemData = await resOrdem.json() as { materias?: Array<{ tipo_sigla?: string }> };
    const materias = ordemData.materias || [];
    const porTipo: Record<string, number> = {};
    materias.forEach((m: { tipo_sigla?: string }) => {
      const tipo = m.tipo_sigla || 'Outros';
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    });
    const tiposStr = Object.entries(porTipo).map(([t, c]) => `${c} ${t}`).join(', ');
    materiasDetail = `\nMatérias: ${materias.length} (${tiposStr})`;
  }
} catch { /* silent — detail fica sem contagem */ }

// Usar no evento:
const event: ProactiveEvent = {
  id: `ordem-${ordem.id}`,
  type: 'ordem_dia_publicada',
  urgency: 'alta',
  title: `📋 Nova Ordem do Dia publicada`,
  detail: `Sessão: ${ordem.sessao_tipo} (${dataFormatada})${materiasDetail}\n\n👉 Revise no painel`,
  source: { watcher: 'sapl', ref_id: ordem.id },
  action_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://gabinete.wonetechnology.cloud'}/pareceres`,
  detected_at: new Date().toISOString(),
};
```

- [ ] **Step 3: Enriquecer evento `materia_nova`**

No trecho de matéria nova, melhorar o detail:

```typescript
const event: ProactiveEvent = {
  id: `materia-${materia.id}`,
  type: 'materia_nova',
  urgency: 'informativa',
  title: `🔔 Nova matéria: ${materia.tipo} ${materia.numero}/${materia.ano}`,
  detail: `${materia.ementa ? `Ementa: ${materia.ementa.slice(0, 120)}${materia.ementa.length > 120 ? '...' : ''}` : '(sem ementa)'}\n\n👉 Ver no painel de Relatoria`,
  source: { watcher: 'sapl', ref_id: materia.id },
  action_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://gabinete.wonetechnology.cloud'}/pareceres`,
  detected_at: new Date().toISOString(),
};
```

- [ ] **Step 4: Verificar que o watcher respeita config do gabinete**

Adicionar leitura da `gabinete_alia_config` no início do check():

```typescript
import { createClient } from '@supabase/supabase-js';

// Dentro de check(gabineteId):
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const { data: config } = await supabase
  .from('gabinete_alia_config')
  .select('notify_ordem_dia, notify_materia_comissao, auto_parecer_on_ordem_dia')
  .eq('gabinete_id', gabineteId)
  .single();

// Filtrar eventos com base na config
const events: ProactiveEvent[] = [];

// Só emitir ordem_dia_publicada se config permite
if (config?.notify_ordem_dia !== false) {
  // ... detecção de ordem do dia existente ...
}

// Só emitir materia_nova se config permite
if (config?.notify_materia_comissao !== false) {
  // ... detecção de matérias novas existente ...
}
```

- [ ] **Step 5: Testar localmente**

Run: `cd gabinete-carol && npx tsx -e "import { saplWatcher } from './src/lib/alia/proactive/watchers/sapl-watcher'; saplWatcher.check('carol-dantas-cmbv').then(e => console.log(JSON.stringify(e, null, 2)))"`

Expected: Array de ProactiveEvent com mensagens enriquecidas.

- [ ] **Step 6: Commit**

```bash
git add src/lib/alia/proactive/watchers/sapl-watcher.ts
git commit -m "feat(alia): enriquecer mensagens sapl-watcher com contagem de matérias e links"
```

---

### Task 3: Garantir event_types nos recipients

**Files:**
- Modify: `src/lib/alia/proactive/dispatcher.ts`

- [ ] **Step 1: Verificar que dispatcher filtra por event_types_allowed**

Ler `dispatcher.ts` e confirmar que `dispatchWhatsApp` já filtra recipients por `event_types_allowed` incluindo `'ordem_dia_publicada'` e `'materia_nova'`. Se já filtra (com null = todos), não precisa mudar.

- [ ] **Step 2: Verificar formato de mensagem WhatsApp**

O dispatcher já formata com emoji + título + detail. Confirmar que o formato aceita mensagens multilinhas. Se o formato trunca o `detail`, ajustar para incluir detail completo:

```typescript
// Em dispatchWhatsApp, ao formatar mensagem:
const urgencyEmoji: Record<string, string> = {
  critica: '🔴', alta: '🟡', media: '🔵', baixa: '⚪', informativa: 'ℹ️',
};

const emoji = urgencyEmoji[alert.urgency] || 'ℹ️';
const title = alert.consolidation || alert.events[0]?.title || 'Notificação';
const detail = alert.events.length === 1
  ? alert.events[0].detail
  : alert.events.map(e => `• ${e.title}`).join('\n');
const url = alert.events[0]?.action_url || '';

const message = `${emoji} *${title}*\n${detail}${url ? `\n\n${url}` : ''}`;
```

- [ ] **Step 3: Commit (se houve alteração)**

```bash
git add src/lib/alia/proactive/dispatcher.ts
git commit -m "fix(alia): garantir formato completo de mensagem WhatsApp no dispatcher"
```

---

### Task 4: Configurar frequência do cron

**Files:**
- Modify: `src/lib/alia/proactive/watchers/sapl-watcher.ts`

- [ ] **Step 1: Ajustar schedule do sapl-watcher**

Confirmar que o schedule está como `'0 */2 8-18 * * *'` (a cada 2h entre 8h e 18h). Se estiver diferente, ajustar:

```typescript
export const saplWatcher: Watcher = {
  name: 'sapl',
  schedule: '0 */2 8-18 * * *',  // A cada 2h, 8h-18h (horário da VPS = UTC-4 Boa Vista)
  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    // ...
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/alia/proactive/watchers/sapl-watcher.ts
git commit -m "feat(alia): ajustar schedule sapl-watcher para 2h entre 8h-18h"
```

---

### Task 5: Teste de integração Fase 1

- [ ] **Step 1: Verificar build**

Run: `cd gabinete-carol && npm run typecheck`
Expected: Sem erros de tipo.

- [ ] **Step 2: Testar fluxo completo via cron endpoint (local)**

Run: `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3001/api/cron/alia-proactive?watchers=sapl"`

Expected: JSON com `{ ok: true, events: N, alerts: N, sent: 0, failed: 0 }` (sent=0 porque WhatsApp não está conectado local).

- [ ] **Step 3: Commit final Fase 1**

```bash
git add -A
git commit -m "feat(alia): Fase 1 completa — notificação proativa via sapl-watcher"
```

---

## FASE 2 — Consulta de Matérias via WhatsApp e Chat

### Task 6: Adicionar tipo consulta_materia

**Files:**
- Modify: `src/lib/alia/types.ts`

- [ ] **Step 1: Adicionar ao AgentType**

```typescript
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
  | 'crossmodule'
  | 'consulta_materia';
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/alia/types.ts
git commit -m "feat(alia): adicionar tipo consulta_materia ao AgentType"
```

---

### Task 7: Criar agente consulta_materia

**Files:**
- Create: `src/lib/alia/agents/consulta-materia.agent.ts`

- [ ] **Step 1: Criar o agente**

```typescript
// src/lib/alia/agents/consulta-materia.agent.ts
// ALIA Agent: Consulta de Matérias — busca ementa, autoria, tramitação no SAPL.

import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

// ── Helpers ─────────────────────────────────────────────────────────────────

interface MateriaData {
  id: number;
  tipo_sigla: string;
  numero: number;
  ano: number;
  ementa: string;
  autores?: string;
  data_tramitacao?: string;
  comissoes?: Array<{ sigla: string; parecer?: string }>;
  procuradoria?: string;
  url_sapl?: string;
}

function parseMateriRef(text: string): { tipo?: string; numero?: number; ano?: number } | null {
  // Tenta extrair "PLL 32/2026", "PLE 5/2026", "REQ 12/2025", etc.
  const match = text.match(/\b(PLL|PLE|PLO|REQ|IND|RLO|PDL|PEC)\s*(\d+)\s*[\/\-]\s*(\d{4})\b/i);
  if (match) {
    return { tipo: match[1].toUpperCase(), numero: parseInt(match[2]), ano: parseInt(match[3]) };
  }
  // Tenta só número/ano
  const numMatch = text.match(/\b(\d+)\s*[\/\-]\s*(\d{4})\b/);
  if (numMatch) {
    return { numero: parseInt(numMatch[1]), ano: parseInt(numMatch[2]) };
  }
  return null;
}

function formatFichaTecnica(m: MateriaData): string {
  const lines: string[] = [];
  lines.push(`📄 *${m.tipo_sigla} ${m.numero}/${m.ano}*`);
  if (m.autores) lines.push(`Autor: ${m.autores}`);
  lines.push(`Ementa: ${m.ementa || '(sem ementa)'}`);
  lines.push('');
  lines.push('📊 *Tramitação:*');
  if (m.data_tramitacao) lines.push(`  • Entrada: ${new Date(m.data_tramitacao + 'T00:00:00').toLocaleDateString('pt-BR')}`);
  if (m.comissoes && m.comissoes.length > 0) {
    m.comissoes.forEach(c => {
      const status = c.parecer === 'Favorável' ? '✅ Favorável'
        : c.parecer === 'Contrário' ? '❌ Contrário'
        : '⏳ Pendente';
      lines.push(`  • ${c.sigla}: ${status}`);
    });
  }
  if (m.procuradoria) {
    const procStatus = m.procuradoria.toLowerCase().includes('favorável') ? '✅ Favorável'
      : m.procuradoria.toLowerCase().includes('contrário') ? '❌ Contrário'
      : m.procuradoria;
    lines.push(`  • Procuradoria: ${procStatus}`);
  }
  if (m.url_sapl) {
    lines.push('');
    lines.push(`🔗 Ver no SAPL: ${m.url_sapl}`);
  }
  return lines.join('\n');
}

// ── Agent ────────────────────────────────────────────────────────────────────

export const consultaMateriaAgent: AliaAgent = {
  name: 'consulta_materia',
  description: 'Consulta ementa, autoria, tramitação e pareceres de matérias legislativas no SAPL.',

  async execute({ data, context }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const query = (data.query as string) || '';
      const ref = parseMateriRef(query);

      if (!ref) {
        // Busca textual na ementa via RAG ou API
        const searchRes = await fetch(`${INTERNAL_BASE}/api/pareceres/buscar-materia?q=${encodeURIComponent(query)}`);
        if (!searchRes.ok) {
          return {
            success: true,
            content: `Não consegui identificar uma matéria na sua mensagem. Tente informar o número completo, por exemplo: "PLL 32/2026".`,
          };
        }
        const searchData = await searchRes.json() as { materias?: MateriaData[] };
        const materias = searchData.materias || [];
        if (materias.length === 0) {
          return {
            success: true,
            content: `Não encontrei nenhuma matéria com esse termo. Tente informar o número completo (ex: PLL 32/2026).`,
          };
        }
        if (materias.length === 1) {
          return { success: true, content: formatFichaTecnica(materias[0]) };
        }
        // Múltiplos resultados
        const list = materias.slice(0, 5).map((m, i) =>
          `${i + 1}. *${m.tipo_sigla} ${m.numero}/${m.ano}* — ${(m.ementa || '').slice(0, 80)}...`
        ).join('\n');
        return {
          success: true,
          content: `Encontrei ${materias.length} matérias. Qual delas?\n\n${list}\n\nResponda com o número completo para ver a ficha.`,
        };
      }

      // Busca direta por tipo/numero/ano
      const params = new URLSearchParams();
      if (ref.tipo) params.set('tipo_sigla', ref.tipo);
      if (ref.numero) params.set('numero', String(ref.numero));
      if (ref.ano) params.set('ano', String(ref.ano));

      const res = await fetch(`${INTERNAL_BASE}/api/pareceres/buscar-materia?${params}`);
      if (!res.ok) {
        return { success: false, content: 'Erro ao consultar o SAPL. Tente novamente em instantes.' };
      }

      const resData = await res.json() as { materias?: MateriaData[] };
      const materias = resData.materias || [];

      if (materias.length === 0) {
        return {
          success: true,
          content: `Não encontrei ${ref.tipo || ''} ${ref.numero}/${ref.ano} no SAPL. Verifique o número e tente novamente.`,
        };
      }

      return { success: true, content: formatFichaTecnica(materias[0]) };
    } catch (err) {
      return { success: false, content: `Erro ao consultar matéria: ${err instanceof Error ? err.message : 'desconhecido'}` };
    }
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/alia/agents/consulta-materia.agent.ts
git commit -m "feat(alia): criar agente consulta_materia com ficha técnica padronizada"
```

---

### Task 8: Endpoint de busca de matéria

**Files:**
- Create: `src/app/api/pareceres/buscar-materia/route.ts`

- [ ] **Step 1: Verificar se já existe endpoint similar**

Run: `ls gabinete-carol/src/app/api/pareceres/` — verificar se já tem busca por matéria.

- [ ] **Step 2: Criar endpoint de busca**

```typescript
// src/app/api/pareceres/buscar-materia/route.ts
import { NextRequest, NextResponse } from 'next/server';

const SAPL_BASE = 'https://sapl.boavista.rr.leg.br/api';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tipo_sigla = searchParams.get('tipo_sigla');
  const numero = searchParams.get('numero');
  const ano = searchParams.get('ano');
  const q = searchParams.get('q'); // busca textual

  try {
    let materias: Record<string, unknown>[] = [];

    if (tipo_sigla && numero && ano) {
      // Busca direta
      const params = new URLSearchParams({ tipo__sigla: tipo_sigla, numero, ano });
      const res = await fetch(`${SAPL_BASE}/materia/materialegislativa/?${params}&format=json`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json() as { results?: Record<string, unknown>[] };
        materias = data.results || [];
      }
    } else if (numero && ano) {
      // Busca por numero/ano sem tipo
      const res = await fetch(`${SAPL_BASE}/materia/materialegislativa/?numero=${numero}&ano=${ano}&format=json`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json() as { results?: Record<string, unknown>[] };
        materias = data.results || [];
      }
    } else if (q) {
      // Busca textual na ementa
      const res = await fetch(`${SAPL_BASE}/materia/materialegislativa/?ementa__icontains=${encodeURIComponent(q)}&ordering=-data_apresentacao&page_size=5&format=json`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json() as { results?: Record<string, unknown>[] };
        materias = data.results || [];
      }
    }

    // Normalizar resposta
    const normalized = materias.map((m: Record<string, unknown>) => ({
      id: m.id,
      tipo_sigla: (m as { tipo_descricao?: string }).tipo_descricao?.split(' ')[0] || String(m.tipo || ''),
      numero: m.numero,
      ano: m.ano,
      ementa: m.ementa || '',
      autores: (m as { autores_display?: string }).autores_display || '',
      data_tramitacao: m.data_apresentacao || '',
      url_sapl: `https://sapl.boavista.rr.leg.br/materia/${m.id}`,
    }));

    return NextResponse.json({ materias: normalized });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro SAPL' },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 3: Testar endpoint**

Run: `curl "http://localhost:3001/api/pareceres/buscar-materia?tipo_sigla=PLL&numero=32&ano=2026"`

Expected: JSON com `{ materias: [...] }`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/pareceres/buscar-materia/route.ts
git commit -m "feat(api): endpoint buscar-materia para consulta SAPL por tipo/numero/ano/texto"
```

---

### Task 9: Registrar agente no classifier e brain

**Files:**
- Modify: `src/lib/alia/classifier.ts`
- Modify: `src/lib/alia/brain.ts` (importar e registrar agente)

- [ ] **Step 1: Adicionar keyword signals no classifier**

Adicionar ao array KEYWORD_SIGNALS:

```typescript
{
  keywords: ['ementa', 'autoria', 'autor', 'tramitação', 'tramitacao', 'consultar matéria',
    'consultar materia', 'sobre o que é', 'sobre o que e', 'qual projeto', 'ficha',
    'PLL', 'PLE', 'PLO', 'REQ', 'IND', 'RLO', 'PDL'],
  agent: 'consulta_materia',
  action: 'consultar',
  boost: 3.0,
},
```

- [ ] **Step 2: Adicionar page context mapping**

```typescript
// No PAGE_CONTEXT_MAP:
'pareceres': 'consulta_materia',  // se já existir 'pareceres', deixar como está
```

Nota: se `pareceres` já mapeia para `parecer`, manter assim — o classifier resolverá pelo keyword boost.

- [ ] **Step 3: Registrar agente no brain**

Ler `src/lib/alia/brain.ts` e encontrar onde os agentes são importados/registrados. Adicionar:

```typescript
import { consultaMateriaAgent } from './agents/consulta-materia.agent';

// No mapa de agentes (ex: AGENT_MAP ou similar):
consulta_materia: consultaMateriaAgent,
```

- [ ] **Step 4: Verificar build**

Run: `cd gabinete-carol && npm run typecheck`
Expected: Sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alia/classifier.ts src/lib/alia/brain.ts
git commit -m "feat(alia): registrar agente consulta_materia no classifier e brain"
```

---

### Task 10: Teste de integração Fase 2

- [ ] **Step 1: Testar via chat dashboard (local)**

Abrir `http://localhost:3001/laia` e enviar:
- "Qual a ementa do PLL 32/2026?"
- "Quem é o autor do PLE 5/2026?"
- "Tem algum projeto sobre escolas?"

Expected: Ficha técnica formatada para as duas primeiras, lista de resultados para a terceira.

- [ ] **Step 2: Verificar build completo**

Run: `cd gabinete-carol && npm run check`
Expected: typecheck + lint + build OK.

- [ ] **Step 3: Commit final Fase 2**

```bash
git add -A
git commit -m "feat(alia): Fase 2 completa — consulta de matérias via chat e WhatsApp"
```

---

## FASE 3 — Geração Autônoma de Pareceres

### Task 11: Auth guard para ações via WhatsApp

**Files:**
- Create: `src/lib/alia/auth-guard.ts`

- [ ] **Step 1: Criar módulo de validação de permissão**

```typescript
// src/lib/alia/auth-guard.ts
// Valida se o sender tem permissão para executar uma ação via WhatsApp.

import { createClient } from '@supabase/supabase-js';

export type ActionPermission =
  | 'receber_notificacoes'
  | 'consultar_materias'
  | 'gerar_pareceres'
  | 'configurar_automacao';

// Intents que requerem permissão específica
const INTENT_PERMISSIONS: Record<string, ActionPermission> = {
  gerar_parecer_ordem_dia: 'gerar_pareceres',
  gerar_parecer_comissao: 'gerar_pareceres',
  configurar_automacao: 'configurar_automacao',
};

interface AuthResult {
  allowed: boolean;
  reason?: string;
  recipientName?: string;
}

export async function checkActionPermission(
  phone: string,
  gabineteId: string,
  intentAction: string,
): Promise<AuthResult> {
  // Ações sem restrição (consulta, conversa geral)
  const requiredPermission = INTENT_PERMISSIONS[intentAction];
  if (!requiredPermission) {
    return { allowed: true };
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Buscar recipient pelo telefone
  const cleanPhone = phone.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  const { data: recipient } = await supabase
    .from('gabinete_whatsapp_recipients')
    .select('nome, action_permissions, enabled')
    .eq('gabinete_id', gabineteId)
    .eq('enabled', true)
    .filter('telefone', 'ilike', `%${cleanPhone.slice(-11)}`)
    .single();

  if (!recipient) {
    return {
      allowed: false,
      reason: 'Seu número não está cadastrado no sistema. Peça ao assessor sênior para cadastrá-lo.',
    };
  }

  const permissions: string[] = recipient.action_permissions || ['receber_notificacoes', 'consultar_materias'];

  if (!permissions.includes(requiredPermission)) {
    return {
      allowed: false,
      reason: `Você não tem permissão para essa ação. Permissão necessária: ${requiredPermission}.`,
      recipientName: recipient.nome,
    };
  }

  return { allowed: true, recipientName: recipient.nome };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/alia/auth-guard.ts
git commit -m "feat(alia): auth-guard para validar permissões de ação via WhatsApp"
```

---

### Task 12: Integrar auth-guard no webhook

**Files:**
- Modify: `src/app/api/alia/webhook/route.ts`

- [ ] **Step 1: Adicionar verificação de permissão antes do brain**

Após a classificação de intent (ou antes do brain, que classifica internamente), adicionar:

```typescript
import { checkActionPermission } from '@/lib/alia/auth-guard';

// Após construir o AliaRequest e antes de chamar aliaBrain:
// Extrair intent para verificar permissão
// Como o brain classifica internamente, fazemos pre-check com keywords simples:
const actionKeywords: Record<string, string> = {
  'gerar parecer': 'gerar_parecer_ordem_dia',
  'gera parecer': 'gerar_parecer_ordem_dia',
  'gerar pareceres': 'gerar_parecer_ordem_dia',
  'gera os pareceres': 'gerar_parecer_ordem_dia',
  'configurar alia': 'configurar_automacao',
  'configurar automação': 'configurar_automacao',
};

const textLower = text.toLowerCase();
let detectedAction = '';
for (const [keyword, action] of Object.entries(actionKeywords)) {
  if (textLower.includes(keyword)) {
    detectedAction = action;
    break;
  }
}

if (detectedAction) {
  const authResult = await checkActionPermission(remoteJid, aliaRequest.gabinete_id, detectedAction);
  if (!authResult.allowed) {
    await sendWhatsAppMessage(remoteJid, `⚠️ ${authResult.reason}`);
    await saveMessage(session.id, 'assistant', authResult.reason || 'Sem permissão.');
    return NextResponse.json({ ok: true, blocked_by_permission: true });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/alia/webhook/route.ts
git commit -m "feat(alia): integrar auth-guard no webhook WhatsApp antes do brain"
```

---

### Task 13: Processador de tarefas assíncronas

**Files:**
- Create: `src/app/api/alia/task/process/route.ts`

- [ ] **Step 1: Criar endpoint processador**

```typescript
// src/app/api/alia/task/process/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppMessage } from '@/lib/alia/adapters/whatsapp';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://gabinete.wonetechnology.cloud';

export async function POST(req: NextRequest) {
  // Auth: cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pegar próxima tarefa pendente
  const { data: task, error: fetchErr } = await supabase
    .from('alia_task_queue')
    .select('*')
    .eq('status', 'pendente')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (fetchErr || !task) {
    return NextResponse.json({ ok: true, message: 'Nenhuma tarefa pendente' });
  }

  // Marcar como processando
  await supabase
    .from('alia_task_queue')
    .update({ status: 'processando', started_at: new Date().toISOString() })
    .eq('id', task.id);

  try {
    const payload = task.payload as {
      sessao_id?: string;
      materia_ids?: number[];
      modelo?: string;
      solicitante_phone?: string;
      solicitante_nome?: string;
    };

    if (task.tipo === 'gerar_parecer_ordem_dia') {
      // Chamar endpoint de geração existente
      const res = await fetch(`${INTERNAL_BASE}/api/pareceres/gerar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materia_ids: payload.materia_ids,
          model: payload.modelo || 'flash',
          source: 'alia_autonoma',
        }),
      });

      if (!res.ok) {
        throw new Error(`Geração falhou: ${res.status} ${await res.text()}`);
      }

      const result = await res.json() as { parecer?: string; total?: number };

      // Salvar resultado
      await supabase
        .from('alia_task_queue')
        .update({
          status: 'concluido',
          completed_at: new Date().toISOString(),
          resultado: {
            total: payload.materia_ids?.length || 0,
            preview: (result.parecer || '').slice(0, 200),
          },
        })
        .eq('id', task.id);

      // Notificar solicitante via WhatsApp
      if (payload.solicitante_phone) {
        const totalMaterias = payload.materia_ids?.length || 0;
        const msg = [
          `📋 *Pareceres prontos!*`,
          `${totalMaterias} parecer${totalMaterias > 1 ? 'es' : ''} gerado${totalMaterias > 1 ? 's' : ''}`,
          ``,
          `👉 Revise e aprove no painel:`,
          `${APP_URL}/pareceres`,
        ].join('\n');

        await sendWhatsAppMessage(payload.solicitante_phone, msg);
      }

      return NextResponse.json({
        ok: true,
        task_id: task.id,
        status: 'concluido',
        total_materias: payload.materia_ids?.length,
      });
    }

    // Tipo desconhecido
    throw new Error(`Tipo de tarefa desconhecido: ${task.tipo}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';

    await supabase
      .from('alia_task_queue')
      .update({
        status: 'erro',
        completed_at: new Date().toISOString(),
        erro: errorMsg,
      })
      .eq('id', task.id);

    // Notificar erro ao solicitante
    const payload = task.payload as { solicitante_phone?: string };
    if (payload.solicitante_phone) {
      await sendWhatsAppMessage(
        payload.solicitante_phone,
        `⚠️ Erro ao gerar pareceres: ${errorMsg}\n\nTente novamente ou use o painel manualmente.`
      );
    }

    return NextResponse.json({ ok: false, task_id: task.id, error: errorMsg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/alia/task/process/route.ts
git commit -m "feat(alia): processador de tarefas assíncronas para geração de pareceres"
```

---

### Task 14: Estender agente ordem_dia para criar tarefas

**Files:**
- Modify: `src/lib/alia/agents/ordem-dia.agent.ts`

- [ ] **Step 1: Adicionar keyword signals para gerar_parecer no classifier**

Em `src/lib/alia/classifier.ts`, adicionar:

```typescript
{
  keywords: ['gerar parecer', 'gera parecer', 'gerar pareceres', 'gera os pareceres',
    'analisa ordem do dia', 'analisa a ordem', 'processa ordem do dia',
    'processa a pauta', 'prepara pareceres'],
  agent: 'ordem_dia',
  action: 'gerar_parecer_ordem_dia',
  boost: 5.0,  // boost alto para garantir prioridade sobre consulta
},
```

- [ ] **Step 2: Estender execute() do agente ordem_dia**

Adicionar branch para action `gerar_parecer_ordem_dia`:

```typescript
// No início do execute(), após o try:
if (_action === 'gerar_parecer_ordem_dia' || (data.query as string || '').toLowerCase().match(/gera[r]?\s*(os\s*)?parecer/)) {
  // Buscar sessão mais recente com pauta
  const resSessoes = await fetch(`${INTERNAL_BASE}/api/pareceres/sessoes`);
  if (!resSessoes.ok) {
    return { success: false, content: 'Não consegui acessar as sessões do SAPL.' };
  }
  const sessoesData = await resSessoes.json() as { results?: Array<{ id: string | number; upload_pauta?: string; data_inicio?: string; tipo?: string; numero?: string | number }> };
  const sessoes = sessoesData.results || [];
  const sessaoComPauta = sessoes.find(s => s.upload_pauta);

  if (!sessaoComPauta) {
    return { success: true, content: 'Não encontrei nenhuma sessão com pauta publicada. Verifique se a pauta já foi disponibilizada no SAPL.' };
  }

  // Extrair matérias
  const resOrdem = await fetch(`${INTERNAL_BASE}/api/pareceres/ordem-dia?sessao_id=${sessaoComPauta.id}`);
  if (!resOrdem.ok) {
    return { success: false, content: 'Erro ao extrair matérias da ordem do dia.' };
  }
  const ordemData = await resOrdem.json() as { materias?: Array<{ id: number; tipo_sigla?: string }> };
  const materias = ordemData.materias || [];

  if (materias.length === 0) {
    return { success: true, content: 'A pauta foi encontrada mas não contém matérias identificáveis.' };
  }

  // Criar tarefa na fila
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Ler config do gabinete para modelo
  const { data: config } = await supabase
    .from('gabinete_alia_config')
    .select('parecer_model')
    .eq('gabinete_id', context.gabineteId)
    .single();

  const { error: insertErr } = await supabase
    .from('alia_task_queue')
    .insert({
      gabinete_id: context.gabineteId,
      tipo: 'gerar_parecer_ordem_dia',
      payload: {
        sessao_id: sessaoComPauta.id,
        materia_ids: materias.map(m => m.id),
        modelo: config?.parecer_model || 'flash',
        solicitante_phone: data.sender_phone || undefined,
        solicitante_nome: data.sender_name || undefined,
      },
    });

  if (insertErr) {
    return { success: false, content: `Erro ao criar tarefa: ${insertErr.message}` };
  }

  const porTipo: Record<string, number> = {};
  materias.forEach(m => {
    const tipo = m.tipo_sigla || 'Outros';
    porTipo[tipo] = (porTipo[tipo] || 0) + 1;
  });
  const tiposStr = Object.entries(porTipo).map(([t, c]) => `${c} ${t}`).join(', ');

  return {
    success: true,
    content: `✅ Entendido! Encontrei a sessão ${sessaoComPauta.tipo || ''} ${sessaoComPauta.numero || ''} (${sessaoComPauta.data_inicio || ''}) com ${materias.length} matérias (${tiposStr}).\n\nEstou gerando os pareceres agora. Te aviso quando terminar.\n⏱ Estimativa: ${materias.length * 1}-${materias.length * 2} minutos.`,
    actions_taken: ['task_queue_created'],
  };
}
```

- [ ] **Step 3: Passar sender info no webhook**

Em `src/app/api/alia/webhook/route.ts`, ao construir o data para o brain, incluir sender_phone e sender_name:

```typescript
// Ao chamar aliaBrain, incluir no request ou data:
// Verificar como o brain passa data para os agentes e adicionar:
// data.sender_phone = remoteJid;
// data.sender_name = pushName;
```

Verificar exatamente como o brain repassa data para os agentes e incluir esses campos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/alia/agents/ordem-dia.agent.ts src/lib/alia/classifier.ts src/app/api/alia/webhook/route.ts
git commit -m "feat(alia): agente ordem_dia cria tarefa na queue quando solicitado via WhatsApp"
```

---

### Task 15: Conectar cron ao processador de tarefas

**Files:**
- Modify: `src/app/api/cron/alia-proactive/route.ts`

- [ ] **Step 1: Adicionar processamento de tarefas ao cron**

Após executar os watchers, processar tarefas pendentes:

```typescript
// Após runWatchers():
// Processar tarefas pendentes (Fase 3)
let tasksProcessed = 0;
try {
  const taskRes = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/alia/task/process`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  if (taskRes.ok) {
    const taskData = await taskRes.json() as { ok: boolean; task_id?: string };
    if (taskData.task_id) tasksProcessed = 1;
  }
} catch { /* silent — tasks serão processadas na próxima execução */ }

// Incluir no response:
return NextResponse.json({
  ok: true,
  type: 'watchers',
  events,
  alerts,
  sent,
  failed,
  tasks_processed: tasksProcessed,
  ran_at: new Date().toISOString(),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/alia-proactive/route.ts
git commit -m "feat(alia): cron processa task_queue após executar watchers"
```

---

### Task 16: Auto-geração via watcher (config habilitada)

**Files:**
- Modify: `src/lib/alia/proactive/watchers/sapl-watcher.ts`

- [ ] **Step 1: Criar tarefa automaticamente quando config permite**

Quando `auto_parecer_on_ordem_dia = true` e ordem do dia é detectada:

```typescript
// Após criar o evento ordem_dia_publicada, se config permite auto-geração:
if (config?.auto_parecer_on_ordem_dia) {
  try {
    // Extrair matérias para criar tarefa
    const resOrdem = await fetch(`${INTERNAL_BASE}/api/pareceres/ordem-dia?sessao_id=${ordem.id}`);
    if (resOrdem.ok) {
      const ordemData = await resOrdem.json() as { materias?: Array<{ id: number }> };
      const materias = ordemData.materias || [];
      if (materias.length > 0) {
        await supabase.from('alia_task_queue').insert({
          gabinete_id: gabineteId,
          tipo: 'gerar_parecer_ordem_dia',
          payload: {
            sessao_id: ordem.id,
            materia_ids: materias.map((m: { id: number }) => m.id),
            modelo: config.parecer_model || 'flash',
            auto_generated: true,
          },
        });
      }
    }
  } catch { /* silent — tarefa será criada manualmente se falhar */ }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/alia/proactive/watchers/sapl-watcher.ts
git commit -m "feat(alia): auto-gerar pareceres via watcher quando config habilitada"
```

---

### Task 17: Adicionar permission no permissions.ts

**Files:**
- Modify: `src/lib/permissions.ts`

- [ ] **Step 1: Adicionar módulo whatsapp_config**

```typescript
// No array ALL_MODULES, adicionar:
{ id: 'whatsapp_config', label: 'Config WhatsApp' },
```

- [ ] **Step 2: Verificar consumidores de permissions.ts**

Run: `grep -r "ALL_MODULES\|hasPermission\|ModuleId" gabinete-carol/src/ --include="*.ts" --include="*.tsx" -l`

Verificar se algum consumidor depende da ordem ou tamanho fixo do array. Ajustar se necessário.

- [ ] **Step 3: Commit**

```bash
git add src/lib/permissions.ts
git commit -m "feat(permissions): adicionar módulo whatsapp_config para gerenciamento de recipients"
```

---

### Task 18: Endpoint config da ALIA (somente superadmin)

**Files:**
- Create: `src/app/api/admin/alia-config/route.ts`

- [ ] **Step 1: Criar CRUD da config**

```typescript
// src/app/api/admin/alia-config/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-helpers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('gabinete_alia_config')
    .select('*')
    .eq('gabinete_id', auth.gabinete_id)
    .single();

  return NextResponse.json({ config: data || {
    gabinete_id: auth.gabinete_id,
    auto_parecer_on_ordem_dia: false,
    notify_ordem_dia: true,
    notify_materia_comissao: true,
    parecer_model: 'flash',
  }});
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Somente superadmin pode alterar config
  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'Apenas o superadmin pode alterar configurações da ALIA.' }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;
  const allowed = ['auto_parecer_on_ordem_dia', 'notify_ordem_dia', 'notify_materia_comissao', 'parecer_model'];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: auth.user_id };

  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  const { data, error } = await supabase
    .from('gabinete_alia_config')
    .upsert({ gabinete_id: auth.gabinete_id, ...updates })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ config: data });
}
```

Nota: Verificar como `requireAuth` funciona neste projeto. Pode ser `requireAuth(req)` ou outro padrão. Adaptar à assinatura existente em `src/lib/auth-helpers.ts` ou equivalente.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/alia-config/route.ts
git commit -m "feat(api): CRUD gabinete_alia_config — somente superadmin pode alterar"
```

---

### Task 19: Verificação final e build

- [ ] **Step 1: Verificar tipos**

Run: `cd gabinete-carol && npm run typecheck`
Expected: Sem erros.

- [ ] **Step 2: Verificar build completo**

Run: `cd gabinete-carol && npm run check`
Expected: typecheck + lint + build OK.

- [ ] **Step 3: Verificar que deploy script inclui novos arquivos**

Verificar `deploy-gv.ps1` e adicionar os novos arquivos criados:
- `src/lib/alia/auth-guard.ts`
- `src/lib/alia/agents/consulta-materia.agent.ts`
- `src/app/api/alia/task/process/route.ts`
- `src/app/api/admin/alia-config/route.ts`
- `src/app/api/pareceres/buscar-materia/route.ts`

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "feat(alia): ALIA Autônoma completa — 3 fases implementadas"
```

---

## Resumo de Tasks por Fase

| Fase | Tasks | Descrição |
|------|-------|-----------|
| **1** | 1-5 | Migration + sapl-watcher enriquecido + dispatcher + cron |
| **2** | 6-10 | Tipo + agente consulta_materia + endpoint busca + classifier + testes |
| **3** | 11-19 | Auth guard + webhook + task processor + ordem_dia extend + cron + auto-gen + permissions + config API + build |

**Total: 19 tasks, ~45 steps**
