# Plano de Contingência — Requisições Mínimas ao SAPL

**Data:** 31 de março de 2026
**Projeto:** Gabinete Carol
**Objetivo:** Reduzir ao mínimo absoluto as requisições ao SAPL sem comprometer funcionalidades críticas do projeto

---

## Cenários de Contingência

### Nível 0 — Operação Normal (atual)
> ~600 requests/semana | Nenhuma restrição da TI

Mantém o comportamento atual com todas as otimizações já implementadas.

### Nível 1 — Redução Moderada (~60% menos requests)
> ~240 requests/semana | API ainda acessível, mas precisa reduzir carga

### Nível 2 — Modo Sobrevivência (~90% menos requests)
> ~60 requests/semana | API com restrições severas

### Nível 3 — API Fechada (0 requests automáticos)
> 0 requests/semana | API bloqueada, funciona apenas com cache

---

## Nível 1 — Redução Moderada

### Mudanças no Cron

| Cron | Atual | Nível 1 | Economia |
|------|-------|---------|----------|
| Sync diário | 1×/dia (03:00) | 1×/dia (03:00) — sem mudança | 0% |
| PL monitoring | 4×/dia (a cada 6h) | **1×/dia (03:30)** | 75% |

### Mudanças no Código

1. **Unificar sync + PL monitoring** — rodar PL monitoring logo após o sync diário (03:30), aproveitando que o servidor já "acordou"

2. **Aumentar throttle entre requests** — de 300ms para 1000ms

3. **Desabilitar scraping HTML** — usar apenas dados do cache + PDF. Se o PDF não tem links, aceitar "pauta não disponível" em vez de fazer scraping

4. **Limitar enriquecimento interativo** — endpoints de listagem (PLs, indicações) retornam apenas dados do cache local, sem fallback ao SAPL em tempo real

### Implementação

```typescript
// vps_cron.sh — Nível 1
// Sync principal: mantém
CRONCMD_SYNC="0 3 * * * curl -s -X POST .../api/admin/sync-sapl ..."

// PL monitoring: 1×/dia em vez de 4×
CRONCMD_PL="30 3 * * * curl -s -X POST .../api/pls/sincronizar-sapl ..."
```

```typescript
// client.ts — aumentar throttle
const THROTTLE_MS = 1000; // era 300

// sync.ts — desabilitar HTML scraping
// Em fetchOrdemDiaMateriaIds: remover bloco de scraping HTML (linhas 271-295)
```

**Requests estimados:** ~240/semana

---

## Nível 2 — Modo Sobrevivência

### Mudanças Radicais

| Componente | Atual | Nível 2 |
|-----------|-------|---------|
| Sync diário | 1×/dia | **2×/semana** (seg e qui, dias de sessão) |
| PL monitoring | 4×/dia | **Desativado** — manual only |
| Enriquecimento de matérias | Automático no sync | **Sob demanda** — só quando usuário abre a matéria |
| PDFs de pauta | Download automático | **Desativado** — link direto ao SAPL |
| Scraping HTML | Fallback | **Desativado completamente** |
| Listagens interativas | Fallback ao SAPL | **Apenas cache local** |

### Implementação

```bash
# vps_cron.sh — Nível 2 (apenas seg e qui)
# Seg=1, Qui=4
CRONCMD_SYNC="0 3 * * 1,4 curl -s -X POST .../api/admin/sync-sapl ..."
# PL monitoring: REMOVIDO do cron
```

```typescript
// sync.ts — Nível 2
// 1. Não baixar PDFs (pular etapa extractMateriaIdsFromPdf)
// 2. Não enriquecer matérias automaticamente (pular lightEnrichMateria)
// 3. Apenas buscar lista de sessões e salvar no cache

export async function syncSaplMinimal(): Promise<SyncResult> {
  // Passo único: buscar sessões e salvar
  const { results: sessions } = await fetchRecentSessions(50);
  // Upsert sessões no cache (1 request ao SAPL)
  // NÃO processar PDFs
  // NÃO buscar matérias
  // Total: 1 request por execução
}
```

```typescript
// Enriquecimento sob demanda (quando usuário clica em "ver matéria")
// Em vez de enrichir no sync, enrichir no GET /api/pareceres/ordem-dia
export async function enrichOnDemand(materiaId: number) {
  // Verifica cache primeiro
  const cached = await getCachedMateria(materiaId);
  if (cached && cached.last_synced_at > oneDayAgo) return cached;
  // Só aí vai ao SAPL
  const materia = await fetchMateria(materiaId);
  const enriched = await lightEnrichMateria(materia);
  await upsertCache(enriched);
  return enriched;
}
```

**Requests estimados:** ~60/semana (2 syncs mínimos + enriquecimento sob demanda esporádico)

---

## Nível 3 — API Fechada (Modo Offline)

### Estratégia: Funcionar 100% com cache existente

| Funcionalidade | Comportamento Nível 3 |
|---------------|----------------------|
| Sessões / Ordem do Dia | Usa cache Supabase (última sync) |
| Matérias | Usa cache Supabase |
| Tramitações | **Congeladas** — último snapshot salvo |
| Pareceres IA | Gerados sobre dados cacheados |
| PL monitoring | **Desativado** |
| Novas sessões | **Input manual** via interface admin |
| Novos PLs | **Input manual** |

### Implementação — "Modo Offline SAPL"

```typescript
// lib/sapl/client.ts — adicionar flag global
export const SAPL_OFFLINE = process.env.SAPL_OFFLINE === 'true';

// Em toda função que faz request ao SAPL:
export async function fetchRecentSessions(pageSize = 100) {
  if (SAPL_OFFLINE) {
    // Retorna do cache local
    return getCachedSessoes() || { count: 0, results: [] };
  }
  // ... request normal
}
```

```env
# .env — ativar modo offline
SAPL_OFFLINE=true
```

### Funcionalidades mantidas sem API:
- Geração de pareceres (usa matérias já cacheadas)
- Consulta de histórico legislativo
- ALIA (assistente) — dados já indexados no RAG
- Agenda de sessões (já sincronizadas)
- Indicações e requerimentos (já no banco local)

### Funcionalidades degradadas:
- Novas sessões precisam ser cadastradas manualmente
- Tramitações ficam congeladas no último snapshot
- Novos PLs protocolados via SAPL web (não via sistema)

---

## Medidas Complementares (aplicáveis a qualquer nível)

### 1. Identificação formal das requisições
```typescript
// Adicionar headers de identificação em TODAS as requests
headers: {
  'User-Agent': 'GabineteCarol/2.0 (CMBV; +wonetechnology.cloud; contato@wonetechnology.cloud)',
  'X-Client-Id': 'gabinete-carol-cmbv',
  'X-Contact': 'cynthia@wonetechnology.cloud',
}
```

### 2. Respeitar Retry-After incondicional
```typescript
// Já implementado — garantir que NUNCA ignora 429/503
if (response.status === 429 || response.status === 503) {
  const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
  // Aumentar mínimo de 3s para 10s
  const delay = Math.max(retryAfter * 1000, 10_000 * (attempt + 1));
  await new Promise(r => setTimeout(r, delay));
}
```

### 3. Circuit breaker (proteção contra cascata)
```typescript
// Se 3 requests falharem com 429/503 em sequência: parar tudo por 5 minutos
let consecutiveFailures = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN = 5 * 60 * 1000; // 5 min

async function saplGetWithCircuitBreaker<T>(path: string, params = {}): Promise<T> {
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    throw new Error('[SAPL] Circuit breaker aberto — aguardando cooldown');
  }
  try {
    const result = await saplGet<T>(path, params);
    consecutiveFailures = 0;
    return result;
  } catch (err) {
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      setTimeout(() => { consecutiveFailures = 0; }, CIRCUIT_BREAKER_COOLDOWN);
    }
    throw err;
  }
}
```

### 4. Dashboard de monitoramento
Criar endpoint `/api/admin/sapl-health` que retorna:
- Último sync bem-sucedido
- Requests feitos nas últimas 24h (via sapl_sync_logs)
- Status do circuit breaker
- Idade do cache (quão desatualizado está)

---

## Plano de Comunicação com Interlegis

### Proposta para o Ismael levar ao Senado Federal:

1. **Registro formal de desenvolvedor** — solicitar que o Interlegis crie um programa de API keys para desenvolvedores credenciados, com rate limits definidos (ex: 1000 req/dia)

2. **Endpoint de webhook** — em vez de polling, o SAPL notificar sistemas externos quando há mudanças (nova sessão, nova tramitação). Isso eliminaria 100% dos crons.

3. **API v2 com bulk endpoints** — endpoint tipo `/api/sessao/sessaoplenaria/?ids=1,2,3` que retorna múltiplas sessões em 1 request (atualmente requer N requests)

4. **Cache headers** — SAPL retornar `ETag` e `Last-Modified` para permitir requests condicionais (`If-None-Match`) que retornam 304 sem transferir dados

### O que oferecemos em troca:
- Compartilhar nosso código de integração como referência open-source
- Documentar padrões de integração responsável para outros desenvolvedores
- Participar de grupo de trabalho de modernização da API do SAPL

---

## Matriz de Decisão Rápida

```
Situação                           → Nível
─────────────────────────────────    ─────
TI pede para reduzir tráfego      → Nível 1
SAPL retornando 429 frequente     → Nível 2
API bloqueada por IP              → Nível 3 (imediato)
Interlegis fecha APIs             → Nível 3 + comunicação
Interlegis cria API keys          → Nível 0 com key
```

---

## Ativação de Cada Nível

### Para ativar Nível 1:
```bash
# Editar crontab da VPS
crontab -e
# Mudar PL monitoring de "0 */6 * * *" para "30 3 * * *"
```

### Para ativar Nível 2:
```bash
# Editar crontab da VPS
crontab -e
# Mudar sync para "0 3 * * 1,4" (só seg e qui)
# Remover linha do PL monitoring
```

### Para ativar Nível 3:
```bash
# Na VPS, adicionar variável de ambiente
echo "SAPL_OFFLINE=true" >> /opt/gabinete-carol/.env
# Reiniciar o container
docker compose restart
# Remover todos os crons SAPL
crontab -e  # remover linhas sync-sapl e sincronizar-sapl
```

---

*Documento gerado em 31/03/2026 — Wone Technology*
*Atualizar conforme evolução da comunicação com Ismael e Interlegis*
