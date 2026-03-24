#!/bin/bash
SECRET=$(grep SYNC_SECRET /opt/gabinete-carol/.env | cut -d= -f2 | tr -d "\r")
echo "Using token: $SECRET"
curl -X POST http://localhost:3000/api/indicacoes/fala-cidadao \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "{}"

