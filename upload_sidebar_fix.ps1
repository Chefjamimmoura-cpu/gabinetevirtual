$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Enviando arquivo css esquecido..."
scp "src/components/sidebar.module.css" "${VPS}:${DEST}/src/components/"

Write-Host "Realizando Rebuild do Container na VPS..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Correção concluída."
