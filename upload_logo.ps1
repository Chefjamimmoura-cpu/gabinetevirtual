$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Enviando novas imagens e logos..."
scp public/icone*.svg "${VPS}:${DEST}/public/"
scp public/logo*.svg "${VPS}:${DEST}/public/"
scp public/logo*.png "${VPS}:${DEST}/public/"
scp public/nova-logo-icon.svg "${VPS}:${DEST}/public/"

Write-Host "Enviando componentes atualizados..."
scp "src/components/sidebar.tsx" "${VPS}:${DEST}/src/components/"
scp "src/app/login/page.tsx" "${VPS}:${DEST}/src/app/login/"
scp "src/app/login/login.module.css" "${VPS}:${DEST}/src/app/login/"

Write-Host "Realizando Rebuild do Container na VPS..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Upload da Logomarca concluído."
