$ErrorActionPreference = "Stop"
$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Copiando route gerar..."
scp src/app/api/pareceres/gerar/route.ts ${VPS}:${DEST}/src/app/api/pareceres/gerar/
Write-Host "Copiando diretorio alia..."
scp -r src/app/api/alia ${VPS}:${DEST}/src/app/api/
Write-Host "Copiando sync.ts..."
scp src/lib/sapl/sync.ts ${VPS}:${DEST}/src/lib/sapl/
Write-Host "Copiando sync-sapl route..."
scp src/app/api/admin/sync-sapl/route.ts ${VPS}:${DEST}/src/app/api/admin/sync-sapl/
Write-Host "Copiando sessoes route..."
scp src/app/api/pareceres/sessoes/route.ts ${VPS}:${DEST}/src/app/api/pareceres/sessoes/
Write-Host "Copiando ordem-dia route..."
scp src/app/api/pareceres/ordem-dia/route.ts ${VPS}:${DEST}/src/app/api/pareceres/ordem-dia/
Write-Host "Copiando ordens-ativas route..."
scp src/app/api/pareceres/ordens-ativas/route.ts ${VPS}:${DEST}/src/app/api/pareceres/ordens-ativas/
Write-Host "Copiando docker-compose.yml..."
scp docker-compose.yml ${VPS}:${DEST}/
Write-Host "Copiando rag/ingest route..."
scp src/app/api/rag/ingest/route.ts ${VPS}:${DEST}/src/app/api/rag/ingest/

Write-Host "Todos os arquivos enviados."
