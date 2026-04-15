# Sistema de Defesa Anti-Regressão

**Data:** 2026-04-15
**Status:** Aprovado
**Escopo:** Global (todos os projetos) + Local (Gabinete Carol)

## Contexto

Em 2026-04-15, detectamos que o perfil `jamim.moura` perdeu o vínculo com o gabinete (`gabinete_id: null`), causando falha em cascata: configurações sem gabinete, equipe RBAC mostrando role errado, superadmin listando apenas 1 usuário. A causa raiz: uma sessão de debug/refatoração alterou estado sem verificação, e não havia nenhum mecanismo para detectar ou prevenir isso.

**Diagnóstico do projeto:**
- Zero testes automatizados
- Zero CI/CD (deploy manual via PowerShell)
- Zero hooks de pre-commit
- Zero validação pós-deploy
- ~60% das rotas API sem autenticação
- Sem CLAUDE.md no projeto
- 5 secrets expostos no .env.local

## Decisão

Implementar Sistema de Defesa em 3 Camadas (Abordagem 2):
- **Camada A:** Prevenção (CLAUDE.md + hooks + scripts)
- **Camada B:** Memória persistente (estado sempre atualizado)
- **Camada C:** Detecção (skill /guardia-noturna + scheduled agent 20h)

O que funcionar aqui se torna regra global para todos os projetos.

---

## Camada A — Prevenção

### A1. CLAUDE.md Global Expandido

**Arquivo:** `~/.claude/CLAUDE.md`

Adicionar bloco "Protocolo Anti-Regressão" com 4 regras:

#### Regra 1: Não Quebrar
- Antes de modificar qualquer arquivo: identificar TODOS os importadores/consumidores via grep/glob
- Antes de renomear/mover: grep global pelo símbolo antigo, listar todos os usos
- Antes de refatorar: garantir que `npm run build` (ou equivalente) passa ANTES e DEPOIS
- Nunca remover export sem confirmar zero consumidores
- Nunca alterar interface/tipo sem atualizar todos os usos

#### Regra 2: Verificar Antes de Declarar Pronto
- Rodar `npm run check` (ou equivalente) e reportar saída completa
- Verificar que o dev server responde
- Confirmar que .env.local tem todas as vars do .env.example
- Nunca dizer "pronto" sem evidência de execução

#### Regra 3: Proteger Estado
- Nunca modificar .env.local sem autorização explícita
- Nunca alterar migrations já aplicadas — criar nova migration
- Nunca fazer `--force`, `--no-verify`, `reset --hard` sem pedir
- Ao criar arquivo novo: justificar por que não cabe em existente

#### Regra 4: CLAUDE.md Obrigatório
- Todo projeto DEVE ter CLAUDE.md local com: stack, arquitetura, dependências críticas, regras de deploy
- O Claude Code deve sugerir criação quando detectar ausência

### A2. CLAUDE.md Local — Gabinete Carol

**Arquivo:** `gabinete-carol/CLAUDE.md`

Conteúdo:
- **Stack:** Next.js 15 + Supabase Cloud + CSS Vanilla (Glassmorphism)
- **Portas:** dev server = 3001, cmbv-parecer = 3000
- **Módulos críticos** (nunca modificar sem verificar dependentes):
  - `src/lib/permissions.ts` — importado por sidebar, superadmin, equipe-manager, middleware
  - `src/lib/supabase/middleware.ts` — toda rota autenticada depende
  - `src/app/(dashboard)/superadmin/layout.tsx` — proteção de rota superadmin
  - `src/components/sidebar.tsx` — navegação global, usa permissions
- **Supabase:** migrations sequenciais (001-038), nunca editar existentes
- **Deploy:** via `deploy-gv.ps1` — arquivos novos DEVEM ser adicionados ao script
- **Env vars:** .env.example é fonte de verdade, .env.local nunca commitar
- **Banco:** Supabase Cloud (drrzyitmlgeozxwubsyl), RLS ativo em profiles (migration 031)
- **Cor primária:** azul profundo (#16325B), NUNCA roxo

### A3. Scripts no package.json

Adicionar ao `gabinete-carol/package.json`:

```json
{
  "typecheck": "tsc --noEmit",
  "check": "tsc --noEmit && next lint && next build",
  "env:validate": "node scripts/validate-env.js"
}
```

### A4. Script validate-env.js

**Arquivo:** `gabinete-carol/scripts/validate-env.js`

Lógica:
1. Ler `.env.example`, extrair todas as chaves (ignorar comentários)
2. Ler `.env.local` (dev) ou `.env` (produção)
3. Classificar cada chave como obrigatória ou opcional (baseado em comentário no .env.example)
4. Reportar faltantes com exit code 1 se obrigatória ausente

### A5. Hook Claude Code (user-prompt-submit)

**Arquivo:** `~/.claude/settings.json`

Hook global que imprime lembrete no terminal a cada prompt. Apenas texto curto — não bloqueia execução:
```
⚠ Protocolo ativo: verificar consumidores antes de modificar, rodar check antes de declarar pronto.
```
O hook NÃO deve ser verboso — uma linha apenas, para não gerar fadiga.

---

## Camada B — Memória Persistente

### B1. Memórias a atualizar

| Arquivo | Ação |
|---|---|
| `feedback_tecnico.md` | Adicionar regras anti-regressão |
| `backlog.md` | Atualizar estado real (gabinete_id corrigido) |
| **Novo:** `feedback_antiregression.md` | Caso de estudo do incidente 2026-04-15 |

### B2. Regra global de memória — Registro de Avanços

Adicionar ao CLAUDE.md global:

**Regra: todo avanço significativo DEVE gerar um arquivo de memória.**

Um "avanço significativo" é qualquer um destes:
- Feature nova implementada
- Bug crítico corrigido
- Refatoração que altera dependências
- Configuração de infra/deploy alterada
- Decisão arquitetural tomada
- Integração com serviço externo

**Formato do arquivo de memória de avanço:**

```markdown
---
name: {{nome curto do avanço}}
description: {{uma linha — o que foi feito e por que importa}}
type: project
---

## O que foi feito
{{Resumo concreto da implementação}}

## Arquivos afetados
{{Lista dos arquivos criados/modificados}}

## O que depende disso
{{Módulos, componentes ou fluxos que dependem desta mudança}}

## O que foi verificado
{{Build passou? Dev server testado? Endpoint respondeu? Evidência.}}

## Cuidados futuros
{{O que pode quebrar se alguém mexer nisso sem contexto}}
```

**Nomenclatura:** `avanço_YYYY-MM-DD_<tema>.md`
Exemplo: `avanço_2026-04-15_sistema_defesa_antiregression.md`

**Quando NÃO criar:** Ajustes triviais (typo, comentário, estilo) que não afetam comportamento.

Isso complementa o git log — o git diz "o quê mudou", a memória diz "por quê, o que depende, e o que cuidar no futuro".

---

## Camada C — Detecção

### C1. Skill /guardia-noturna

**Localização:** Skill personalizado registrado no superpowers ou ~/.claude/

**Escopo:** Funciona para qualquer projeto. Checks se adaptam ao que existe no projeto.

**Checklist completo (10 verificações):**

| # | Check | Comando/Lógica | Adaptável |
|---|---|---|---|
| 1 | BUILD | `npm run check` | Se tem package.json com script check |
| 2 | ENV VARS | `npm run env:validate` | Se tem .env.example |
| 3 | GIT STATUS | `git status`, `git diff --stat` | Sempre |
| 4 | RLS POLICIES | Query Supabase pg_policies via service role | Se tem supabase/ |
| 5 | ROTAS AUTH | Grep requireAuth vs total de route.ts | Se tem src/app/api/ |
| 6 | DEPENDÊNCIAS | `npm audit --audit-level=high` | Se tem package.json |
| 7 | DEPLOY SYNC | Comparar src/ files vs deploy script | Se tem deploy-*.ps1 |
| 8 | MIGRATIONS | Verificar sequência sem gaps/duplicatas | Se tem supabase/migrations/ |
| 9 | HEALTH CHECK | curl localhost + Supabase connect | Se dev server ativo |
| 10 | MEMÓRIA | Sugerir atualizações se algo mudou | Sempre |

**Output:** Relatório com indicadores visuais:
- Verde: OK
- Amarelo: Atenção (não-crítico)
- Vermelho: Ação necessária

Se vermelho, o skill sugere ação corretiva específica.

### C2. Scheduled Agent (20h)

Configurar via `/schedule` para rodar `/guardia-noturna` automaticamente às 20h em dias úteis. O agente:
1. Executa o checklist completo
2. Gera relatório
3. Se houver itens vermelhos, notifica com resumo do problema e ação sugerida

---

## Entregas

| # | Entrega | Escopo | Arquivo |
|---|---|---|---|
| 1 | CLAUDE.md global expandido | Todos os projetos | `~/.claude/CLAUDE.md` |
| 2 | CLAUDE.md local | Gabinete Carol | `gabinete-carol/CLAUDE.md` |
| 3 | Scripts check/typecheck/env:validate | Gabinete Carol | `package.json` + `scripts/validate-env.js` |
| 4 | Hook user-prompt-submit | Todos os projetos | `~/.claude/settings.json` |
| 5 | Skill /guardia-noturna | Todos os projetos | Skill file |
| 6 | Scheduled agent 20h | Gabinete Carol | via `/schedule` |
| 7 | Memórias atualizadas | Gabinete Carol | `memory/` |

## Ordem de implementação

1. CLAUDE.md global → CLAUDE.md local (fundação)
2. Scripts package.json + validate-env.js (ferramentas)
3. Hook Claude Code (automação passiva)
4. Skill /guardia-noturna (auditoria sob demanda)
5. Memórias atualizadas (contexto)
6. Scheduled agent 20h (automação ativa)

## Fora de escopo (futuro)

- GitHub Actions CI/CD (Abordagem 3)
- Testes automatizados Jest/Playwright
- Husky pre-commit hooks
- Blue-green deployment
- Supabase PITR backups
