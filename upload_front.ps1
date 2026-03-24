$ErrorActionPreference = "Stop"
$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Copiando rotas de Admin WhatsApp..."
ssh ${VPS} "mkdir -p ${DEST}/src/app/api/admin/whatsapp/qrcode ${DEST}/src/app/api/admin/whatsapp/status"
scp "src/app/api/admin/whatsapp/qrcode/route.ts" "${VPS}:${DEST}/src/app/api/admin/whatsapp/qrcode/"
scp "src/app/api/admin/whatsapp/status/route.ts" "${VPS}:${DEST}/src/app/api/admin/whatsapp/status/"

Write-Host "Copiando componentes e paginas do Front-end..."
scp "src/app/(dashboard)/configuracoes/page.tsx" "${VPS}:${DEST}/src/app/(dashboard)/configuracoes/"
scp "src/components/configuracoes/whatsapp-manager.tsx" "${VPS}:${DEST}/src/components/configuracoes/"
scp "src/components/configuracoes/whatsapp-manager.module.css" "${VPS}:${DEST}/src/components/configuracoes/"

Write-Host "Apenas arquivos necessarios enviados."
