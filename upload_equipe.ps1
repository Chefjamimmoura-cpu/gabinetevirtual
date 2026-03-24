$ErrorActionPreference = "Stop"
$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Copiando rotas de Admin Equipe..."
ssh ${VPS} "mkdir -p ${DEST}/src/app/api/admin/equipe ${DEST}/src/app/api/admin/equipe/\[id\] ${DEST}/src/app/api/admin/equipe/\[id\]/password"
scp "src/app/api/admin/equipe/route.ts" "${VPS}:${DEST}/src/app/api/admin/equipe/"
scp "src/app/api/admin/equipe/[id]/route.ts" "${VPS}:${DEST}/src/app/api/admin/equipe/\[id\]/"
scp "src/app/api/admin/equipe/[id]/password/route.ts" "${VPS}:${DEST}/src/app/api/admin/equipe/\[id\]/password/"

Write-Host "Copiando componentes Front-end da Equipe..."
scp "src/components/configuracoes/equipe-manager.tsx" "${VPS}:${DEST}/src/components/configuracoes/"
scp "src/components/configuracoes/equipe-manager.module.css" "${VPS}:${DEST}/src/components/configuracoes/"

Write-Host "Copia finalizada."
