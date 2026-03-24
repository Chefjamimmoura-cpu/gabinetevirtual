$ErrorActionPreference = "Stop"
$VPS = "root@76.13.170.230"
$DEST = "/opt/gabinete-carol"

Write-Host "=== Deploy: CADIN Enhancements + Formal ATA Treatment ===" -ForegroundColor Cyan
Write-Host ""

# 1. PDF Export (filtros + cache + brasão corrigido)
Write-Host "[1/7] export-pdf/route.ts (PDF filtrado + cache)..." -ForegroundColor Yellow
scp "src/app/api/cadin/export-pdf/route.ts" "${VPS}:${DEST}/src/app/api/cadin/export-pdf/"

# 2. ALIA Webhook (birthday fix + PDF tool expandido)
Write-Host "[2/7] alia/webhook/route.ts (birthday fix + gerar_caderno_pdf)..." -ForegroundColor Yellow
scp "src/app/api/alia/webhook/route.ts" "${VPS}:${DEST}/src/app/api/alia/webhook/"

# 3. CADIN Dashboard (filtro aniversário por dia)
Write-Host "[3/7] cadin-dashboard.tsx (filtro por dia)..." -ForegroundColor Yellow
scp "src/components/cadin-core/cadin-dashboard.tsx" "${VPS}:${DEST}/src/components/cadin-core/"

# 4. CADIN Dashboard CSS (estilos do filtro)
Write-Host "[4/7] cadin-dashboard.module.css..." -ForegroundColor Yellow
scp "src/components/cadin-core/cadin-dashboard.module.css" "${VPS}:${DEST}/src/components/cadin-core/"

# 5. ATA Comissão (tratamento formal)
Write-Host "[5/7] comissao/gerar/route.ts (tratamento formal ATA)..." -ForegroundColor Yellow
scp "src/app/api/pareceres/comissao/gerar/route.ts" "${VPS}:${DEST}/src/app/api/pareceres/comissao/gerar/"

# 6. Generate DOCX (tratamento formal assinaturas)
Write-Host "[6/7] generate-docx.ts (assinaturas formais)..." -ForegroundColor Yellow
scp "src/lib/parecer/generate-docx.ts" "${VPS}:${DEST}/src/lib/parecer/"

# 7. Brasão do Estado de Roraima
Write-Host "[7/7] Brasão de Roraima (Marcas/)..." -ForegroundColor Yellow
ssh ${VPS} "mkdir -p ${DEST}/Marcas"
scp "Marcas/Brasão_de_Roraima.svg.png" "${VPS}:${DEST}/Marcas/"

Write-Host ""
Write-Host "=== Rebuild Docker ===" -ForegroundColor Cyan
ssh ${VPS} "cd ${DEST} && docker compose build --no-cache gabinete-carol && docker compose up -d gabinete-carol"

Write-Host ""
Write-Host "=== Verificando containers ===" -ForegroundColor Cyan
ssh ${VPS} "cd ${DEST} && docker compose ps"

Write-Host ""
Write-Host "Deploy concluido!" -ForegroundColor Green
Write-Host "NOTA: Execute a migration 024_cadin_pdf_cache.sql no Supabase Dashboard manualmente." -ForegroundColor Yellow
