$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Updating Indicacoes para suportar Email..."
scp "src/app/(dashboard)/indicacoes/components/indicacoes-moderacao.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/indicacoes/components/indicacoes-moderacao.tsx'"

Write-Host "Rebuild Docker..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Done"
