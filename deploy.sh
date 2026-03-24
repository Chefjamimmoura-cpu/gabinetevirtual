#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Deploy: gabinete-carol → VPS 76.13.170.230
#
# Uso:
#   ./deploy.sh              → deploy completo (rsync + build + restart)
#   ./deploy.sh --restart    → apenas restart (sem rebuild, deploy anterior OK)
#
# Pré-requisitos locais:
#   - SSH key configurada para root@76.13.170.230
#   - .env criado na VPS em /opt/gabinete-carol/.env (a partir de .env.example)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VPS_HOST="76.13.170.230"
VPS_USER="root"
REMOTE_DIR="/opt/gabinete-carol"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }

# ── Modo: apenas restart ─────────────────────────────────────────────────────
if [[ "${1:-}" == "--restart" ]]; then
  log "Reiniciando gabinete-carol na VPS..."
  ssh "${VPS_USER}@${VPS_HOST}" "cd ${REMOTE_DIR} && docker compose restart gabinete-carol"
  log "Pronto!"
  exit 0
fi

# ── Deploy completo ───────────────────────────────────────────────────────────
log "Sincronizando arquivos para VPS..."
rsync -avz --progress \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude '*.local' \
  "${LOCAL_DIR}/" "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/"

log "Fazendo build e subindo container na VPS..."
ssh "${VPS_USER}@${VPS_HOST}" bash << REMOTE
  set -euo pipefail
  cd ${REMOTE_DIR}

  # Verifica que .env existe
  if [ ! -f .env ]; then
    echo "ERRO: .env não encontrado em ${REMOTE_DIR}/.env"
    echo "Copie .env.example para .env e preencha as variáveis."
    exit 1
  fi

  # Build + up
  docker compose build --no-cache
  docker compose up -d

  echo ""
  echo "=== Status dos containers ==="
  docker compose ps
REMOTE

log "Deploy concluído → https://gabinete.wonetechnology.cloud"
