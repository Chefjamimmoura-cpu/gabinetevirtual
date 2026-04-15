$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

# ── Carregar segredos locais (não versionados) ───────────────────
# .deploy-secrets.ps1 fica na raiz do workspace (um nível acima deste script)
$secretsFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".deploy-secrets.ps1"
if (Test-Path $secretsFile) {
    . $secretsFile
}

# ── Validar credenciais Fala Cidadão (acesso pessoal da Cynthia) ─
# NOTA: Fala Cidadão é acesso pessoal, será substituído pelo sistema
# próprio de indicações. Credenciais carregadas de .deploy-secrets.ps1.
$faltando = @()
if (-not $env:FALA_CIDADAO_APP_KEY)   { $faltando += "FALA_CIDADAO_APP_KEY" }
if (-not $env:FALA_CIDADAO_LOGIN)     { $faltando += "FALA_CIDADAO_LOGIN" }
if (-not $env:FALA_CIDADAO_PASSWORD)  { $faltando += "FALA_CIDADAO_PASSWORD" }

if ($faltando.Count -gt 0) {
    Write-Host "ERRO: Variaveis de ambiente faltando: $($faltando -join ', ')" -ForegroundColor Red
    Write-Host ""
    Write-Host "Configure criando o arquivo .deploy-secrets.ps1 na raiz do workspace." -ForegroundColor Yellow
    Write-Host "Use .deploy-secrets.ps1.example como template." -ForegroundColor Yellow
    exit 1
}

# Valores públicos (URLs) podem ficar hardcoded; só credenciais vem de env
$FALA_CIDADAO_API_URL = "https://api.prd.impacto.caroldantas.rr.cidadao.me"
$NEXTAUTH_URL = "https://gabinete.wonetechnology.cloud"

Write-Host "Injetando Variaveis de Ambiente do Fala Cidadao no Servidor..."
ssh ${VPS} "echo 'FALA_CIDADAO_API_URL=$FALA_CIDADAO_API_URL' >> ${DEST}/.env"
ssh ${VPS} "echo 'FALA_CIDADAO_APP_KEY=$env:FALA_CIDADAO_APP_KEY' >> ${DEST}/.env"
ssh ${VPS} "echo 'FALA_CIDADAO_LOGIN=$env:FALA_CIDADAO_LOGIN' >> ${DEST}/.env"
ssh ${VPS} "echo 'FALA_CIDADAO_PASSWORD=$env:FALA_CIDADAO_PASSWORD' >> ${DEST}/.env"
ssh ${VPS} "echo 'NEXTAUTH_URL=$NEXTAUTH_URL' >> ${DEST}/.env"

Write-Host "Criando pastas no VPS..."
ssh ${VPS} "mkdir -p ${DEST}/src/lib/fala-cidadao ${DEST}/src/app/api/indicacoes/fala-cidadao ${DEST}/src/app/api/indicacoes/nova ${DEST}/src/app/api/indicacoes/gerar-documento ${DEST}/src/app/api/indicacoes/campo ${DEST}/src/app/api/indicacoes/whatsapp/ordem-visita ${DEST}/src/app/api/alia/webhook ${DEST}/src/app/(dashboard)/indicacoes/components"

Write-Host "Copiando Arquivos Backend..."
scp "src/lib/fala-cidadao/client.ts" "${VPS}:${DEST}/src/lib/fala-cidadao/"
scp "src/app/api/indicacoes/fala-cidadao/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/fala-cidadao/"
scp "src/app/api/indicacoes/nova/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/nova/"
scp "src/app/api/indicacoes/gerar-documento/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/gerar-documento/"
scp "src/app/api/indicacoes/campo/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/campo/"
scp "src/app/api/indicacoes/whatsapp/ordem-visita/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/whatsapp/ordem-visita/"
scp "src/app/api/alia/webhook/route.ts" "${VPS}:${DEST}/src/app/api/alia/webhook/"

Write-Host "Copiando Componentes Frontend..."
ssh ${VPS} "mkdir -p ${DEST}/src/app/(dashboard)/indicacoes/components"
scp "src/app/(dashboard)/indicacoes/components/campo-kanban.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/components/"
scp "src/app/(dashboard)/indicacoes/components/indicacoes-mapa.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/components/"
scp "src/app/(dashboard)/indicacoes/components/gerar-protocolar-modal.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/components/"
scp "src/app/(dashboard)/indicacoes/indicacoes-dashboard.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/"

Write-Host "Realizando Rebuild do Container na VPS..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Deploy Concluído."
