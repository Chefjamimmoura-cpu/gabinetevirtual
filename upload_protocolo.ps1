$ErrorActionPreference = "Stop"
$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Criando pastas e enviando rotas de Auto-Protocolo SAPL..."
ssh ${VPS} "mkdir -p ${DEST}/src/app/api/sapl/protocolar ${DEST}/src/app/api/sapl/auth"
scp "src/app/api/sapl/protocolar/route.ts" "${VPS}:${DEST}/src/app/api/sapl/protocolar/"
scp "src/app/api/sapl/auth/route.ts" "${VPS}:${DEST}/src/app/api/sapl/auth/"
scp ".env.example" "${VPS}:${DEST}/"

Write-Host "Copiando componentes Front-end do Dasboard de Indicações..."
scp "src/app/(dashboard)/indicacoes/indicacoes-dashboard.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/"

Write-Host "Finalizado o envio dos arquivos do V3-F7."
