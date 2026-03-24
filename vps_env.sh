#!/bin/bash
# VPS Env script
cd /opt/gabinete-carol
grep -q '^SYNC_SECRET=' .env || echo "SYNC_SECRET=$(openssl rand -hex 32)" >> .env
grep -q '^GABINETE_ID=' .env || echo "GABINETE_ID=f25299db-1c33-45b9-830f-82f6d2d666ef" >> .env
grep -q '^EVOLUTION_API_URL=' .env || echo "EVOLUTION_API_URL=http://76.13.170.230:8080" >> .env
grep -q '^EVOLUTION_API_KEY=' .env || echo "EVOLUTION_API_KEY=azul_evo_2026_K9mXp4vR" >> .env
grep -q '^EVOLUTION_INSTANCE=' .env || echo "EVOLUTION_INSTANCE=gabinete-carol" >> .env
echo "Vars checked and added if missing."
