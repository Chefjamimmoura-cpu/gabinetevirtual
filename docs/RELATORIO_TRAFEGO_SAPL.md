# Relatório de Tráfego — Gabinete Carol × SAPL Boa Vista

**Data:** 31 de março de 2026
**Preparado por:** Equipe Técnica — Wone Technology
**Destinatário:** Ismael — Diretor de TI, Câmara Municipal de Boa Vista
**Sistema:** Gabinete Carol (gabinete.wonetechnology.cloud)
**SAPL alvo:** sapl.boavista.rr.leg.br

---

## 1. Visão Geral do Sistema

O **Gabinete Carol** é um sistema de apoio ao mandato parlamentar da Vereadora Carol Dantas (CMBV). Ele consome a API REST pública do SAPL para:

- Espelhar sessões plenárias e matérias legislativas em cache local (Supabase)
- Monitorar tramitação de Projetos de Lei de interesse do gabinete
- Gerar pareceres automatizados para comissões usando IA (Gemini)
- Indexar dados legislativos para consulta via assistente virtual (ALIA)

**O sistema NÃO modifica dados no SAPL** — apenas leitura (GET requests). A única exceção é o protocolamento de proposições via POST, que é uma funcionalidade rara e manual.

---

## 2. Fontes de Tráfego (Automatizadas)

### 2.1 Cron Diário — Sync Principal (03:00 UTC)
| Item | Detalhe |
|------|---------|
| **Horário** | 03:00 UTC (23:00 Boa Vista) — fora do horário comercial |
| **Frequência** | 1× por dia |
| **Endpoint chamado** | `POST /api/admin/sync-sapl` |
| **Duração típica** | ~41 segundos (medido em teste real) |
| **Timeout máximo** | 5 minutos |

**Requisições por execução (estimativa baseada no código):**

| Etapa | Endpoint SAPL | Requests | Obs |
|-------|--------------|----------|-----|
| Buscar sessões do ano | `/api/sessao/sessaoplenaria/` | 1 | page_size=100, 1 página |
| Download PDFs de pauta | `upload_pauta` (URLs relativas) | 0–20 | Só pendentes, máx 20/execução |
| Buscar matérias novas | `/api/materia/materialegislativa/{id}/` | 0–52 | Só matérias não cacheadas |
| Resolver tipo da matéria | `/api/materia/tipomaterialegislativa/` | 1 | Cacheado em memória após 1ª call |
| Resolver autorias | `/api/materia/autoria/` + `/api/base/autor/{id}/` | 0–104 | 2 calls por matéria nova (autoria + autor) |
| **TOTAL POR EXECUÇÃO** | | **~22–178** | Depende de matérias novas |

**Cenário típico semanal (sem sessões novas):** ~22 requests/dia × 7 = **~154 requests/semana**
**Cenário com sessões novas (2 sessões/semana):** ~120 requests/dia nos dias com novidade = **~394 requests/semana**

### 2.2 Cron 6h — Monitoramento de PLs
| Item | Detalhe |
|------|---------|
| **Horário** | A cada 6 horas (00:00, 06:00, 12:00, 18:00 UTC) |
| **Frequência** | 4× por dia |
| **Endpoint chamado** | `POST /api/pls/sincronizar-sapl` |

**Requisições por execução:**

| Etapa | Endpoint SAPL | Requests | Obs |
|-------|--------------|----------|-----|
| Buscar tramitações de cada PL ativo | `/api/materia/tramitacao/?materia={id}` | N | N = PLs com status TRAMITANDO/COMISSAO |
| **Pausa entre requests** | — | — | 500ms entre cada PL |
| **TOTAL POR EXECUÇÃO** | | **N** (tipicamente 3–10) | Depende de PLs ativos |

**Cenário típico semanal:** ~7 PLs × 4 execuções/dia × 7 dias = **~196 requests/semana**

---

## 3. Fontes de Tráfego (Interativas — sob demanda)

Estas requisições ocorrem **apenas quando um usuário do gabinete acessa uma funcionalidade específica no sistema**. Não são automatizadas.

| Funcionalidade | Endpoints SAPL | Requests estimados | Frequência |
|---------------|---------------|-------------------|------------|
| Ver ordem do dia | Cache local → 0 requests SAPL | 0 (usa cache) | Diário |
| Listar PLs do gabinete | `/api/materia/materialegislativa/` | 1–3 | 2–5×/dia |
| Listar indicações | `/api/materia/materialegislativa/` | 1–3 | 1–2×/dia |
| Ver tramitação de 1 PL | `/api/materia/tramitacao/` | 1 | 2–5×/dia |
| PLs em comissão | `/api/materia/materialegislativa/` + enriquecimento | 5–30 | 1–2×/dia |
| Sync membros comissão | `/api/comissoes/` + `/api/parlamentar/` | 3–5 | Raro (1×/mês) |
| Protocolar proposição | POST `/api/materia/proposicao/` | 1 | Raro (1–2×/mês) |
| Ingestão RAG (ALIA) | Múltiplos endpoints | 20–50 | Raro (manual) |

**Estimativa interativa semanal:** **~70–200 requests/semana**

---

## 4. Resumo Consolidado — Tráfego Semanal

| Fonte | Requests/semana | % do total |
|-------|----------------|------------|
| Cron diário (sync) | 154–394 | 35–45% |
| Cron 6h (PL monitoring) | 196 | 25–35% |
| Uso interativo | 70–200 | 15–25% |
| **TOTAL** | **420–790** | **100%** |

### Volume de dados estimado

| Tipo | Tamanho típico | Quantidade/semana | Total/semana |
|------|---------------|-------------------|-------------|
| Resposta JSON (sessões) | ~5–15 KB | 7 | ~70–105 KB |
| Resposta JSON (matérias) | ~2–5 KB | 50–200 | ~100–1.000 KB |
| Resposta JSON (tramitações) | ~1–3 KB | 30–50 | ~30–150 KB |
| Resposta JSON (autorias/tipos) | ~0.5–2 KB | 50–100 | ~25–200 KB |
| PDFs de pauta | ~50–500 KB | 0–6 | ~0–3.000 KB |
| Páginas HTML (scraping fallback) | ~30–80 KB | 0–4 | ~0–320 KB |
| **TOTAL ESTIMADO** | | | **~225 KB – 4.8 MB/semana** |

---

## 5. Perfil de Horário das Requisições

```
UTC   BV(UTC-4)  Fonte                        Requests
────  ─────────  ──────────────────────────    ────────
03:00  23:00     Cron sync diário              22–178
06:00  02:00     Cron PL monitoring            3–10
12:00  08:00     Cron PL monitoring            3–10
12:00–22:00      Uso interativo (expediente)   10–30
18:00  14:00     Cron PL monitoring            3–10
00:00  20:00     Cron PL monitoring            3–10
```

**Pico máximo:** 03:00 UTC (23:00 BV) — fora do expediente, com throttling de 300ms entre batches.

---

## 6. Medidas de Proteção Já Implementadas

| Medida | Implementação |
|--------|--------------|
| **Cache local completo** | Sessões e matérias em Supabase — frontend nunca toca o SAPL |
| **Rate limiting client-side** | 300ms entre batches de matérias, 500ms entre PLs |
| **Retry com backoff** | HTTP 429/503 → espera Retry-After ou backoff exponencial (3s, 6s, 9s) |
| **Timeout por request** | 15s para API, 30s para PDFs, 10s para HTML |
| **Max retries** | 2 tentativas por request |
| **Paginação limitada** | Máx 10 páginas, 100 items/página |
| **PDFs limitados** | Máx 20 PDFs processados por execução de cron |
| **User-Agent identificado** | `Mozilla/5.0 CMBV-Gabinete/2.0` (identificável nos logs do SAPL) |
| **Horário off-peak** | Cron principal roda às 23h horário local |
| **Sync incremental** | Só busca matérias que ainda não estão no cache |

---

## 7. Comparação com Uso Manual Equivalente

Para contextualizar: se a equipe do gabinete fizesse manualmente o que o sistema automatiza, um navegador geraria **muito mais tráfego** por sessão:

| Ação manual no navegador | Requests gerados |
|--------------------------|-----------------|
| Abrir 1 página do SAPL | 15–30 (HTML + CSS + JS + imagens + fontes) |
| Navegar 10 matérias | 150–300 requests |
| Abrir 5 PDFs | 5–10 requests + 2–5 MB |
| **1 hora de uso manual** | **~500–1.000 requests** |

**O sistema automatizado gera em 1 semana o que 1 hora de uso manual no navegador geraria.**

---

## 8. Conclusão

O Gabinete Carol é um **consumidor leve e responsável** da API do SAPL:
- **< 800 requests/semana** (média ~600)
- **< 5 MB/semana** de dados transferidos
- Todas as requisições são GET (somente leitura)
- Cron principal roda fora do horário de expediente
- Cache local evita requisições redundantes
- Rate limiting e backoff implementados

Estamos à disposição para:
1. Ajustar horários de sync conforme orientação da TI
2. Reduzir frequência de monitoramento de PLs
3. Implementar qualquer header ou token de identificação solicitado
4. Compartilhar logs detalhados de acesso sob demanda

---

*Documento gerado em 31/03/2026 — Wone Technology*
