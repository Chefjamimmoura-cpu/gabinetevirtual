$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "Injetando Variaveis de Ambiente do Fala Cidadao no Servidor..."
ssh ${VPS} "echo 'FALA_CIDADAO_API_URL=https://api.prd.impacto.caroldantas.rr.cidadao.me' >> ${DEST}/.env"
ssh ${VPS} "echo 'FALA_CIDADAO_APP_KEY=IMPCT-KEY-015c24cd39e907b188f8b85966ec447c' >> ${DEST}/.env"
ssh ${VPS} "echo 'FALA_CIDADAO_LOGIN=64512622268' >> ${DEST}/.env"
ssh ${VPS} "echo 'FALA_CIDADAO_PASSWORD=2013Cpss.' >> ${DEST}/.env"
ssh ${VPS} "echo 'NEXTAUTH_URL=https://gabinete.wonetechnology.cloud' >> ${DEST}/.env"

Write-Host "Criando pastas no VPS..."
ssh ${VPS} "mkdir -p ${DEST}/src/lib/fala-cidadao ${DEST}/src/app/api/indicacoes/fala-cidadao ${DEST}/src/app/api/indicacoes/nova ${DEST}/src/app/api/indicacoes/gerar-documento ${DEST}/src/app/api/indicacoes/campo ${DEST}/src/app/api/indicacoes/whatsapp/ordem-visita ${DEST}/src/app/api/alia/webhook ${DEST}/src/app/(dashboard)/indicacoes/components"

Write-Host "Copiando Arquivos Backend..."
scp "src/lib/fala-cidadao/client.ts" "${VPS}:${DEST}/src/lib/fala-cidadao/"
scp "src/app/api/indicacoes/fala-cidadao/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/fala-cidadao/"
scp "src/app/api/indicacoes/nova/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/nova/"
scp "src/app/api/indicacoes/gerar-documento/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/gerar-documento/"
scp "src/app/api/indicacoes/campo/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/campo/"
scp "src/app/api/indicacoes/whatsapp/ordem-visita/route.ts" "${VPS}:${DEST}/src/app/api/indicacoes/whatsapp/ordem-visita/"
scp "src/app/api/alia/webhook/route.ts" "${VPS}:${DEST}/src/app/api/alia/webhook/"

Write-Host "Copiando Componentes Frontend..."
ssh ${VPS} "mkdir -p ${DEST}/src/app/(dashboard)/indicacoes/components"
scp "src/app/(dashboard)/indicacoes/components/campo-kanban.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/components/"
scp "src/app/(dashboard)/indicacoes/components/indicacoes-mapa.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/components/"
scp "src/app/(dashboard)/indicacoes/components/gerar-protocolar-modal.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/components/"
scp "src/app/(dashboard)/indicacoes/indicacoes-dashboard.tsx" "${VPS}:${DEST}/src/app/(dashboard)/indicacoes/"

Write-Host "Realizando Rebuild do Container na VPS..."
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache && docker compose up -d"

Write-Host "Deploy Concluído."
