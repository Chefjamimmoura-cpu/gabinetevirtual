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
