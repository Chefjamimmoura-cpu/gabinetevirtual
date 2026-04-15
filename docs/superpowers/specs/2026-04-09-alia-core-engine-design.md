# ALIA Core Engine — Design Spec

**Data:** 2026-04-09  
**Status:** Aprovado  
**Abordagem:** ALIA Core Engine (Abordagem 1) — Incremental por camada  
**Modelo:** Orquestradora central + Proativa autônoma + Memória completa  
**Orquestração:** Híbrido por canal (Gemini rotina / Claude complexo)  
**Canais:** WhatsApp + Dashboard + Email (todos)  
**Custo:** Qualidade primeiro, multi-provider (Gemini + Claude + Groq)  
**Total de fases:** 6 fases, 24 entregas incrementais  
**Novas tabelas SQL:** 8 (alia_memory, cadin_sentinel_logs, cadin_pending_updates, cadin_ingest_jobs, alia_notifications, alia_proactive_log, alia_notification_prefs, email_intelligence)  
**Novos módulos:** ~45 arquivos em src/lib/alia/  
**Agentes novos:** 3 (email, comissao, crossmodule) + 10 watchers + 11 sources RAG

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Camada 1 — ALIA Memory](#2-camada-1--alia-memory)
3. [Camada 1.1 — CADIN Sentinel](#3-camada-11--cadin-sentinel)
4. [Camada 1.1.1 — Janela de Curadoria](#4-camada-111--janela-de-curadoria)
5. [Camada 1.2 — CADIN Ingestor](#5-camada-12--cadin-ingestor)
6. [Camada 2 — ALIA Brain (Orquestrador Central)](#6-camada-2--alia-brain)
7. [Camada 3 — ALIA Proactive Engine](#7-camada-3--alia-proactive-engine)
8. [Camada 4 — ALIA Persona](#8-camada-4--alia-persona)
9. [Camada 5.1 — Email Intelligence Agent](#9-camada-51--email-intelligence-agent)
10. [Camada 5.2 — Comissões Agent](#10-camada-52--comissões-agent)
11. [Camada 5.3 — Social Media Watcher](#11-camada-53--social-media-watcher)
12. [Camada 6 — RAG Jurídico-Legislativo](#12-camada-6--rag-jurídico-legislativo)
13. [Camada 7 — Modos de Apresentação de Documentos](#13-camada-7--modos-de-apresentação)
14. [Arquitetura de Arquivos](#14-arquitetura-de-arquivos)
15. [Migração do Sistema Atual](#15-migração-do-sistema-atual)
16. [Ordem de Implementação](#16-ordem-de-implementação)

---

## 1. Visão Geral

### Estado Atual

O sistema Gabinete Carol possui 12 agentes IA independentes, cada um com seu próprio system prompt, sem memória compartilhada, sem proatividade e sem contexto cross-módulo. A ALIA é 100% reativa e opera apenas via Gemini 2.5 Flash.

### Estado Desejado

ALIA como assessora legislativa verdadeiramente abrangente:
- **Orquestradora central** — Uma identidade, múltiplas especializações
- **Proativa** — Monitora, detecta e avisa antes de ser perguntada
- **Memória completa** — Lembra preferências, decisões, relações e padrões
- **Todos os canais** — WhatsApp + Dashboard + Email, formato adaptado
- **Multi-provider** — Gemini (rotina), Claude (complexo), Groq (transcrição)
- **RAG jurídico definitivo** — Fundamentação legal indiscutível

### Arquitetura Macro

```
         ENTRADA (qualquer canal)
              ↓
    ┌─────────────────────┐
    │   ALIA GATEWAY      │  Normaliza input de qualquer canal
    │   (Canal Adapters)  │  para formato unificado
    └────────┬────────────┘
             ↓
    ┌─────────────────────┐
    │   ALIA BRAIN        │  Decide: qual agente, qual modelo,
    │   (Orchestrator)    │  injeta memória + contexto cross-módulo
    └────────┬────────────┘
             ↓
    ┌─────────────────────┐
    │   ALIA AGENTS       │  Executa tarefa especializada
    │   (Executor Pool)   │  e devolve resultado
    └────────┬────────────┘
             ↓
    ┌─────────────────────┐
    │   ALIA GATEWAY      │  Formata resposta pro canal de origem
    │   (Response Adapt.) │  + renderiza no modo escolhido
    └─────────────────────┘
```

Paralelamente, o **Proactive Engine** monitora continuamente o sistema e despacha alertas.

---

## 2. Camada 1 — ALIA Memory

### Problema
- Memória atual: `Map<string, {messages, lastAccess}>` in-memory com TTL 3 dias
- Perde tudo no redeploy
- Sem aprendizado entre conversas

### Solução

Tabela `alia_memory` no Supabase com 4 tipos de memória:

| Tipo | Armazena | Decay |
|------|----------|-------|
| `preference` | Como o usuário gosta de interagir | Nunca expira |
| `decision` | Decisões tomadas sobre matérias/ações | Expira quando matéria é arquivada |
| `relation` | Relações e histórico com autoridades | Atualiza a cada interação |
| `pattern` | Padrões aprendidos do gabinete | Reforça com repetição, decay 90d |

### Schema

```sql
CREATE TABLE alia_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL REFERENCES gabinetes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('preference','decision','relation','pattern')),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  source_module TEXT,
  source_ref TEXT,
  embedding VECTOR(768),
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Módulo `src/lib/alia/memory.ts`

Funções:
- `remember(gabineteId, tipo, subject, content, opts?)` — salva memória
- `recall(gabineteId, query, opts?)` — busca semântica
- `recallBySubject(gabineteId, subject)` — busca exata
- `forget(gabineteId, memoryId)` — remove
- `decay()` — cron: reduz confidence de memórias não acessadas
- `reinforce(memoryId)` — acesso reforça confidence

### Fluxo

1. Cada interação → `recall()` busca memórias relevantes antes de responder
2. Memórias relevantes (confidence > 0.5) injetadas no system prompt
3. Após resposta, ALIA decide se algo vale memorizar → `remember()`
4. Cron diário `decay()` — reduz confidence de não acessadas
5. Confidence < 0.2 → soft delete

### Distinção RAG vs Memory

- `alia_knowledge` (RAG) = conhecimento **estático** (leis, protocolos, autoridades)
- `alia_memory` = conhecimento **dinâmico** (aprendizado, decisões, relações)
- Ambos injetados no prompt com labels distintos: `[CONHECIMENTO]` vs `[MEMÓRIA]`

---

## 3. Camada 1.1 — CADIN Sentinel

### Problema
- Autoridades mudam de cargo e CADIN fica desatualizado
- Gabinete só descobre quando tenta contato

### Solução

Motor de vigilância que varre Diários Oficiais diariamente.

### Fontes

| Fonte | Escopo | Método |
|-------|--------|--------|
| DOERR (Estado RR) | Secretários estaduais, autarquias | PDF parse |
| DOMBV (Município BV) | Secretários municipais, diretores | PDF parse |
| DOU (União) | Ministros, superintendentes federais | API REST INLABS |
| DJE-RR (Justiça) | Desembargadores, juízes, promotores | Web scrape |
| TSE | Mudanças partidárias | API/RSS |

### Arquitetura: 3 camadas

```
Coleta (scrapers) → Análise (Gemini) → Ação (pending_updates)
```

**Coleta:** Interface `DiarioCollector` por fonte. Cada coletor busca e extrai texto do diário do dia.

**Análise:** Gemini analisa em 2 passadas:
1. Passada ampla: extrai TODAS as nomeações/exonerações
2. Passada focada: cruza com 415+ autoridades do CADIN

**Saída:** `AuthorityChange` com tipo, nome, cargo anterior/novo, órgão, esfera, data_efeito, trecho_original, confidence.

**Regra de ouro: NUNCA altera CADIN direto — cria `cadin_pending_updates` para curadoria humana.**

### Cron: Diário às 06:00

```
06:00 → Coleta dos 5 diários
06:15 → Gemini analisa e cruza com CADIN
06:20 → Gera pending_updates + sugestões
06:25 → Notifica assessores (WhatsApp + Dashboard + Email)
```

### Schema

```sql
CREATE TABLE cadin_sentinel_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  source TEXT NOT NULL,
  date_checked DATE NOT NULL,
  entries_found INT DEFAULT 0,
  changes_detected INT DEFAULT 0,
  new_suggestions INT DEFAULT 0,
  raw_log JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Resiliência

- Diário não publicado (feriado): log registra, sem alerta
- PDF corrompido: salva raw, alerta "revisão manual"
- API fora: retry 3x com backoff, fallback scrape
- Match ambíguo (confidence < 0.8): humano decide

---

## 4. Camada 1.1.1 — Janela de Curadoria

### Regra: NADA muda no CADIN sem aprovação humana

O Sentinel detecta e sugere. O assessor decide e aplica.

### Interface

Card por mudança detectada mostrando:
- Tipo (exoneração, nomeação, posse, etc.)
- Fonte e data do diário
- Dados atuais vs. dados novos
- Trecho exato do diário (prova documental)
- Botões: Aprovar / Editar antes de aprovar / Rejeitar

Para novas autoridades: Cadastrar / Vincular a existente / Ignorar

### Schema

```sql
CREATE TABLE cadin_pending_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  person_id UUID REFERENCES cadin_persons(id),
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nomeacao','exoneracao','posse','substituicao',
    'aposentadoria','novo_cadastro','importacao_novo',
    'importacao_atualiza','importacao_ambiguo'
  )),
  campo TEXT,
  valor_atual TEXT,
  valor_novo TEXT,
  fonte TEXT NOT NULL,
  fonte_url TEXT,
  fonte_data DATE NOT NULL,
  trecho_original TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  status TEXT DEFAULT 'pendente' CHECK (status IN (
    'pendente','aprovado','rejeitado','editado'
  )),
  revisado_por UUID REFERENCES profiles(id),
  revisado_em TIMESTAMPTZ,
  notas_revisao TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Regras de negócio

- Prazo: pendências não revisadas em 7 dias → lembrete WhatsApp
- Nunca auto-aprova (mesmo confidence 0.99)
- Auditoria completa: quem, quando, com qual nota
- Trecho do diário sempre visível como prova
- Editar antes de aprovar para corrigir erros do diário
- Vincular existente para evitar duplicatas
- Histórico preservado: cargo anterior vai para `cadin_history`

---

## 5. Camada 1.2 — CADIN Ingestor

### Problema
- Cada órgão publica cadernos de autoridades em PDF/DOCX
- Cadastrar 100+ autoridades é manual

### Solução

Agente que recebe PDF/DOCX, extrai estruturadamente com Claude, mapeia para template CADIN, gera fila de curadoria.

### 3 estágios

**Estágio 1 — Extração de texto:**
- PDF com texto: `pdf-parse`
- PDF scanneado: Gemini Vision OCR
- DOCX: `mammoth` + `cheerio` para tabelas

**Estágio 2 — Análise (Claude):**
- Classificação do documento
- Extração por chunks de 3-5 páginas
- Desabreviação de cargos (Sec. Adj. → Secretário Adjunto)
- Deduplicação com CADIN existente
- Confidence por campo

**Estágio 3 — Fila de curadoria:**
Reutiliza a mesma janela da Seção 1.1.1 com tipos: `importacao_novo`, `importacao_atualiza`, `importacao_ambiguo`.

### Template CADIN (campos-alvo)

```typescript
interface CadinIngestRecord {
  nome: string;
  nome_social?: string;
  cargo: string;
  orgao: string;
  esfera: 'municipal' | 'estadual' | 'federal' | 'judiciario' | 'legislativo';
  tipo: 'titular' | 'adjunto' | 'interino' | 'substituto';
  telefone_orgao?: string;
  telefone_pessoal?: string;
  email_institucional?: string;
  email_pessoal?: string;
  endereco_orgao?: string;
  partido?: string;
  data_nomeacao?: string;
  data_nascimento?: string;
  confidence: number;
  trecho_original: string;
  pagina?: number;
  notas_extracao?: string;
}
```

### Processamento por tamanho

- < 20 páginas: síncrono
- 20-100 páginas: background job, notifica quando pronto
- > 100 páginas: divide em batches de 20, paralelo, consolida

### Schema

```sql
CREATE TABLE cadin_ingest_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  esfera TEXT,
  status TEXT DEFAULT 'processando' CHECK (status IN (
    'processando','concluido','erro','parcial'
  )),
  total_pages INT,
  pages_processed INT DEFAULT 0,
  records_found INT DEFAULT 0,
  records_new INT DEFAULT 0,
  records_update INT DEFAULT 0,
  records_ambiguous INT DEFAULT 0,
  error_log TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

---

## 6. Camada 2 — ALIA Brain (Orquestrador Central)

### Problema
- 12 agentes com rotas independentes
- Webhook WhatsApp com 1810 linhas
- Router atual só faz keyword matching
- Sem decisão de modelo

### Arquitetura: 3 sub-camadas

### 6.1 — Gateway (`src/lib/alia/gateway.ts`)

Normaliza qualquer entrada para formato único:

```typescript
interface AliaRequest {
  channel: 'whatsapp' | 'dashboard' | 'email' | 'cron' | 'api';
  session_id: string;
  gabinete_id: string;
  sender: { phone?: string; profile_id?: string; email?: string; name: string; };
  content: { text: string; media?: MediaAttachment[]; };
  page_context?: string;
  timestamp: string;
  is_proactive: boolean;
}

interface AliaResponse {
  text: string;
  channel_format: { whatsapp?: string; dashboard?: string; email?: string; };
  actions?: AliaAction[];
  memories_created?: string[];
  agent_used: string;
  model_used: string;
}
```

**Adapters:**
- `adapters/whatsapp.ts` — Evolution API ↔ AliaRequest (~150 linhas vs. 1810 atual)
- `adapters/dashboard.ts` — Chat UI ↔ AliaRequest
- `adapters/email.ts` — IMAP ↔ AliaRequest
- `adapters/cron.ts` — Proativo ↔ AliaRequest

### 6.2 — Brain (`src/lib/alia/brain.ts`)

Processo principal:

```typescript
async function process(request: AliaRequest): Promise<AliaResponse> {
  const memories = await memory.recall(request.gabinete_id, request.content.text);
  const intents = await classifyIntent(request, memories);
  const plan = await planExecution(intents, request.channel);
  const results = await executeAgents(plan);
  const response = await synthesize(results, request, memories);
  await memory.maybeRemember(request, response);
  return formatForChannel(response, request.channel);
}
```

### Classificador de intenção

```typescript
type AgentType =
  | 'cadin' | 'parecer' | 'relator' | 'indicacao' | 'oficio'
  | 'pls' | 'agenda' | 'email' | 'sessao' | 'ordem_dia'
  | 'comissao' | 'general' | 'crossmodule';
```

Suporta **multi-intent**: "Quem é o secretário de obras e tem indicação pendente?" → `[cadin, indicacao]`

### Seletor de modelo por canal

| Canal | Classificador | Motivo |
|-------|--------------|--------|
| WhatsApp | Gemini Flash | Latência baixa |
| Dashboard | Gemini Flash | Rotina |
| Complexo detectado | Claude | Multi-intent, cross-módulo |
| Cron/Proativo | Nenhum | Rota pré-definida |

### Mapa de modelos por agente

| Agente | Default | Upgrade |
|--------|---------|---------|
| cadin, indicacao, agenda, oficio, ordem_dia, comissao, general | Gemini Flash | — |
| parecer, relator | Gemini Pro | Claude Sonnet |
| pls, crossmodule | Claude Sonnet | — |
| email | Gemini Flash | Claude Sonnet |
| sessao | Groq (transcrição) + Gemini Flash | — |

### 6.3 — Agent Pool (`src/lib/alia/agents/`)

Interface padrão que todo agente implementa:

```typescript
interface AliaAgent {
  name: AgentType;
  description: string;
  execute(params: {
    action: string;
    data: Record<string, any>;
    context: { memories: AliaMemory[]; ragResults: RagResult[]; crossModuleData?: any; };
    model: ModelConfig;
    gabineteId: string;
  }): Promise<AgentResult>;
}
```

### Cross-módulo

Quando Brain detecta `crossmodule`, busca dados de múltiplos módulos em paralelo:

```typescript
const [cadinData, indicacoes, pareceres, agenda, ordemDia] = await Promise.all([
  searchCadin(query, gabineteId),
  searchIndicacoes(query, gabineteId),
  searchPareceres(query, gabineteId),
  searchAgenda(query, gabineteId),
  searchOrdemDia(query, gabineteId),
]);
```

---

## 7. Camada 3 — ALIA Proactive Engine

### Problema
- ALIA 100% reativa
- Único proativo: cron de aniversários

### Arquitetura: 3 sub-camadas

```
WATCHERS (detectam) → EVALUATOR (decide) → DISPATCHER (entrega)
```

### 10 Watchers

| # | Watcher | Frequência | Eventos |
|---|---------|-----------|---------|
| 1 | sapl-watcher | 2h | materia_nova, ordem_dia_publicada, votacao_divergente |
| 2 | prazo-watcher | 6h | prazo_vencendo (D-7, D-3, D-1, D-0) |
| 3 | email-watcher | 30min | email_urgente, email_digest |
| 4 | aniversario-watcher | Diário 6h | aniversario (hoje + próx. 3 dias) |
| 5 | sentinel-watcher | Diário 6:30h | autoridade_mudou, cadin_curadoria |
| 6 | indicacao-watcher | 4h | indicacao_parada (>7d), indicacao_protocolar |
| 7 | sessao-watcher | Diário 18h | sessao_amanha |
| 8 | oficio-watcher | Semanal seg 8h | oficio_sem_resposta (>15d) |
| 9 | comissao-watcher | 6h | comissao_pendencia |
| 10 | agenda-watcher | 1h | compromisso próximo (D-1, H-2) |

### Tipos de evento

```typescript
type EventType =
  | 'prazo_vencendo' | 'materia_nova' | 'email_urgente'
  | 'aniversario' | 'autoridade_mudou' | 'indicacao_parada'
  | 'sessao_amanha' | 'ordem_dia_publicada' | 'oficio_sem_resposta'
  | 'comissao_pendencia' | 'votacao_divergente' | 'email_digest'
  | 'indicacao_protocolar' | 'cadin_curadoria';
```

### Evaluator — Regras

**Consolidação inteligente:**
- 5 aniversários no mesmo dia → 1 mensagem consolidada
- Sessão amanhã + ordem do dia publicada → combina
- Email urgente + remetente no CADIN → enriquece

**Anti-spam:**
- Cooldown 24h por tipo/assunto
- Horário comercial para urgência média/baixa (8h-18h)
- Máximo 15 alertas/dia por canal
- Configuração "não perturbar" por assessor

### Dispatcher — Formato por urgência/canal

| Urgência | WhatsApp | Dashboard | Email |
|----------|----------|-----------|-------|
| Crítica | Imediato | Badge vermelho + push | Email individual |
| Alta | Imediato | Badge laranja | Próximo digest |
| Média | Digest matinal | Badge amarelo | Digest matinal |
| Baixa | Digest matinal | Lista normal | Digest matinal |
| Informativa | Não envia | Lista cinza | Digest semanal |

### Digest Matinal (8h)

Briefing diário enviado em TODOS os canais com:
- Urgentes do dia
- Prazos vencendo
- Aniversários
- Emails pendentes
- Indicações para ação
- Sessão (se houver)

### Schemas

```sql
CREATE TABLE alia_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  recipient_id UUID REFERENCES profiles(id),
  type TEXT NOT NULL,
  urgency TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE alia_proactive_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_ref TEXT,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  consolidated_count INT DEFAULT 1,
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE alia_notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES profiles(id),
  channel TEXT NOT NULL,
  quiet_start TIME,
  quiet_end TIME,
  max_daily INT DEFAULT 15,
  digest_time TIME DEFAULT '08:00',
  enabled BOOLEAN DEFAULT true,
  event_types_muted TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 8. Camada 4 — ALIA Persona

### Problema
- 12 agentes com prompts independentes
- Tom inconsistente entre módulos
- Regras repetidas em múltiplos arquivos

### Solução

System prompt montado dinamicamente em 6 camadas:

```
Identidade Base (quem ela é, sempre)
+ Regras Invioláveis (valem para todos)
+ Especialização do Agente (o que sabe agora)
+ Registro do Canal (como fala agora)
+ Contexto de Memória (o que lembra)
+ Contexto Temporal (quando é agora)
```

### Módulo `src/lib/alia/persona.ts`

```typescript
function buildSystemPrompt(params: {
  agent: AgentType;
  channel: ChannelType;
  memories: AliaMemory[];
  gabineteConfig: GabineteConfig;
  currentDate: string;
}): string
```

### Identidade Base

ALIA é assessora parlamentar do gabinete, não chatbot genérico. Profissional e acolhedora, proativa, precisa, contextual, discreta. Nunca diz "como IA" ou "como modelo de linguagem".

### Regras Invioláveis

- NUNCA invente dados
- Votos VERBATIM (nunca inferir)
- Dados pessoais: só institucional em canais externos
- Sem opiniões políticas
- Sem ações irreversíveis sem confirmação
- Sempre em português brasileiro

### Especializações

13 especializações: cadin, parecer, relator, indicacao, pls, oficio, agenda, email, sessao, ordem_dia, comissao, crossmodule, general. Cada uma adiciona APENAS conhecimento específico sem repetir a base.

### Registros de canal

- WhatsApp: curto, emojis moderados, máx 3 parágrafos
- Dashboard: markdown rico, sem limite de tamanho
- Email: formal, sem emojis, com assinatura institucional
- Cron: formato alerta/briefing, objetivo
- Social Media: observadora, foco em demandas, respeito à privacidade

### Multi-tenant ready

```typescript
interface GabineteConfig {
  parlamentar_nome: string;
  casa_legislativa: string;
  sigla_casa: string;
  partido: string;
  alia_nome?: string;
  alia_tom?: 'formal' | 'equilibrado' | 'informal';
  comissoes_membro: string[];
  comissao_presidente?: string;
}
```

---

## 9. Camada 5.1 — Email Intelligence Agent

### Problema
- 5 contas IMAP sincronizadas, zero inteligência
- Sem categorização, sem vínculo com CADIN/matérias

### Solução: 3 funções

**1. Triagem automática (após cada sync):**
- Classifica urgência: critica, alta, media, baixa, spam
- Categoriza: intimacao_judicial, oficio_recebido, convite_evento, demanda_cidadao, comunicacao_sapl, etc.
- Resume em 1 frase
- Identifica se requer ação e prazo implícito

**2. Enriquecimento cross-módulo:**
- Cruza remetente com CADIN (identifica autoridade)
- Vincula a matérias/indicações quando relevante
- Consulta memória para histórico de interações

**3. Ações sugeridas:**
- `draft_reply` — rascunho de resposta
- `forward` — sugestão de encaminhamento
- `archive` — arquivar (spam/irrelevante)
- `create_indicacao` — criar indicação a partir do email
- `link_materia` — vincular a matéria legislativa
- `alert_assessor` — alertar sobre urgência
- `schedule_event` — adicionar prazo/evento na agenda

### Schema

```sql
CREATE TABLE email_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id UUID NOT NULL,
  email_id UUID NOT NULL REFERENCES agenda_emails(id),
  urgency TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  requires_action BOOLEAN DEFAULT false,
  action_deadline TIMESTAMPTZ,
  sentiment TEXT,
  cadin_person_id UUID REFERENCES cadin_persons(id),
  materia_id TEXT,
  indicacao_id UUID REFERENCES indicacoes(id),
  suggested_actions JSONB DEFAULT '[]',
  action_taken TEXT,
  action_taken_by UUID REFERENCES profiles(id),
  action_taken_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 10. Camada 5.2 — Comissões Agent

### Problema
- Sem inteligência na página de comissões
- WhatsApp sem tool para consultar comissões
- Sem monitoramento de prazos por comissão

### 5 capacidades

1. **Consulta composição e status** — membros, presidente, matérias pendentes
2. **Listar pendências** — matérias sem parecer, ordenadas por prazo
3. **Dashboard de métricas** — carga por relator, prazos vencidos
4. **Análise de matéria** — análise detalhada no contexto da comissão
5. **Relatório semanal/mensal** — automatizado, enviado segunda 9h

### Tools no WhatsApp

- `consultar_comissao` — composição + pendências + prazos
- `pendencias_comissao` — matérias sem parecer

### Cruzamento com pareceres

Verifica automaticamente se já existe parecer gerado, parecer do relator, e votos de outras comissões para cada matéria.

---

## 11. Camada 5.3 — Social Media Watcher

### Problema
- Demandas da população nas redes sociais não são capturadas

### Solução

Watcher que varre Instagram e Facebook buscando demandas.

### Fontes

| Rede | Método | Captura |
|------|--------|---------|
| Instagram | Meta Graph API (Business) | Menções, comentários, hashtags locais |
| Facebook | Meta Graph API (Page) | Comentários na página, menções |
| Fallback | Apify/Browserless | Se API não disponível |

### Classificação

Gemini Flash classifica: é demanda real? Tipo de problema? Bairro? Urgência? Sentimento?

Se confidence > 0.7 → gera pré-indicação para curadoria (nunca automática).

Deduplica: mesmo buraco reclamado por 10 pessoas = 1 indicação.

### Conectores plugáveis (multi-tenant)

```typescript
interface ExternalDemandConnector {
  name: string;
  enabled: boolean;
  fetchNewDemands(since: Date): Promise<ExternalDemand[]>;
  markAsProcessed(demandId: string): Promise<void>;
}
```

Fala Cidadão implementado como connector plugável via `gabinete_connectors`:
- Carol usa Fala Cidadão
- Outro gabinete usa Ouvidoria da Prefeitura
- Tudo via config, sem mudar código

---

## 12. Camada 6 — RAG Jurídico-Legislativo

### Problema
- Corpus RAG raso: poucas leis, jurisprudência vazia
- Pareceres sem fundamentação indiscutível

### Visão

Maior arcabouço jurídico-legislativo acessível instantaneamente. Cada afirmação com fonte primária.

### 4 camadas de conhecimento

#### Camada 1 — Núcleo obrigatório

| Documento | Estratégia | Prioridade |
|-----------|-----------|------------|
| Regimento Interno CMBV | 1 chunk por artigo | P0 |
| Lei Orgânica de Boa Vista | 1 chunk por artigo | P0 |
| Constituição Federal 1988 | 1 chunk por artigo | P0 |
| LC 95/1998 (técnica legislativa) | Integral | P0 |

**Chunking:** Artigo por artigo (não documento inteiro) para busca precisa e citação exata.

```typescript
interface LegalChunk {
  documento: string;
  tipo_norma: string;
  hierarquia: string;      // "Título III > Capítulo II > Seção IV"
  artigo: string;          // "Art. 45"
  dispositivo_completo: string;
  texto: string;
  tema_principal: string;
  temas_secundarios: string[];
  palavras_chave: string[];
  artigos_relacionados: string[];
  vigente: boolean;
  embedding: number[];
}
```

#### Camada 2 — Legislação estruturada

| Fonte | Conteúdo | Método |
|-------|----------|--------|
| LexML | Toda legislação brasileira | API REST |
| Planalto | Leis federais, LCs | Scrape seletivo |
| SAPL CMBV | Leis municipais BV (~2.000) | API SAPL |
| ALE-RR | Leis estaduais RR (~3.000) | Site/API |

**Ingestão seletiva por temas prioritários:** processo_legislativo, competencia_municipal, orcamento_publico, licitacoes, servidor_publico, urbanismo, saude, educacao, meio_ambiente, transporte, seguranca, direitos_humanos, acessibilidade, transparencia, etc.

#### Camada 3 — Jurisprudência e Súmulas

| Fonte | Conteúdo | Volume |
|-------|----------|--------|
| STF | Súmulas vinculantes, repercussão geral | ~60 SV + 736 súmulas + 1.300 temas |
| STJ | Súmulas, temas repetitivos | ~658 súmulas |
| TJRR | Jurisprudência estadual | ~50.000 (filtrado) |
| TSE | Decisões eleitorais | Seletivo |
| TCU | Acórdãos licitações/orçamento | Filtrado |
| TCE-RR | Decisões tribunal de contas estadual | Seletivo |

**Ingestão progressiva:**
- Fase 1 (deploy): Súmulas + teses fixadas (~2.800 chunks)
- Fase 2 (semana 2): Jurisprudência temática TJRR + TCU (~10.000 chunks)
- Fase 3 (mês 2): Acórdãos relevantes STF/STJ (~50.000 chunks)
- Fase 4 (contínuo): Novas decisões automaticamente

#### Camada 4 — Orçamento e Finanças

| Documento | Relevância |
|-----------|-----------|
| LC 101/2000 (LRF) | Todo parecer com impacto financeiro |
| LOA Boa Vista (anual) | Verificar dotação |
| LDO Boa Vista (anual) | Metas fiscais |
| PPA Boa Vista (quadrienal) | Planejamento médio prazo |
| Lei 4.320/64 | Classificação de despesas |

Mantém versões (LOA 2025 vs 2026), marca vigente, atualiza automaticamente.

### Motor de busca evoluído

```typescript
async function searchLegal(query: string, opts: LegalSearchOpts) {
  // 1. Busca semântica pgvector (threshold 0.55 para termos técnicos)
  const local = await searchLocal(query, { dominio, filters, threshold: 0.55 });
  
  // 2. Se local < 0.72 → busca em fontes oficiais
  if (local.maxSimilarity < 0.72) {
    const web = await searchOfficialSources(query, {
      sources: ['planalto.gov.br', 'stf.jus.br', 'stj.jus.br', 'lexml.gov.br', 'tjrr.jus.br']
    });
    // 3. Auto-ingestão: resultado web bom → ingere para futuras buscas
    if (web[0]?.confidence > 0.8) await autoIngest(web);
    return mergeResults(local, web);
  }
  return local;
}
```

**Auto-aprendizado:** Quando busca web encontra norma relevante não indexada, ingere automaticamente. Corpus cresce organicamente.

### Cron de atualização

| Frequência | Escopo |
|-----------|--------|
| Diário | Novas súmulas, temas repetitivos, vinculantes |
| Semanal | Jurisprudência TJRR, acórdãos TCU/TCE |
| Mensal | Varredura LexML por temas prioritários |
| Sob demanda | Auto-ingestão quando web > local |
| Anual | LOA, LDO novas |
| Quadrienal | PPA novo |

### Schema evoluído

```sql
ALTER TABLE alia_knowledge ADD COLUMN IF NOT EXISTS metadata_legal JSONB;

CREATE INDEX idx_alia_knowledge_legal ON alia_knowledge USING gin(metadata_legal);

-- metadata_legal exemplo:
-- {
--   "tipo_norma": "lei", "numero": "14133", "ano": 2021,
--   "esfera": "federal", "artigo": "Art. 75", "dispositivo": "Art. 75, II",
--   "hierarquia": "Capítulo V > Seção I",
--   "temas": ["licitacao", "dispensa"],
--   "tribunal": null, "vigente": true,
--   "fonte_url": "https://planalto.gov.br/..."
-- }
```

---

## 13. Camada 7 — Modos de Apresentação

### Conceito

Todo documento gerado pela ALIA é renderizado em 3 modos sem regerar — o completo é gerado uma vez, os modos são camadas de visibilidade.

### Os 3 modos

| Modo | Nome | Público-alvo | Páginas típicas |
|------|------|-------------|----------------|
| **Analítico** | Análise Completa | Assessor jurídico, arquivo, defesa | 8-15 |
| **Padrão** | Documento Institucional | Relator, comissão, SAPL | 3-5 |
| **Executivo** | Resumo Decisório | Vereadora, plenário, WhatsApp | 1-2 |

### Estrutura

```typescript
interface DocumentSection {
  id: string;
  title: string;
  content: string;
  visibility: 'executive' | 'standard' | 'analytical';
  sources?: DocumentSource[];
}

interface DocumentSource {
  type: 'legislacao' | 'jurisprudencia' | 'sumula' | 'sapl' | 'doutrina' | 'cadin';
  citation: string;
  full_reference: string;
  url?: string;
  visibility: 'executive' | 'standard' | 'analytical';
}
```

### Visibilidade

- `executive` → aparece em TODOS os modos
- `standard` → aparece no Padrão e Analítico
- `analytical` → aparece SOMENTE no Analítico

### Módulo `src/lib/alia/document-renderer.ts`

Filtra seções e fontes por modo. Gera DOCX/PDF com formatação adequada ao modo.

### Marcação na geração

ALIA gera documento completo (analítico) com marcações `[EXEC]`, `[STD]`, `[ANA]` por seção e `[EXEC-SRC]`, `[STD-SRC]`, `[ANA-SRC]` por fonte. Renderer extrai e filtra.

### WhatsApp

Sempre modo Executivo. Oferece outros: "padrão", "analítico", "docx".

### Aplicável a todos os documentos

Parecer, parecer relator, ofício, indicação, PLS, relatório de comissão.

### Exemplo: Modo Analítico

Inclui: relatório, fundamentação legal completa com links, constitucionalidade com súmulas/RE, legislação comparada, jurisprudência TJRR/STJ, impacto orçamentário detalhado (LOA/LDO/PPA), riscos, referências bibliográficas numeradas com URLs.

---

## 14. Arquitetura de Arquivos

```
src/lib/alia/
├── gateway.ts                    # Normalização entrada/saída
├── brain.ts                      # Orquestrador central
├── classifier.ts                 # Classificação de intenção
├── model-selector.ts             # Seleção de modelo
├── memory.ts                     # Memória persistente
├── persona.ts                    # Personalidade unificada
├── document-renderer.ts          # Renderização 3 modos
├── adapters/
│   ├── whatsapp.ts               # Evolution API adapter
│   ├── dashboard.ts              # Chat UI adapter
│   ├── email.ts                  # IMAP adapter
│   └── cron.ts                   # Proativo adapter
├── agents/
│   ├── agent.interface.ts        # Interface padrão
│   ├── cadin.agent.ts
│   ├── parecer.agent.ts
│   ├── relator.agent.ts
│   ├── indicacao.agent.ts
│   ├── oficio.agent.ts
│   ├── pls.agent.ts
│   ├── agenda.agent.ts
│   ├── email.agent.ts            # NOVO
│   ├── sessao.agent.ts
│   ├── ordem-dia.agent.ts
│   ├── comissao.agent.ts         # NOVO
│   ├── crossmodule.agent.ts      # NOVO
│   └── general.agent.ts
├── proactive/
│   ├── scheduler.ts              # Orquestra watchers
│   ├── evaluator.ts              # Decide urgência
│   ├── dispatcher.ts             # Entrega nos canais
│   ├── digest.ts                 # Briefing matinal
│   ├── watchers/
│   │   ├── watcher.interface.ts
│   │   ├── sapl-watcher.ts
│   │   ├── prazo-watcher.ts
│   │   ├── email-watcher.ts
│   │   ├── aniversario-watcher.ts
│   │   ├── sentinel-watcher.ts
│   │   ├── indicacao-watcher.ts
│   │   ├── sessao-watcher.ts
│   │   ├── oficio-watcher.ts
│   │   ├── comissao-watcher.ts
│   │   ├── agenda-watcher.ts
│   │   └── social-watcher.ts     # NOVO
│   └── templates/
│       ├── digest-whatsapp.ts
│       ├── digest-email.ts
│       └── digest-dashboard.ts
├── sentinel/
│   ├── collectors/
│   │   ├── collector.interface.ts
│   │   ├── dou-collector.ts
│   │   ├── doerr-collector.ts
│   │   ├── dombv-collector.ts
│   │   ├── dje-collector.ts
│   │   └── tse-collector.ts
│   ├── analyzer.ts
│   └── updater.ts
├── cadin-ingestor.ts
├── connectors/
│   ├── connector.interface.ts
│   └── fala-cidadao.connector.ts
├── rag/
│   ├── rag.ts                    # Core (evolui)
│   ├── legal-search.ts           # Busca jurídica especializada
│   ├── legal-ingestor.ts         # Pipeline ingestão legal
│   ├── legal-chunker.ts          # Parser artigos/dispositivos
│   ├── auto-ingest.ts            # Auto-aprendizado web→local
│   ├── sources/
│   │   ├── source.interface.ts
│   │   ├── lexml.source.ts
│   │   ├── planalto.source.ts
│   │   ├── sapl.source.ts
│   │   ├── alerr.source.ts
│   │   ├── stf.source.ts
│   │   ├── stj.source.ts
│   │   ├── tjrr.source.ts
│   │   ├── tse.source.ts
│   │   ├── tcu.source.ts
│   │   ├── tcerr.source.ts
│   │   └── transparencia.source.ts
│   └── cron/
│       ├── daily-legal-sync.ts
│       ├── weekly-legal-sync.ts
│       └── monthly-legal-sync.ts
└── router.ts                     # Router existente (evolui)
```

---

## 15. Migração do Sistema Atual

| Arquivo atual | Destino | Mudança |
|---------------|---------|---------|
| `api/alia/webhook/route.ts` (1810 linhas) | `adapters/whatsapp.ts` (~150 linhas) + `brain.ts` | Webhook vira adapter fino |
| `api/laia/chat/route.ts` | `adapters/dashboard.ts` + `brain.ts` | Chat usa mesmo Brain |
| `lib/alia/router.ts` | `classifier.ts` | Keyword → classificação IA |
| `lib/alia/rag.ts` | `rag/rag.ts` | Evolui, adiciona cross-módulo |
| `api/pareceres/gerar/route.ts` | `agents/parecer.agent.ts` | Lógica vai pro agent |
| `api/indicacoes/gerar-documento/route.ts` | `agents/indicacao.agent.ts` | Idem |
| `lib/parecer/prompts.ts` | `persona.ts` + `agents/parecer.agent.ts` | Unificação |
| System prompts espalhados | `persona.ts` base + cada `*.agent.ts` | Coerência |

---

## 16. Ordem de Implementação

**Abordagem: Incremental por camada** — cada etapa entrega valor e é fundação da próxima.

### Fase 1 — Fundação
1. `alia_memory` — Memória persistente (schema + módulo + integração)
2. `persona.ts` — Personalidade unificada (refatorar prompts)
3. `document-renderer.ts` — 3 modos de apresentação

### Fase 2 — Orquestração
4. `gateway.ts` + adapters — Normalização de canais
5. `brain.ts` + `classifier.ts` + `model-selector.ts` — Orquestrador central
6. Migrar agents para pool padronizado
7. Refatorar webhook WhatsApp (1810→150 linhas)

### Fase 3 — Agentes novos
8. `email.agent.ts` — Email Intelligence
9. `comissao.agent.ts` — Comissões com tools WhatsApp
10. `crossmodule.agent.ts` — Consultas cruzadas

### Fase 4 — Proatividade
11. Watchers (10 fontes)
12. Evaluator + regras anti-spam
13. Dispatcher + digest matinal
14. `social-watcher.ts` + conectores plugáveis

### Fase 5 — CADIN Intelligence
15. Sentinel (5 coletores de diários oficiais)
16. Janela de curadoria
17. CADIN Ingestor (PDF/DOCX → curadoria)

### Fase 6 — RAG Jurídico
18. Legal chunker + ingestor
19. Fontes P0: Regimento CMBV, LOM, CF/88, LC 95
20. Fontes P1: Súmulas STF/STJ, jurisprudência TJRR
21. Sources API (LexML, Planalto, STF, STJ, TCU)
22. Auto-aprendizado web→local
23. Crons de atualização
24. Fontes P2: Acórdãos filtrados + orçamento (LOA/LDO/PPA)
