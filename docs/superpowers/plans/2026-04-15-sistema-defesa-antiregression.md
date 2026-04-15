# Sistema de Defesa Anti-Regressão — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar sistema de proteção em 3 camadas (prevenção, memória, detecção) que impede regressões em todos os projetos, com rotina de auditoria automatizada.

**Architecture:** CLAUDE.md global define regras universais; CLAUDE.md local documenta cada projeto; scripts de validação automatizam checks; skill /guardia-noturna executa auditoria completa; memórias registram cada avanço.

**Tech Stack:** Node.js (scripts), Claude Code hooks (settings.json), Claude Code skills, Supabase (queries de verificação)

---

## File Structure

### Global (`~/.claude/`)
| Ação | Arquivo | Responsabilidade |
|------|---------|------------------|
| Modify | `CLAUDE.md` | Regras anti-regressão + padrão de memória de avanços |
| Modify | `settings.json` | Hook user-prompt-submit |

### Projeto Gabinete Carol (`gabinete-carol/`)
| Ação | Arquivo | Responsabilidade |
|------|---------|------------------|
| Create | `CLAUDE.md` | Arquitetura, dependências, regras locais |
| Modify | `package.json:5-10` | Scripts check, typecheck, env:validate |
| Create | `scripts/validate-env.js` | Comparar .env.local vs .env.example |

### Memórias (`~/.claude/projects/c--Dev-Cynthia-Gabinetecarol/memory/`)
| Ação | Arquivo | Responsabilidade |
|------|---------|------------------|
| Create | `feedback_antiregression.md` | Caso de estudo + regras aprendidas |
| Modify | `backlog.md` | Atualizar estado real |

---

## Task 1: CLAUDE.md Global — Protocolo Anti-Regressão

**Files:**
- Modify: `C:\Users\jamim\.claude\CLAUDE.md`

- [ ] **Step 1: Ler CLAUDE.md global atual**

Verificar conteúdo atual para não sobrescrever nada.

- [ ] **Step 2: Adicionar bloco Protocolo Anti-Regressão**

Após o bloco "Memória persistente" existente, adicionar:

```markdown
## Protocolo Anti-Regressão (obrigatório em TODOS os projetos)

### Regra 1: Não Quebrar
- Antes de modificar qualquer arquivo: identificar TODOS os importadores/consumidores via grep/glob.
- Antes de renomear/mover símbolo: grep global pelo nome antigo, listar todos os usos.
- Antes de refatorar: garantir que o build passa ANTES e DEPOIS da mudança.
- Nunca remover export sem confirmar zero consumidores.
- Nunca alterar interface/tipo sem atualizar todos os usos.

### Regra 2: Verificar Antes de Declarar Pronto
- Rodar o comando de verificação do projeto (`npm run check` ou equivalente) e reportar saída completa.
- Verificar que o dev server responde (curl ou fetch no health endpoint).
- Confirmar que .env.local tem todas as variáveis do .env.example (se existir script, rodar `npm run env:validate`).
- **Nunca** dizer "pronto" ou "feito" sem evidência de execução.

### Regra 3: Proteger Estado
- Nunca modificar .env.local/.env sem autorização explícita do usuário.
- Nunca alterar migrations já aplicadas no banco — sempre criar nova migration.
- Nunca fazer `--force`, `--no-verify`, `reset --hard` sem pedir autorização.
- Ao criar arquivo novo: justificar por que não cabe em arquivo existente.

### Regra 4: CLAUDE.md Local Obrigatório
- Todo projeto DEVE ter um CLAUDE.md na raiz com: stack, arquitetura, dependências críticas, regras de deploy.
- Ao iniciar sessão em projeto sem CLAUDE.md, sugerir criação imediatamente.

## Registro de Avanços (obrigatório em TODOS os projetos)

Todo avanço significativo DEVE gerar um arquivo de memória. "Avanço significativo" = feature nova, bug crítico corrigido, refatoração que altera dependências, configuração de infra alterada, decisão arquitetural, integração com serviço externo.

Formato do arquivo (em `memory/`):

```
---
name: {{nome curto}}
description: {{uma linha — o que foi feito e por que importa}}
type: project
---

## O que foi feito
{{Resumo concreto}}

## Arquivos afetados
{{Lista dos arquivos criados/modificados}}

## O que depende disso
{{Módulos/fluxos que dependem desta mudança}}

## O que foi verificado
{{Build? Dev server? Endpoint? Evidência concreta.}}

## Cuidados futuros
{{O que pode quebrar se alguém mexer sem contexto}}
```

Nomenclatura: `avanço_YYYY-MM-DD_<tema>.md`

Quando NÃO criar: ajustes triviais (typo, comentário, estilo) que não afetam comportamento.
```

- [ ] **Step 3: Verificar que o arquivo está bem formado**

Ler o arquivo final e confirmar que não há quebra de formatação ou conteúdo duplicado.

- [ ] **Step 4: Commit**

```bash
git add ~/.claude/CLAUDE.md
git commit -m "docs: expandir CLAUDE.md global com protocolo anti-regressão e registro de avanços"
```

---

## Task 2: CLAUDE.md Local — Gabinete Carol

**Files:**
- Create: `gabinete-carol/CLAUDE.md`

- [ ] **Step 1: Criar CLAUDE.md do projeto**

```markdown
# Gabinete Virtual — Carol Dantas

## Stack
- **Frontend:** Next.js 15 (App Router) + React 19 + CSS Vanilla (Glassmorphism)
- **Auth/DB:** Supabase Cloud (projeto: drrzyitmlgeozxwubsyl)
- **IA:** Gemini 2.0 Flash (primário), Claude (agentes complexos), Groq Whisper (transcrição)
- **WhatsApp:** Evolution API
- **Deploy:** Docker + Traefik na VPS Hostinger (76.13.170.230)

## Portas de desenvolvimento
- `localhost:3001` — Gabinete Virtual (Next.js dev server)
- `localhost:3000` — cmbv-parecer (Express, serviço separado)

## Módulos críticos (verificar dependentes antes de modificar)
- `src/lib/permissions.ts` — importado por sidebar, superadmin, equipe-manager, middleware
- `src/lib/supabase/middleware.ts` — toda rota autenticada depende deste arquivo
- `src/app/(dashboard)/superadmin/layout.tsx` — proteção de rota superadmin
- `src/components/sidebar.tsx` — navegação global, usa permissions para filtrar itens

## Supabase
- Migrations em `supabase/migrations/` (001-038), sequenciais. **Nunca editar migration já aplicada** — criar nova.
- RLS ativo em `profiles` (migration 031). Superadmin pode ler/editar/deletar todos os profiles.
- Banco é compartilhado entre localhost e produção (mesmo Supabase Cloud).

## Deploy
- Script principal: `deploy-gv.ps1` (na raiz do monorepo, fora de gabinete-carol/)
- **Arquivos novos DEVEM ser adicionados ao deploy-gv.ps1** — ele envia arquivo por arquivo, não diretório.
- Alternativa para deploy completo: `deploy-v4-sprint.ps1` (envia diretórios inteiros via scp)

## Env vars
- `.env.example` é a fonte de verdade — 27 variáveis documentadas.
- `.env.local` (dev) e `.env` (VPS) — **nunca commitar, nunca modificar sem autorização**.
- Validar com: `npm run env:validate`

## Verificação
- `npm run check` — typecheck + lint + build completo
- `npm run typecheck` — verificação rápida de tipos
- `npm run env:validate` — compara .env.local vs .env.example

## Padrões
- Cor primária: azul profundo `#16325B` — usar `var(--primary-600)`. **NUNCA roxo (#7c3aed).**
- Idioma: Português do Brasil em toda UI e comunicação.
- CSS: Vanilla com variáveis CSS, sem Tailwind. Glassmorphism como linguagem visual.
```

- [ ] **Step 2: Commit**

```bash
cd gabinete-carol
git add CLAUDE.md
git commit -m "docs: criar CLAUDE.md local com arquitetura e regras do projeto"
```

---

## Task 3: Scripts de Validação no package.json

**Files:**
- Modify: `gabinete-carol/package.json:5-10`
- Create: `gabinete-carol/scripts/validate-env.js`

- [ ] **Step 1: Adicionar scripts ao package.json**

No bloco `"scripts"`, adicionar após `"lint"`:

```json
"typecheck": "tsc --noEmit",
"check": "tsc --noEmit && next lint && next build",
"env:validate": "node scripts/validate-env.js"
```

Resultado final do bloco scripts:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "check": "tsc --noEmit && next lint && next build",
  "env:validate": "node scripts/validate-env.js"
}
```

- [ ] **Step 2: Criar scripts/validate-env.js**

```javascript
#!/usr/bin/env node
/**
 * validate-env.js — Compara .env.local (ou .env) com .env.example
 * Reporta variáveis obrigatórias faltantes.
 * 
 * Uso: npm run env:validate
 * Exit code 1 se alguma obrigatória faltar.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const examplePath = path.join(root, '.env.example');
const localPath = fs.existsSync(path.join(root, '.env.local'))
  ? path.join(root, '.env.local')
  : path.join(root, '.env');

if (!fs.existsSync(examplePath)) {
  console.log('⚠ .env.example não encontrado — pulando validação.');
  process.exit(0);
}

if (!fs.existsSync(localPath)) {
  console.error('✗ Nenhum .env.local ou .env encontrado!');
  process.exit(1);
}

function parseEnvKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const keys = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

// Variáveis opcionais (comentadas como tal no .env.example ou legacy)
const OPTIONAL = new Set([
  'FALA_CIDADAO_API_URL', 'FALA_CIDADAO_APP_KEY',
  'FALA_CIDADAO_LOGIN', 'FALA_CIDADAO_PASSWORD',
  'ALIA_NOTIFY_NUMBERS', 'STRIPE_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY', 'SAPL_API_TOKEN', 'SAPL_USUARIO_ENVIO_ID',
]);

const exampleKeys = parseEnvKeys(examplePath);
const localKeys = new Set(parseEnvKeys(localPath));

let missing = 0;
let optional = 0;

console.log(`\n🔍 Validando ${path.basename(localPath)} contra .env.example\n`);

for (const key of exampleKeys) {
  if (localKeys.has(key)) {
    // OK
  } else if (OPTIONAL.has(key)) {
    console.log(`  ⚪ ${key} — opcional, ausente`);
    optional++;
  } else {
    console.log(`  ✗ ${key} — OBRIGATÓRIA, faltando!`);
    missing++;
  }
}

const total = exampleKeys.length;
const present = total - missing - optional;

console.log(`\n📊 Resultado: ${present}/${total} presentes, ${optional} opcionais ausentes, ${missing} obrigatórias faltando\n`);

if (missing > 0) {
  console.error('❌ Existem variáveis obrigatórias faltando! Corrija o .env.local.\n');
  process.exit(1);
} else {
  console.log('✅ Todas as variáveis obrigatórias estão presentes.\n');
  process.exit(0);
}
```

- [ ] **Step 3: Testar o script**

Run: `cd gabinete-carol && node scripts/validate-env.js`

Esperado: lista de variáveis com status, exit code 0 se obrigatórias presentes.

- [ ] **Step 4: Testar npm run typecheck**

Run: `cd gabinete-carol && npm run typecheck`

Esperado: compilação de tipos sem erros (ou lista de erros existentes a documentar).

- [ ] **Step 5: Commit**

```bash
cd gabinete-carol
git add package.json scripts/validate-env.js
git commit -m "feat: adicionar scripts check, typecheck e env:validate"
```

---

## Task 4: Hook Claude Code (user-prompt-submit)

**Files:**
- Modify: `C:\Users\jamim\.claude\settings.json`

- [ ] **Step 1: Ler settings.json atual**

Verificar estrutura atual para não sobrescrever configurações existentes.

- [ ] **Step 2: Adicionar hook user-prompt-submit**

Adicionar ao objeto raiz do settings.json a chave `"hooks"`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo '⚠ Protocolo ativo: verificar consumidores antes de modificar, rodar check antes de declarar pronto.'"
          }
        ]
      }
    ]
  }
}
```

O hook dispara a cada prompt com uma linha curta de lembrete. Não bloqueia execução.

- [ ] **Step 3: Verificar que o JSON está válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('C:/Users/jamim/.claude/settings.json','utf-8')); console.log('JSON válido')"`

Esperado: "JSON válido"

- [ ] **Step 4: Testar o hook**

Enviar um prompt qualquer no Claude Code e verificar que o lembrete aparece no terminal.

- [ ] **Step 5: Commit**

```bash
cd ~/.claude
git add settings.json
git commit -m "feat: adicionar hook anti-regressão em user-prompt-submit"
```

Nota: se `~/.claude` não for um repo git, apenas registrar que a alteração foi feita.

---

## Task 5: Memória — Feedback Anti-Regressão

**Files:**
- Create: `~/.claude/projects/c--Dev-Cynthia-Gabinetecarol/memory/feedback_antiregression.md`
- Modify: `~/.claude/projects/c--Dev-Cynthia-Gabinetecarol/memory/MEMORY.md`

- [ ] **Step 1: Criar feedback_antiregression.md**

```markdown
---
name: Incidente anti-regressão 2026-04-15
description: Caso de estudo — gabinete_id perdido por falta de verificação; regras aprendidas
type: feedback
---

## O que aconteceu
Em 2026-04-15, o perfil `jamim.moura` no Supabase perdeu o `gabinete_id` (ficou NULL). Isso causou falha em cascata:
- Configurações → "Nenhum gabinete vinculado à sua conta"
- Equipe RBAC → "Você é um(a) Assessor(a)" (default, porque gabinete_id null impedia carregamento do role real)
- Superadmin → listava apenas 1 usuário (RLS sem gabinete_id)

## Causa raiz
Uma sessão de debug/refatoração anterior alterou estado do banco sem verificação pós-mudança. Não havia:
- Nenhum teste que verificasse a integridade dos perfis
- Nenhum CLAUDE.md com regras anti-regressão
- Nenhum script de validação de estado

## Regras aprendidas

**Why:** Sem verificação automática, qualquer refatoração pode quebrar dependências silenciosamente.

**How to apply:**
1. Sempre rodar `npm run check` antes de declarar qualquer tarefa completa
2. Nunca modificar dados no banco (profiles, gabinetes) sem verificar dependentes
3. Após qualquer mudança em RLS/policies/migrations, testar query como anon E como superadmin
4. O campo `gabinete_id` em profiles é crítico — equipe-manager, configurações e sidebar dependem dele
5. Todo avanço significativo gera memória com "o que depende" documentado
```

- [ ] **Step 2: Adicionar entrada no MEMORY.md**

Adicionar linha na tabela do MEMORY.md:

```markdown
| [feedback_antiregression.md](feedback_antiregression.md) | feedback | Incidente 2026-04-15: gabinete_id perdido, regras anti-regressão aprendidas |
```

- [ ] **Step 3: Commit**

Nota: memórias não são versionadas em git (ficam em ~/.claude/). Apenas confirmar que os arquivos foram criados.

---

## Task 6: Memória — Avanço desta implementação

**Files:**
- Create: `~/.claude/projects/c--Dev-Cynthia-Gabinetecarol/memory/avanço_2026-04-15_sistema_defesa_antiregression.md`
- Modify: `~/.claude/projects/c--Dev-Cynthia-Gabinetecarol/memory/MEMORY.md`

- [ ] **Step 1: Criar memória de avanço**

```markdown
---
name: Sistema de Defesa Anti-Regressão implementado
description: CLAUDE.md global+local, scripts check/env:validate, hook prompt, memórias de avanço — proteção completa
type: project
---

## O que foi feito
Implementação completa do Sistema de Defesa Anti-Regressão em 3 camadas:
- **Camada A (Prevenção):** CLAUDE.md global com protocolo anti-regressão, CLAUDE.md local do Gabinete Carol, scripts npm (check, typecheck, env:validate), hook user-prompt-submit
- **Camada B (Memória):** Regra global de registro de avanços, feedback do incidente documentado
- **Camada C (Detecção):** Skill /guardia-noturna (a ser ativado via /schedule para 20h)

## Arquivos afetados
- `~/.claude/CLAUDE.md` — expandido com protocolo anti-regressão + registro de avanços
- `~/.claude/settings.json` — hook user-prompt-submit adicionado
- `gabinete-carol/CLAUDE.md` — criado com arquitetura completa
- `gabinete-carol/package.json` — scripts check, typecheck, env:validate
- `gabinete-carol/scripts/validate-env.js` — validação de env vars

## O que depende disso
- Toda sessão futura do Claude Code lê o CLAUDE.md global → aplica regras
- O hook dispara a cada prompt → lembrete constante
- `npm run check` é o portão antes de declarar qualquer tarefa pronta
- Registro de avanços é obrigatório após features/refatorações

## O que foi verificado
- Scripts testados localmente (typecheck, env:validate)
- Hook testado no Claude Code
- CLAUDE.md lido corretamente por novas sessões

## Cuidados futuros
- Se mudar a estrutura de scripts no package.json, manter check/typecheck/env:validate
- Se mudar ~/.claude/settings.json, preservar o hook de user-prompt-submit
- O skill /guardia-noturna precisa ser criado e agendado separadamente
```

- [ ] **Step 2: Adicionar entrada no MEMORY.md**

```markdown
| [avanço_2026-04-15_sistema_defesa_antiregression.md](avanço_2026-04-15_sistema_defesa_antiregression.md) | project | Sistema de defesa anti-regressão: CLAUDE.md, scripts, hook, memórias |
```

- [ ] **Step 3: Verificação final**

Confirmar que MEMORY.md está abaixo de 200 linhas e sem duplicatas.

---

## Task 7: Skill /guardia-noturna (criação)

**Files:**
- Create: skill file para `/guardia-noturna`

- [ ] **Step 1: Criar o skill**

Usar o skill `skill-creator` para criar `/guardia-noturna` com as seguintes especificações:

**Nome:** guardia-noturna
**Descrição:** Auditoria completa de saúde do projeto. Executa 10 verificações: build, env vars, git status, RLS, rotas auth, dependências, deploy sync, migrations, health check, memória. Use diariamente às 20h ou a qualquer momento via /guardia-noturna.
**Trigger:** Quando o usuário invoca `/guardia-noturna` ou quando um scheduled agent dispara.

**Checklist que o skill executa:**

```
1. BUILD — rodar npm run check (ou equivalente). Reportar PASS/FAIL.
2. ENV VARS — rodar npm run env:validate (se existir). Reportar faltantes.
3. GIT STATUS — git status + git diff --stat. Reportar arquivos não commitados.
4. RLS POLICIES — se supabase/ existir, query Supabase para verificar policies em profiles.
5. ROTAS AUTH — grep requireAuth em route.ts files. Reportar % de cobertura.
6. DEPENDÊNCIAS — npm audit --audit-level=high. Reportar vulnerabilidades.
7. DEPLOY SYNC — se deploy-*.ps1 existir, comparar src/ files vs script. Reportar faltantes.
8. MIGRATIONS — se supabase/migrations/ existir, verificar sequência sem gaps.
9. HEALTH CHECK — se dev server ativo, curl localhost. Verificar resposta.
10. MEMÓRIA — verificar se memórias estão atualizadas. Sugerir updates se algo mudou.
```

**Output format:**
```
═══ Guárdia Noturna — Relatório ═══
Projeto: {nome do projeto}
Data: {YYYY-MM-DD HH:mm}

🟢 BUILD: OK (0 errors)
🟢 ENV: 15/15 vars presentes
🟡 GIT: 3 arquivos não commitados
🔴 DEPLOY: 2 arquivos fonte ausentes no deploy-gv.ps1
🟢 RLS: 3 policies ativas em profiles
...

═══ Ações Sugeridas ═══
1. [DEPLOY] Adicionar ao deploy-gv.ps1: src/app/api/admin/equipe/[id]/route.ts
2. [GIT] Commitar ou descartar: scripts/validate-env.js
```

- [ ] **Step 2: Testar o skill**

Invocar `/guardia-noturna` manualmente e verificar que os 10 checks executam.

- [ ] **Step 3: Commit do skill (se aplicável)**

Se o skill gera arquivo local, commitar.

---

## Task 8: Scheduled Agent — Rotina 20h

**Files:** Nenhum arquivo — configuração via `/schedule`

- [ ] **Step 1: Configurar scheduled agent**

Usar `/schedule` para criar trigger:
- **Horário:** 20:00 BRT (23:00 UTC), dias úteis (seg-sex)
- **Prompt:** "Execute /guardia-noturna no projeto c:\Dev\Cynthia\Gabinetecarol\gabinete-carol e reporte o resultado."

- [ ] **Step 2: Verificar que o schedule foi criado**

Usar `/schedule` para listar triggers ativos e confirmar.

---

## Task 9: Verificação Final

- [ ] **Step 1: Rodar npm run check no gabinete-carol**

Run: `cd gabinete-carol && npm run check`

Esperado: typecheck + lint + build passam sem erros.

- [ ] **Step 2: Rodar npm run env:validate**

Run: `cd gabinete-carol && npm run env:validate`

Esperado: relatório de variáveis, exit code 0.

- [ ] **Step 3: Confirmar CLAUDE.md global está correto**

Run: `cat ~/.claude/CLAUDE.md`

Esperado: contém Protocolo Anti-Regressão e Registro de Avanços.

- [ ] **Step 4: Confirmar CLAUDE.md local existe**

Run: `cat gabinete-carol/CLAUDE.md`

Esperado: contém stack, portas, módulos críticos, regras.

- [ ] **Step 5: Confirmar hook funciona**

Enviar prompt no Claude Code, verificar que lembrete aparece.

- [ ] **Step 6: Confirmar memórias criadas**

Run: `cat ~/.claude/projects/c--Dev-Cynthia-Gabinetecarol/memory/MEMORY.md`

Esperado: entradas para feedback_antiregression.md e avanço_2026-04-15.

- [ ] **Step 7: Commit final (se restante)**

```bash
cd gabinete-carol
git status
# Commitar qualquer arquivo restante
git add docs/superpowers/specs/2026-04-15-sistema-defesa-antiregression-design.md
git add docs/superpowers/plans/2026-04-15-sistema-defesa-antiregression.md
git commit -m "docs: spec e plano do sistema de defesa anti-regressão"
```
