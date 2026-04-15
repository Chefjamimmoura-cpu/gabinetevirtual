# COMUNICAÇÃO ENTRE IAs — Sessão 24/03/2026

## De: Antigravity (Google Gemini) → Para: Claude (Anthropic)
**Data:** 24/03/2026 02:06 BRT

---

## O QUE EU FIZ (Antigravity)

### Módulo ALIA Legislativo — Sprint 1 a 5 completo

#### 1. Migration Supabase (já aplicada)
- `supabase/migrations/025_pl_proposicoes.sql` — tabelas `pl_proposicoes` e `pl_historico_tramitacao`

#### 2. APIs criadas/reescritas — 10 rotas

| Rota | O que faz |
|---|---|
| `src/app/api/pls/pesquisar-similares/route.ts` | Agente Pesquisadora v2 — fontes SAPL + nacionais + internacionais |
| `src/app/api/pls/analise-juridica/route.ts` | Agente Jurídica v2 — checklist CF/88 com fundamentos legais |
| `src/app/api/pls/projetos-acessorios/route.ts` | Agente Estrategista v2 — PLs complementares ao tronco |
| `src/app/api/pls/redigir/route.ts` | Agente Redatora v2 — texto LC 95/1998, min 5 artigos, 16384 tokens |
| `src/app/api/pls/listar/route.ts` | Lista PLs internos |
| `src/app/api/pls/distribuicao-temas/route.ts` | Dados para gráfico temático |
| `src/app/api/pls/aprovar/route.ts` | Aprovação humana obrigatória (RN-01/02) |
| `src/app/api/pls/[id]/tramitacao/route.ts` | Histórico de tramitação |
| `src/app/api/pls/sincronizar-sapl/route.ts` | Sync SAPL REST → banco local + WhatsApp |
| `src/app/api/pls/gerar-docx/route.ts` | Gera DOCX oficial com cabeçalho CMBV |

#### 3. Wizard refatorado
- `src/app/(dashboard)/pls/components/pls-nova-proposicao.tsx` — 6 etapas reais com APIs ALIA
- Botão "Baixar DOCX" funcional nas Etapas 4 e 5

#### 4. Script de cron
- `scripts/cron-pl-monitoring.ts` — sincronização SAPL a cada 6h

#### 5. IMPORTANTE — Agentes são SEPARADOS da ALIA principal
Os 4 agentes do módulo legislativo (Pesquisadora, Jurídica, Estrategista, Redatora) são rotas API **independentes** com seus próprios `systemInstruction`, `temperature` e `maxOutputTokens`. A ALIA principal (`/api/alia/webhook/route.ts`) **NÃO FOI MODIFICADA** — seus parâmetros anti-delírio para pareceres continuam intactos.

---

## O QUE VOCÊ DEVE FAZER (Claude)

### 1. Variáveis de ambiente na VPS
Confirmar que estas variáveis existem no `.env` do container Docker:
```env
GEMINI_API_KEY=<chave Gemini já existente>
SYNC_SECRET=<gerar uma senha forte qualquer>
GABINETE_NOTIF_TELEFONE=5595XXXXXXXXX  # número para alertas WhatsApp de tramitação
```

### 2. Cron job no host da VPS
Configurar cron para sincronização SAPL a cada 6h:
```bash
# Rodar dentro do container ou via curl externo
0 */6 * * * curl -s -X POST http://localhost:3000/api/pls/sincronizar-sapl \
  -H "Content-Type: application/json" \
  -H "x-sync-secret: $SYNC_SECRET" \
  >> /var/log/pl-sync.log 2>&1
```

### 3. Supabase Storage bucket
Verificar se o bucket `gabinete_docs` existe no Supabase. Se não:
```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('gabinete_docs', 'gabinete_docs', true);
```

### 4. Rebuild do container
Após o pull do GitHub (`main` branch, commit `0f8ed1f`), fazer rebuild:
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### 5. NÃO MEXA NOS SEGUINTES ARQUIVOS (são da ALIA principal de pareceres):
- `/api/alia/webhook/route.ts`
- `/lib/alia/router.ts`
- `/lib/alia/rag.ts`
- `/lib/parecer/prompts.ts`
- `/lib/parecer/prompts-relator.ts`

---

## COMMITS NO GITHUB (branch main)

| Commit | Descrição |
|---|---|
| `f3644b5` | feat(pls): ALIA Legislativo completo Sprint 1-5 |
| `8a32a4d` | chore: remove vercel.json - deploy via Docker/Traefik |
| `0f8ed1f` | fix(pls): agentes v2 - REGRA ZERO especificidade temática |

---

## PENDÊNCIAS PARA PRÓXIMA SESSÃO
- [ ] Testar wizard com tema diferente (pets, transporte, etc.) — validar que não repete
- [ ] VPS: limpeza de disco (77% ocupada) — auditar projetos
- [x] Gráfico de barras temáticas no painel `/pls` — implementado Sprint 5.5
- [ ] Ajuste fino no DOCX (brasão municipal no cabeçalho)
- [x] Integrar PLs internos (`pl_proposicoes`) no dashboard — implementado Sprint 5.5
- [x] Bucket `gabinete_docs` criado no Supabase — Sprint 5.5
