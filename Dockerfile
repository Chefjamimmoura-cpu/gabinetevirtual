FROM node:20-alpine AS base

# ── Stage 1: instalar dependências ──────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: build ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variáveis públicas precisam estar presentes no build do Next.js
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: imagem de produção (standalone) ────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# OCR para extração de matérias de PDFs baseados em imagem (pautas da CMBV)
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-por poppler-utils

COPY --from=builder /app/public ./public

RUN mkdir .next && chown nextjs:nodejs .next

# Standalone inclui apenas o que é necessário para rodar
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Base de conhecimento jurídico (RAG) — necessário para /api/pareceres/gerar
COPY --from=builder --chown=nextjs:nodejs /app/base_conhecimento ./base_conhecimento

# pdfkit: fontes AFM — copiadas para /app e para /ROOT (caminho resolvido pelo Turbopack em runtime)
COPY --from=builder /app/node_modules/pdfkit/js/data ./node_modules/pdfkit/js/data
RUN mkdir -p /ROOT/node_modules/pdfkit/js && \
    cp -r /app/node_modules/pdfkit/js/data /ROOT/node_modules/pdfkit/js/data && \
    chown -R nextjs:nodejs /app/node_modules/pdfkit /ROOT

# Marcas institucionais (brasão, logos) — usadas na capa dos PDFs gerados
COPY --from=builder --chown=nextjs:nodejs /app/Marcas ./Marcas

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
