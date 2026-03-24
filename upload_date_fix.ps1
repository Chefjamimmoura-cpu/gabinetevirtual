$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Updating Oficios for strict Date Format (DD/MM/YYYY)..."
scp "src/app/(dashboard)/oficios/components/oficios-moderacao.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/oficios/components/oficios-moderacao.tsx'"
scp "src/app/api/oficios/gerar/route.ts" "${VPS}:'${DEST}/src/app/api/oficios/gerar/route.ts'"

Write-Host "Rebuild Docker..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Done"
