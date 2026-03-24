$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Criando pastas no VPS se nao existirem..."
ssh ${VPS} "mkdir -p '${DEST}/src/app/(dashboard)/indicacoes/components'"
ssh ${VPS} "mkdir -p '${DEST}/src/app/(dashboard)/oficios/components'"
ssh ${VPS} "mkdir -p '${DEST}/src/components/pareceres-core'"

Write-Host "Copiando Componentes Modificados..."
scp "src/app/actions.ts" "${VPS}:${DEST}/src/app/actions.ts"
scp "src/app/(dashboard)/indicacoes/indicacoes-dashboard.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/indicacoes/indicacoes-dashboard.tsx'"
scp "src/app/(dashboard)/indicacoes/components/indicacoes-moderacao.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/indicacoes/components/indicacoes-moderacao.tsx'"
scp "src/app/(dashboard)/agenda/page.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/agenda/page.tsx'"
scp "src/app/(dashboard)/oficios/oficios-dashboard.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/oficios/oficios-dashboard.tsx'"
scp "src/app/(dashboard)/oficios/components/oficios-moderacao.tsx" "${VPS}:'${DEST}/src/app/(dashboard)/oficios/components/oficios-moderacao.tsx'"
scp "src/components/pareceres-core/pareceres-dashboard.tsx" "${VPS}:'${DEST}/src/components/pareceres-core/pareceres-dashboard.tsx'"
scp "src/components/pareceres-core/pareceres-moderacao.tsx" "${VPS}:'${DEST}/src/components/pareceres-core/pareceres-moderacao.tsx'"

Write-Host "Realizando Rebuild do Container na VPS..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Deploy ALIA Omnipresente Concluido."
