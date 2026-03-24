$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Deploying PLs Nova Proposicao (ALIA) workflow..."
ssh ${VPS} "mkdir -p '${DEST}/src/app/(dashboard)/pls/components'"

scp "src/app/(dashboard)/pls/components/pls-nova-proposicao.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/pls/components/pls-nova-proposicao.tsx'"
scp "src/app/(dashboard)/pls/pls-dashboard.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/pls/pls-dashboard.tsx'"
scp "src/app/(dashboard)/pls/pls-dashboard.module.css" "${VPS}:'${DEST}/src/app/(dashboard)/pls/pls-dashboard.module.css'"

Write-Host "Rebuild Docker..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Done"
