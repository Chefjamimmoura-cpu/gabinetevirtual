# Design: Autenticacao YouTube via OAuth Device Code para Transcricao

**Data:** 2026-03-31
**Status:** Aprovado
**Problema:** YouTube bloqueia yt-dlp na VPS por deteccao de bot. Erro: "Sign in to confirm you're not a bot."

## Solucao

Usar o fluxo OAuth2 Device Code nativo do yt-dlp para autenticar com o YouTube. O usuario faz login pelo celular em 30 segundos, sem instalar nada.

## Arquitetura

### Fluxo do usuario
1. Acessa aba "YouTube CMBV" na pagina de sessoes
2. Ve banner "Conecte sua conta YouTube" (se nao autenticado)
3. Clica "Conectar YouTube"
4. App mostra: "Acesse google.com/device e digite: ABCD-1234"
5. Usuario abre no celular, digita codigo, clica Permitir
6. App detecta sucesso, banner some, botoes "Transcrever" habilitados
7. Token salvo na VPS, dura meses

### Componentes

#### 1. Volume Docker (persistencia do token)
- `docker-compose.yml`: adicionar volume `yt-dlp-cache:/home/nextjs/.cache/yt-dlp`
- Token sobrevive a rebuilds/deploys

#### 2. POST /api/sessoes/youtube/auth (iniciar autenticacao)
- Spawna `yt-dlp --username oauth2 --password "" -s "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`
- Captura stderr para extrair device code e URL
- Retorna `{ device_code, verification_url, user_code }`
- Processo yt-dlp fica rodando aguardando confirmacao

#### 3. GET /api/sessoes/youtube/auth-status
- Verifica se token OAuth existe em `~/.cache/yt-dlp/`
- Retorna `{ authenticated: boolean }`

#### 4. Alteracao no yt-dlp (GET e POST do youtube/route.ts)
- Adicionar `--username`, `oauth2`, `--password`, `""` aos argumentos
- Se token existir, yt-dlp usa automaticamente
- Se nao existir, download falha e frontend mostra banner de conexao

#### 5. Frontend (sessoes/page.tsx)
- Banner de configuracao no topo da aba YouTube CMBV
- Modal com instrucoes passo-a-passo e codigo do device
- Polling a cada 5s para detectar quando usuario completou auth
- Toast de sucesso/erro
- Botoes "Transcrever" desabilitados enquanto nao autenticado

### Instrucoes exibidas ao usuario no app

> **Conectar YouTube para Transcricao**
>
> Para transcrever sessoes do YouTube, precisamos conectar uma conta Google.
> Isso e feito uma unica vez e leva menos de 1 minuto.
>
> 1. No seu celular ou computador, acesse: **google.com/device**
> 2. Digite o codigo: **[CODIGO]**
> 3. Faca login com sua conta Google (se nao estiver logado)
> 4. Clique em "Permitir"
> 5. Volte aqui — a conexao sera detectada automaticamente!
>
> O acesso expira a cada poucos meses. Quando expirar, basta repetir este processo.

## Arquivos alterados

1. `docker-compose.yml` — volume para cache yt-dlp
2. `src/app/api/sessoes/youtube/route.ts` — flags OAuth no yt-dlp
3. `src/app/api/sessoes/youtube/auth/route.ts` — NOVO: endpoint device code
4. `src/app/api/sessoes/youtube/auth-status/route.ts` — NOVO: verificar token
5. `src/app/(dashboard)/sessoes/page.tsx` — banner + modal + polling
