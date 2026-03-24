$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Enviando novos CSS Modules e Components Polidos para a VPS..."
ssh ${VPS} "mkdir -p ${DEST}/src/app/(dashboard)/indicacoes/components"
scp -r "src/app/(dashboard)/indicacoes/components" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/"
scp "src/app/(dashboard)/indicacoes/indicacoes-dashboard.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/"
scp "src/app/(dashboard)/indicacoes/indicacoes-dashboard.module.css" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/"

Write-Host "Realizando Rebuild do Container na VPS..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Frontend V4-F3 Deploy Concluído."
