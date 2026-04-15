#!/bin/bash
# ============================================================
# CRON SAPL — DESATIVADO (Plano de Contingência)
# Sync automático desligado para reduzir requests ao SAPL.
# Para sincronizar, use o botão manual na interface.
#
# Para reativar no futuro, descomente as linhas abaixo.
# ============================================================

# SYNC_SECRET=$(grep SYNC_SECRET /opt/gabinete-carol/.env | cut -d= -f2 | tr -d '\r')
# CRONCMD="0 3 * * * curl -s -X POST https://gabinete.wonetechnology.cloud/api/admin/sync-sapl -H \"Authorization: Bearer $SYNC_SECRET\" >> /var/log/sapl-sync.log 2>&1"

# crontab -l > /tmp/cron.txt 2>/dev/null || true
# if ! grep -q "gabinete.wonetechnology.cloud/api/admin/sync-sapl" /tmp/cron.txt; then
#     echo "$CRONCMD" >> /tmp/cron.txt
#     crontab /tmp/cron.txt
#     echo "Crontab configurado com sucesso."
# else
#     echo "Crontab já estava configurado."
# fi

echo "Cron SAPL desativado (plano de contingência). Use sync manual na interface."
