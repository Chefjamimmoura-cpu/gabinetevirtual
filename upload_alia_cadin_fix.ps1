# upload_alia_cadin_fix.ps1
# Corrige ALIA: consulta CADIN direto no Supabase (sem fetch interno)
# e expande tool description para cobrir todas as esferas.

$VPS  = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol/gabinete-carol"

Write-Host "=== Upload: ALIA CADIN Fix ===" -ForegroundColor Cyan

Write-Host "[1/1] src/app/api/laia/chat/route.ts..." -ForegroundColor Yellow
scp src/app/api/laia/chat/route.ts "${VPS}:${DEST}/src/app/api/laia/chat/"

Write-Host ""
Write-Host "=== Build e restart ===" -ForegroundColor Cyan
ssh $VPS @"
cd ${DEST}
npm run build 2>&1 | tail -15
"@

ssh $VPS "cd /opt/gabinete-carol && docker compose restart gabinete-carol && sleep 5 && docker compose ps"

Write-Host ""
Write-Host "Deploy concluido. ALIA agora consulta Supabase diretamente." -ForegroundColor Green
