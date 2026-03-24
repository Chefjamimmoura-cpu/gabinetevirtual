# upload_do_reader.ps1 — Deploy do motor de Diário Oficial
# Arquivos: migração 023, extrator PDF, APIs do-jobs e sync-do atualizado

$VPS  = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol/gabinete-carol"

Write-Host "=== Upload: Motor de Diario Oficial ===" -ForegroundColor Cyan

# Migração SQL
Write-Host "[1/6] Migracao 023..." -ForegroundColor Yellow
scp supabase/migrations/023_cadin_do_jobs.sql "${VPS}:${DEST}/supabase/migrations/"

# next.config.ts (serverExternalPackages)
Write-Host "[2/6] next.config.ts..." -ForegroundColor Yellow
scp next.config.ts "${VPS}:${DEST}/"

# package.json (pdf-parse)
Write-Host "[3/6] package.json..." -ForegroundColor Yellow
scp package.json "${VPS}:${DEST}/"

# Lib PDF extractor
Write-Host "[4/6] src/lib/do/pdf-extractor.ts..." -ForegroundColor Yellow
ssh $VPS "mkdir -p ${DEST}/src/lib/do"
scp src/lib/do/pdf-extractor.ts "${VPS}:${DEST}/src/lib/do/"

# API do-jobs (GET lista + POST enfileira)
Write-Host "[5/6] API do-jobs..." -ForegroundColor Yellow
ssh $VPS "mkdir -p ${DEST}/src/app/api/cadin/do-jobs/process"
scp src/app/api/cadin/do-jobs/route.ts          "${VPS}:${DEST}/src/app/api/cadin/do-jobs/"
scp src/app/api/cadin/do-jobs/process/route.ts  "${VPS}:${DEST}/src/app/api/cadin/do-jobs/process/"

# sync-do atualizado
Write-Host "[6/6] API sync-do..." -ForegroundColor Yellow
scp src/app/api/cadin/sync-do/route.ts "${VPS}:${DEST}/src/app/api/cadin/sync-do/"

Write-Host ""
Write-Host "=== Instalando pdf-parse e reconstruindo ===" -ForegroundColor Cyan
ssh $VPS @"
cd ${DEST}
npm install --legacy-peer-deps 2>&1 | tail -5
npm run build 2>&1 | tail -20
"@

Write-Host ""
Write-Host "=== Reiniciando container ===" -ForegroundColor Cyan
ssh $VPS "cd /opt/gabinete-carol && docker compose restart gabinete-carol && sleep 5 && docker compose ps"

Write-Host ""
Write-Host "IMPORTANTE: Execute a migracao 023 no Supabase SQL Editor!" -ForegroundColor Red
Write-Host "Arquivo: supabase/migrations/023_cadin_do_jobs.sql" -ForegroundColor Red
