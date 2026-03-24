$ErrorActionPreference = "Stop"
$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "=== Deploy: Correção ATA Comissão (fila + dashboard) ===" -ForegroundColor Green

Write-Host "Enviando API da fila (relatoria)..."
scp "src/app/api/pareceres/relatoria/fila/route.ts" "${VPS}:${DEST}/src/app/api/pareceres/relatoria/fila/"

Write-Host "Enviando dashboard de pareceres..."
scp "src/components/pareceres-core/pareceres-dashboard.tsx" "${VPS}:${DEST}/src/components/pareceres-core/"

Write-Host "Reiniciando container na VPS..." -ForegroundColor Yellow
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache gabinete-carol && docker compose up -d gabinete-carol"

Write-Host "Deploy concluído!" -ForegroundColor Green
