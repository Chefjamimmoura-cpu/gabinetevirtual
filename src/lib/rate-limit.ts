/**
 * Rate limiter em memória para API routes do Next.js.
 *
 * Uso:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });
 *   // Na rota:
 *   const limited = limiter.check(req);
 *   if (limited) return limited;
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  start: number;
}

interface RateLimiterOptions {
  windowMs: number; // Janela de tempo em ms
  max: number;      // Máximo de requests por janela
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

// Limpar entries expiradas a cada 2 minutos
setInterval(() => {
  const now = Date.now();
  for (const [, store] of stores) {
    for (const [key, entry] of store) {
      if (now - entry.start > 120_000) store.delete(key);
    }
  }
}, 120_000);

export function createRateLimiter(options: RateLimiterOptions) {
  const storeKey = `${options.windowMs}:${options.max}`;
  if (!stores.has(storeKey)) {
    stores.set(storeKey, new Map());
  }
  const store = stores.get(storeKey)!;

  return {
    check(req: NextRequest): NextResponse | null {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')
        || 'unknown';
      const path = new URL(req.url).pathname;
      const key = `${path}:${ip}`;
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || now - entry.start > options.windowMs) {
        store.set(key, { count: 1, start: now });
        return null;
      }

      entry.count++;
      if (entry.count > options.max) {
        return NextResponse.json(
          { error: 'Muitas requisições. Tente novamente em breve.' },
          { status: 429 },
        );
      }

      return null;
    },
  };
}
