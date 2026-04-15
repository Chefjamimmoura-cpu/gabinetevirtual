# ALIA Autônoma — Orquestração de Pareceres via WhatsApp

**Data:** 2026-04-15
**Status:** Aprovado
**Escopo:** Evoluir a ALIA de chat passivo para orquestradora semi-autônoma de pareceres, com acionamento e notificação via WhatsApp.

---

## 1. Visão Geral

### Modelo de autonomia

**Semi-autônoma com aprovação humana.** A ALIA gera pareceres automaticamente quando acionada (via WhatsApp, cron ou dashboard), mas todos ficam como rascunho aguardando aprovação na aba ALIA do Painel de Pareceres (`PareceresModeracao`). Nenhum parecer é publicado sem revisão humana.

### Faseamento

| Fase | Entrega | Dependência | Risco |
|------|---------|-------------|-------|
| **1. Notificação proativa** | WhatsApp avisa quando ordem do dia é publicada ou matéria nova entra em comissão | QR Code escaneado [WHATSAPP-1] | Baixo — conecta peças existentes |
| **2. Consulta de matérias** | "Ementa do PLL 32?" via WhatsApp/chat → ficha técnica padronizada | Fase 1 (canal testado) | Baixo — agente + formatação |
| **3. Geração autônoma** | "Gera parecer da ordem do dia" → background → notifica quando pronto | Fase 2 (agente validado) | Médio — fila assíncrona + permissões |

Cada fase entrega valor isoladamente e valida o canal antes de aumentar a responsabilidade.

---

## 2. Arquitetura

### Camadas existentes estendidas (não recriadas)

```
┌─────────────────────────────────────────────────┐
│                  CANAIS DE ENTRADA               │
│  WhatsApp (Evolution) │ Dashboard │ Cron Jobs    │
└──────────┬──────────────────┬──────────┬────────┘
           │                  │          │
           ▼                  ▼          ▼
┌─────────────────────────────────────────────────┐
│              ALIA GATEWAY (existente)             │
│  Normaliza request → AliaRequest                 │
│                                                   │
│  ✚ NOVO: validação de role antes de ações         │
│    (gerar_pareceres requer assessor+)             │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              ALIA BRAIN (existente)               │
│  classify → recall → search → execute → respond  │
│                                                   │
│  ✚ NOVO: tarefas assíncronas via alia_task_queue  │
│    (resposta imediata + processamento background)  │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│           SISTEMA PROATIVO (existente)            │
│  10 watchers → evaluator → dispatcher             │
│                                                   │
│  ✚ NOVO: gabinete_alia_config define comportamento│
│    (só notificar vs notificar + gerar)             │
└─────────────────────────────────────────────────┘
```

### Princípio: zero infraestrutura nova

- Sem Redis, sem Bull, sem worker processes
- Fila assíncrona = tabela Supabase (`alia_task_queue`) processada por cron
- Notificações = dispatcher existente
- Permissões = permissions.ts existente + coluna nova em recipients

---

## 3. Modelo de Permissões

### Hierarquia de roles

```
superadmin
  └─ tudo + configurar_automacao (exclusivo)

vereador = assessor_senior
  └─ gerar_pareceres + gerenciar_whatsapp_recipients

assessor
  └─ gerar_pareceres + consultar + receber notificações

outros números cadastrados
  └─ consultar + receber notificações
```

### Duas camadas

**Camada 1 — Quem cadastra números WhatsApp (UI do painel):**
- Roles: `assessor_senior`, `vereador`, `superadmin`
- Nova permission em `permissions.ts`: `gerenciar_whatsapp_recipients`

**Camada 2 — O que cada número pode fazer (por ação):**

| Permissão | Quem pode ter | Fase |
|-----------|--------------|------|
| `receber_notificacoes` | todos os números cadastrados | 1 |
| `consultar_materias` | todos os números cadastrados | 2 |
| `gerar_pareceres` | assessor, vereador, superadmin | 3 |
| `configurar_automacao` | somente superadmin | 3 |

### Validação no Gateway

Antes de rotear para agentes que executam ações:

1. Identificar sender pelo número de telefone → buscar em `gabinete_whatsapp_recipients`
2. Resolver role do sender via `profiles` (se vinculado) ou `action_permissions` do recipient
3. Intent classificado como ação (gerar_parecer, configurar)? → verificar permissão
4. Sem permissão → responder educadamente: "Você não tem permissão para essa ação."

---

## 4. Fase 1 — Notificação Proativa

### Peças existentes

- `sapl-watcher` em `src/lib/alia/proactive/watchers/sapl-watcher.ts` — detecta ordem do dia + matérias novas
- `evaluator` em `src/lib/alia/proactive/evaluator.ts` — dedup, cooldown, anti-spam
- `dispatcher` em `src/lib/alia/proactive/dispatcher.ts` — envia WhatsApp + dashboard
- `sendWhatsAppMessage` em `src/lib/alia/adapters/whatsapp.ts` — envia texto via Evolution
- Cron `alia-proactive` em `src/app/api/cron/alia-proactive/route.ts` — orquestra watchers

### O que implementar

1. **Templates de mensagem enriquecida** no sapl-watcher:

   Ordem do dia:
   ```
   📋 Nova Ordem do Dia publicada
   Sessão: 15ª Ordinária (15/04/2026)
   Matérias: 5 (2 PLL, 2 REQ, 1 PLE)
   
   👉 Revise no painel: https://gabinete.wonetechnology.cloud/pareceres
   ```

   Matéria nova em comissão:
   ```
   🔔 Nova matéria na CASP
   PLL 42/2026 — Autor: Vereador Fulano
   Ementa: Dispõe sobre a criação do programa...
   
   👉 Painel de Relatoria: https://gabinete.wonetechnology.cloud/pareceres
   ```

2. **Event types** — garantir `ordem_dia_publicada` e `materia_nova` registrados no evaluator e nos `event_types_allowed` dos recipients.

3. **Frequência do cron** — a cada 2h em horário comercial (8h-18h horário de Boa Vista, UTC-4). 6 execuções/dia.

4. **Config do gabinete** — respeitar `gabinete_alia_config.notify_ordem_dia` e `notify_materia_comissao`.

### Bloqueante

QR Code do WhatsApp precisa ser escaneado primeiro [WHATSAPP-1].

---

## 5. Fase 2 — Consulta de Matérias

### Novo agente: `consulta_materia`

Localização: `src/lib/alia/agents/consulta_materia.ts`

**Responsabilidades:**
1. Parsear referência de matéria de texto livre
   - Direto: "PLL 32/2026", "PLE 5/2026"
   - Natural: "aquele projeto sobre escolas", "matéria do vereador fulano"
2. Buscar no SAPL via API (número/ano ou busca textual via RAG domínio `sapl`)
3. Formatar ficha técnica padronizada

### Ficha técnica (formato único WhatsApp + chat)

```
📄 PLL 32/2026
Autor: Vereador Fulano de Tal
Ementa: Dispõe sobre a criação do programa...

📊 Tramitação:
  • Entrada: 10/03/2026
  • Comissões: CLJRF (✅ Favorável), CASP (⏳ Pendente)
  • Procuradoria: ✅ Favorável

🔗 Ver no SAPL: https://sapl.boavista.rr.leg.br/materia/1234
```

### Classifier signals

Adicionar ao `classifier.ts` keywords para rotear ao agente:
- `"ementa"`, `"autor"`, `"autoria"`, `"PLL"`, `"PLE"`, `"REQ"`, `"IND"`, `"matéria"`, `"tramitação"`, `"consultar"`, `"qual projeto"`, `"sobre o que é"`

### Busca fuzzy

Quando não há número/ano explícito, usar RAG domínio `sapl` para busca semântica na ementa. Retornar top 3 resultados com opção de refinar.

### Permissão

Somente leitura — qualquer número cadastrado pode consultar. Não requer role especial.

---

## 6. Fase 3 — Geração Autônoma de Pareceres

### Tabela `alia_task_queue`

```sql
CREATE TABLE alia_task_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gabinete_id text NOT NULL,
  tipo text NOT NULL,            -- 'gerar_parecer_ordem_dia', 'gerar_parecer_comissao'
  payload jsonb NOT NULL,        -- { sessao_id, materia_ids[], modelo, solicitante_phone, solicitante_nome }
  status text NOT NULL DEFAULT 'pendente',  -- pendente → processando → concluido / erro
  resultado jsonb,               -- { parecer_ids[], total, resumo }
  erro text,                     -- mensagem de erro se falhar
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX idx_task_queue_status ON alia_task_queue(status, created_at);
```

### Tabela `gabinete_alia_config`

```sql
CREATE TABLE gabinete_alia_config (
  gabinete_id text PRIMARY KEY,
  auto_parecer_on_ordem_dia boolean DEFAULT false,
  notify_ordem_dia boolean DEFAULT true,
  notify_materia_comissao boolean DEFAULT true,
  parecer_model text DEFAULT 'flash',   -- 'flash' ou 'pro'
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
```

### Coluna nova em `gabinete_whatsapp_recipients`

```sql
ALTER TABLE gabinete_whatsapp_recipients
  ADD COLUMN action_permissions text[] DEFAULT ARRAY['receber_notificacoes', 'consultar_materias'];
```

### Endpoint `/api/alia/task/process`

Processador de tarefas chamado pelo cron:

1. `SELECT ... FROM alia_task_queue WHERE status = 'pendente' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`
2. Marca como `processando`, seta `started_at`
3. Para cada matéria no payload:
   - Reusa lógica de `enrichMateria` → Gemini → salva parecer como rascunho
4. Marca como `concluido`, seta `completed_at`, preenche `resultado`
5. Dispara notificação via dispatcher para o solicitante

### Fluxo: acionamento por WhatsApp

```
Cynthia: "ALIA, gera os pareceres da ordem do dia"

→ Webhook → Gateway → Permissão: vereador ✅
→ Classifier → intent: gerar_parecer_ordem_dia
→ Agente ordem_dia:
    1. Busca sessão mais recente com pauta publicada
    2. Extrai matérias do PDF da pauta
    3. INSERT INTO alia_task_queue (tipo, payload, ...)
→ Resposta imediata via WhatsApp:
    "✅ Entendido! Sessão 15ª Ordinária com 5 matérias.
     Gerando pareceres agora. Te aviso quando terminar.
     ⏱ Estimativa: 3-5 minutos."

[Cron ou next request processa a task queue]

→ Geração concluída → dispatcher:
    "📋 Pareceres prontos!
     Sessão: 15ª Ordinária (15/04/2026)
     5 pareceres gerados (3 Favorável, 1 Contrário, 1 Cautela)
     
     👉 Revise e aprove: https://gabinete.wonetechnology.cloud/pareceres"
```

### Fluxo: geração automática (config habilitada)

```
Cron alia-proactive → sapl-watcher detecta ordem do dia nova
→ Verifica gabinete_alia_config.auto_parecer_on_ordem_dia = true
→ INSERT INTO alia_task_queue automaticamente
→ Notifica: "Nova ordem do dia detectada. Gerando pareceres automaticamente..."
→ [Processamento em background]
→ Notifica quando concluído
```

### Tela de aprovação

`PareceresModeracao` já funciona. Ajustes mínimos:
- Exibir "Solicitado por: Cynthia via WhatsApp" no card do parecer
- Exibir timestamps: solicitação → início processamento → conclusão
- Manter chain-of-thought e botões Aprovar/Rejeitar como estão

---

## 7. UI — Configuração da ALIA (somente superadmin)

Nova seção no painel de administração ou nas configurações do gabinete:

```
Configurações da ALIA
─────────────────────
Notificações WhatsApp
  ☑ Notificar quando Ordem do Dia for publicada
  ☑ Notificar quando matéria nova entrar em comissão

Automação de Pareceres
  ☐ Gerar pareceres automaticamente quando Ordem do Dia for detectada
  Modelo preferido: [Flash ▾]  (Flash = rápido, Pro = detalhado)

Recipients WhatsApp              [Gerenciar →]
  3 números cadastrados, 2 com permissão de gerar pareceres
```

Visível apenas para `superadmin`. Salva em `gabinete_alia_config`.

---

## 8. O que NÃO muda

- **PareceresModeracao** — já funciona como tela de aprovação de pareceres ALIA
- **pareceres-alert-cards** — já mostra notificações na dashboard
- **Pipeline de geração** — `/api/pareceres/gerar` é reusado pela task queue
- **Brain/Classifier/Gateway** — estendidos com validação de role, não reescritos
- **Evaluator/Dispatcher** — já fazem dedup, cooldown, anti-spam e envio multi-canal
- **RAG e Memory** — continuam funcionando como base de conhecimento

---

## 9. Migration única

Uma migration cobre as 3 fases:

```sql
-- gabinete_alia_config
CREATE TABLE IF NOT EXISTS gabinete_alia_config ( ... );

-- alia_task_queue
CREATE TABLE IF NOT EXISTS alia_task_queue ( ... );

-- action_permissions em recipients
ALTER TABLE gabinete_whatsapp_recipients
  ADD COLUMN IF NOT EXISTS action_permissions text[]
  DEFAULT ARRAY['receber_notificacoes', 'consultar_materias'];
```

---

## 10. Critérios de sucesso

| Fase | Critério |
|------|----------|
| 1 | Cynthia recebe WhatsApp quando ordem do dia é publicada no SAPL |
| 1 | Badge na dashboard aparece simultaneamente |
| 2 | "Ementa do PLL 32/2026" via WhatsApp retorna ficha técnica em <5s |
| 2 | Busca fuzzy "projeto sobre escolas" retorna top 3 resultados |
| 3 | "Gera parecer da ordem do dia" cria tarefa e responde em <3s |
| 3 | Pareceres aparecem na aba ALIA do painel como rascunho |
| 3 | WhatsApp notifica quando geração conclui |
| 3 | Usuário sem permissão recebe mensagem educada de negação |
