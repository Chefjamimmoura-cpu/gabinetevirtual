# Auditoria de Segurança — Gabinete Carol / CMBV

**Data:** 2026-04-10
**Executor:** Agente `security-auditor` (metodologia 10 níveis)
**Escopo:** Workspace completo `c:\Dev\Cynthia\Gabinetecarol\`
**Snapshot de rollback disponível:** ID 244018 VPS 1305188, válido até 2026-04-30

---

## Sumário executivo

| # | Nível | Status inicial | Ações aplicadas |
|---|---|---|---|
| 1 | Segredos expostos | FALHOU — 5 segredos | 3 corrigidos no código (env vars). 2 dependem de revogação manual na Google Cloud Console + myaccount.google.com |
| 2 | Autenticação e controle de acesso | FALHOU — ~70 rotas sem auth | 10 rotas P0 protegidas com `requireAuth`. Restam ~60 em P1 |
| 3 | Banco de dados e RLS | ATENÇÃO — SERVICE_ROLE_KEY em todas rotas | Mantido (P2 — refatoração) |
| 4 | IDOR multi-tenant | FALHOU — CADIN persons sem filtro | Corrigido — `.eq('gabinete_id')` em PATCH, DELETE e GET |
| 5 | Lógica sensível no servidor | ATENÇÃO | Sem mudança (P1 — fix `/api/gemini` no cmbv-parecer) |
| 6 | Rate limiting | ATENÇÃO — só 4 rotas | Sem mudança (P2) |
| 7 | Webhooks e integrações | ATENÇÃO | Sem mudança (P1) |
| 8 | LGPD | FALHOU | Sem mudança (P1 — política, consentimento, exclusão) |
| 9 | Dependências e infra | ATENÇÃO + IMAP TLS | IMAP TLS corrigido; deps atualizações em P2 |
| 10 | Validação input/output | ATENÇÃO — sem CSP | Sem mudança (P2) |

**Avaliação inicial:** PRECISA MELHORAR (beirando crítico)
**Avaliação pós P0:** PRECISA MELHORAR (P0 fechado, P1 pendente)

---

## 1. Segredos expostos

### [CRÍTICO] `tools/ocr_pdf.py:21` — Chave Gemini hardcoded ✓ CORRIGIDO

Chave `AIzaSyBDg2TPGWzTqA-ckFXr0gzVSr1ZQZifUK8` estava em texto plano.

**Correção aplicada:**
- Substituído por `os.environ.get("GEMINI_API_KEY")` com fail-closed
- Script exibe instruções de configuração se a variável não estiver setada

**Ação pendente (manual):**
- [ ] **Cynthia**: revogar a chave antiga no Google Cloud Console → APIs & Services → Credentials

### [CRÍTICO] `deploy-gv.ps1:26` — Chave YouTube hardcoded ✓ CORRIGIDO

Chave `AIzaSyDBc_oXi54iPCXgFHIHobgyBYrMesr7XBw` era injetada via `ssh echo` no `.env` da VPS.

**Correção aplicada:**
- Script carrega segredos de `.deploy-secrets.ps1` (não versionado)
- Se a chave não estiver no `.env` da VPS E não estiver em `$env:YOUTUBE_API_KEY`, o script aborta com instruções

**Ação pendente (manual):**
- [ ] **Cynthia**: revogar a chave antiga no Google Cloud Console
- [ ] **Cynthia**: criar `.deploy-secrets.ps1` na raiz do workspace (ver `.deploy-secrets.ps1.example`) com a nova chave

### [CRÍTICO] `gabinete-carol/upload_fala_cidadao.ps1` — Credenciais Fala Cidadão ✓ CORRIGIDO

Continha `FALA_CIDADAO_LOGIN` (CPF), `FALA_CIDADAO_PASSWORD` e `FALA_CIDADAO_APP_KEY` em texto plano.

**Correção aplicada:**
- Script carrega credenciais do mesmo `.deploy-secrets.ps1` (raiz do workspace)
- Valida presença das 3 variáveis de ambiente e aborta se alguma faltar

**Nota:** Fala Cidadão é acesso pessoal da Cynthia usado ocasionalmente pelo projeto para puxar indicações. Será descontinuado quando o sistema próprio de indicações (`/api/indicacoes/nova`) cobrir todos os fluxos.

**Ação pendente (manual):**
- [ ] **Cynthia** (opcional): trocar senha + revogar APP_KEY no Fala Cidadão se julgar necessário

### [CRÍTICO] Cookies Google autenticados no workspace — DEPENDE DE AÇÃO MANUAL

Arquivos identificados:
- `cobalt-cookies.json`
- `www.youtube.com_cookies (1).txt`

Ambos contêm cookies de sessão Google válidos (`SID`, `SSID`, `SAPISID`, `__Secure-1PSID`, `__Secure-3PSID`), expiração em 2027, que permitem login **sem senha** na conta vinculada.

**Correção aplicada:**
- `.gitignore` criado no workspace raiz bloqueando `*cookies*.json`, `*cookies*.txt`, `cobalt-cookies.*`, `www.youtube.com_cookies*`

**Ações pendentes (manuais, CRÍTICAS):**
- [ ] **Cynthia**: acessar https://myaccount.google.com → Segurança → Dispositivos e atividade → revogar todas as sessões suspeitas
- [ ] **Cynthia**: considerar alterar senha da conta Google por segurança
- [ ] Gerar novos cookies pós-revogação para manter cobalt/yt-dlp funcionando (a transcrição depende deles)

---

## 2. Autenticação — rotas P0 protegidas

Todas as 10 rotas listadas receberam `requireAuth` no início do handler:

| Rota | Método(s) | Motivo | Status |
|---|---|---|---|
| `/api/sessoes/transcrever` | POST | Consome Groq API pago | ✓ |
| `/api/sessoes/youtube` | GET + POST | Consome YouTube API + Groq + yt-dlp | ✓ |
| `/api/laia/chat` | POST | Consome Gemini API por interação | ✓ |
| `/api/gabinete/config` | GET + PATCH | Altera `relator_nome_padrao` dos pareceres oficiais | ✓ |
| `/api/alia/knowledge` | GET + POST + DELETE | Corrompe/lista base vetorial do RAG | ✓ |
| `/api/cadin/ingest-document` | POST | Ingere documentos no CADIN | ✓ |
| `/api/indicacoes/nova` | POST | Cria indicações em nome do gabinete | ✓ |
| `/api/indicacoes/campo` | GET | Lista PII de cidadãos (nome, bairro, fotos, GPS) | ✓ |
| `/api/pareceres/gerar` | POST | Gera pareceres legislativos via Gemini | ✓ |
| `/api/cadin/persons/[id]` | GET + PATCH + DELETE | (já tinha auth — ver IDOR abaixo) | ✓ |

**Pendência P1:** auditar as ~60 rotas restantes e aplicar `requireAuth` onde faltar. Criar script que detecta handlers sem a chamada.

---

## 4. IDOR multi-tenant — CADIN persons

### [CRÍTICO] `api/cadin/persons/[id]/route.ts` — sem filtro por gabinete_id ✓ CORRIGIDO

PATCH, DELETE e GET filtravam só por `id`, permitindo que um usuário autenticado acessasse/alterasse/apagasse registros de outro gabinete.

**Correção aplicada:**
- Adicionado `const GABINETE_ID = process.env.GABINETE_ID!` no topo
- `.eq('gabinete_id', GABINETE_ID)` em todas as queries (select, update, delete)
- DELETE agora verifica ownership antes de apagar e retorna 404 se a pessoa não pertence ao gabinete
- PATCH também retorna 404 se o `currentPerson` não for encontrado no gabinete

Importante para multi-tenant (24 gabinetes CMBV): sem esse fix, um gabinete poderia apagar dados do outro.

---

## 9. Infraestrutura — TLS IMAP

### [ALTO] `agenda/sync-emails/route.ts:64` — `rejectUnauthorized: false` ✓ CORRIGIDO

Permitia MITM capturar senhas IMAP de `caroldantasrr@gmail.com`, `agendacaroldantas@gmail.com` etc.

**Correção aplicada:**
- `rejectUnauthorized: true` (Gmail/Outlook têm certs válidos — zero impacto funcional)

---

## Backlog P1 (esta semana)

1. Auditar e proteger as ~60 rotas API restantes sem `requireAuth`
2. Fix `/api/gemini` no cmbv-parecer:
   - Mover `GEMINI_API_KEY` para env server-side
   - Tornar `API_SECRET` obrigatório (fail-closed)
   - Remover backdoor `TEST_KEY`
3. Aumentar senha mínima de 6 para 12 chars em `admin/equipe/[id]/password`
4. Mascarar telefones nos logs (`digest.ts`, `dispatcher.ts`) — LGPD
5. Criar página `/privacidade` com política LGPD (dados coletados, base legal, retenção, DPO)

## Backlog P2 (este mês)

6. Rate limiting nas rotas restantes de alto custo (transcrição, documentos, pareceres)
7. Endpoint `DELETE /api/cidadao/meus-dados` (direito ao esquecimento LGPD)
8. Cron TTL 90 dias para `laia_sessions` (retenção LGPD)
9. Headers de segurança HTTP em `next.config.ts` (CSP, HSTS, X-Frame-Options)
10. Atualizar deps desatualizadas: `pdf-parse@1.1.4`, `node-fetch`, `adm-zip`
11. Verificar `gabinete_id` em TODOS endpoints com param `[id]`

## Backlog P3 (estratégico)

12. Migrar rate limiter in-memory → Redis (compartilhamento entre instâncias)
13. Alertas de uso anormal Gemini/Groq
14. Substituir `adm-zip` por alternativa mantida
15. CSP granular no frontend Next.js
16. Banner de consentimento LGPD no cadastro e WhatsApp

---

## Arquivos modificados nesta sessão (2026-04-10)

### Workspace root
- `.gitignore` — criado (defensivo, cobre cookies, .env, chaves, etc.)
- `.deploy-secrets.ps1.example` — criado (template para credenciais de deploy)
- `deploy-gv.ps1` — carrega segredos locais + valida YOUTUBE_API_KEY

### tools/
- `tools/ocr_pdf.py` — GEMINI_API_KEY agora vem de env, fail-closed

### gabinete-carol/
- `upload_fala_cidadao.ps1` — carrega credenciais do `.deploy-secrets.ps1` da raiz

### gabinete-carol/src/app/api/ — requireAuth adicionado
- `sessoes/transcrever/route.ts`
- `sessoes/youtube/route.ts` (GET e POST)
- `laia/chat/route.ts`
- `gabinete/config/route.ts` (GET e PATCH)
- `alia/knowledge/route.ts` (GET, POST e DELETE)
- `cadin/ingest-document/route.ts`
- `indicacoes/nova/route.ts`
- `indicacoes/campo/route.ts`
- `pareceres/gerar/route.ts`

### gabinete-carol/src/app/api/ — IDOR fix
- `cadin/persons/[id]/route.ts` — `.eq('gabinete_id', GABINETE_ID)` em PATCH, DELETE, GET

### gabinete-carol/src/app/api/ — TLS fix
- `agenda/sync-emails/route.ts` — `rejectUnauthorized: true`

---

## Ações manuais urgentes (Cynthia)

Em ordem de prioridade:

1. **AGORA**: acessar https://myaccount.google.com → Segurança → revogar sessões suspeitas (cookies comprometidos)
2. **AGORA**: Google Cloud Console → revogar `AIzaSyBDg2TPGWzTqA-ckFXr0gzVSr1ZQZifUK8` (Gemini antiga) e `AIzaSyDBc_oXi54iPCXgFHIHobgyBYrMesr7XBw` (YouTube antiga)
3. **AGORA**: criar novas chaves Gemini e YouTube
4. **HOJE**: criar `.deploy-secrets.ps1` na raiz do workspace com as novas chaves (template em `.deploy-secrets.ps1.example`)
5. **HOJE**: gerar novos cookies Google pós-revogação de sessão para manter cobalt/yt-dlp funcionando
6. **Antes do próximo deploy**: testar se deploy-gv.ps1 e upload_fala_cidadao.ps1 ainda funcionam com o novo fluxo de segredos

---

## Referências

- Relatório completo do agente: gerado no output do security-auditor (2026-04-10 15:45 UTC)
- Memória persistente: `memory/project_auditoria_seguranca_2026-04-10.md`
- Snapshot de rollback: VPS 1305188 snapshot 244018 (válido até 2026-04-30)
