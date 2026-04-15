# Configuração Groq API — Módulo Transcrição de Sessões

## Chave API (projeto dedicado)
```
GROQ_API_KEY=<ver .env.local ou .deploy-secrets.ps1>
```

## Modelo utilizado
- **whisper-large-v3-turbo** — transcrição de áudio com timestamps word-level
- Limite: 25MB por arquivo
- Idioma padrão: pt (português)

## Endpoint
```
POST https://api.groq.com/openai/v1/audio/transcriptions
Authorization: Bearer $GROQ_API_KEY
Content-Type: multipart/form-data
```

## Parâmetros obrigatórios
- `file`: arquivo de áudio
- `model`: whisper-large-v3-turbo
- `response_format`: verbose_json
- `timestamp_granularities[]`: word, segment

## Onde adicionar
- **VPS**: `/opt/gv/.env` → `GROQ_API_KEY=<ver .env.local ou .deploy-secrets.ps1>`
- **Local**: `gabinete-carol/.env.local` (se rodar localmente)
