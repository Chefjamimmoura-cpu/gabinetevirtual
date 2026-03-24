$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Updating CSS & files for Oficios Layout fix..."
scp "src/app/(dashboard)/oficios/oficios-dashboard.module.css" "${VPS}:'${DEST}/src/app/(dashboard)/oficios/oficios-dashboard.module.css'"
scp "src/app/(dashboard)/oficios/oficios-dashboard.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/oficios/oficios-dashboard.tsx'"
scp "src/components/pareceres-core/pareceres-moderacao.tsx" "${VPS}:'${DEST}/src/components/pareceres-core/pareceres-moderacao.tsx'"

Write-Host "Rebuild Docker..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Done"
