$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol/src/app/(dashboard)/indicacoes"  
$BASE_DEST = "/opt/gabinete-carol"

Write-Host "Realizando deploy das atualizações Frontend do Kanban..." -ForegroundColor Cyan

scp src/app/(dashboard)/indicacoes/indicacoes-dashboard.tsx ${VPS}:${DEST}/indicacoes-dashboard.tsx
scp src/app/(dashboard)/indicacoes/components/fala-cidadao-inbox.tsx ${VPS}:${DEST}/components/fala-cidadao-inbox.tsx
scp src/app/(dashboard)/indicacoes/components/campo-kanban.tsx ${VPS}:${DEST}/components/campo-kanban.tsx
scp src/app/(dashboard)/indicacoes/components/indicacoes-mapa.tsx ${VPS}:${DEST}/components/indicacoes-mapa.tsx

Write-Host "Rebuildando o Docker container no VPS..." -ForegroundColor Yellow
ssh ${VPS} "cd ${BASE_DEST} && docker compose build gabinete-carol && docker compose up -d"

Write-Host "Deploy Concluído." -ForegroundColor Green
