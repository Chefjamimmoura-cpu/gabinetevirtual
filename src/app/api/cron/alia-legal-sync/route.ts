// src/app/api/cron/alia-legal-sync/route.ts
// GET — Legal knowledge sync cron.
// Modes:
//   ?mode=daily   → súmulas + teses (STF/STJ)
//   ?mode=weekly  → jurisprudência temática (TJRR, TCU, TCE-RR)
//   ?mode=monthly → varredura ampla (LexML + ALE-RR + SAPL)
//   ?mode=bootstrap → initial P0 ingestion (Planalto: CF, LC 95, LRF, etc.)
//   ?source=X     → run only specific source
// Auth: CRON_SECRET bearer token

import { NextResponse } from 'next/server';
import { ingestFromSource, type IngestResult } from '@/lib/alia/rag/legal-ingestor';
import type { LegalSource } from '@/lib/alia/rag/sources/source.interface';

import { saplSource } from '@/lib/alia/rag/sources/sapl.source';
import { planaltoSource } from '@/lib/alia/rag/sources/planalto.source';
import { lexmlSource } from '@/lib/alia/rag/sources/lexml.source';
import { alerrSource } from '@/lib/alia/rag/sources/alerr.source';
import { transparenciaSource } from '@/lib/alia/rag/sources/transparencia.source';
import { stfSource } from '@/lib/alia/rag/sources/stf.source';
import { stjSource } from '@/lib/alia/rag/sources/stj.source';
import { tjrrSource } from '@/lib/alia/rag/sources/tjrr.source';
import { tseSource } from '@/lib/alia/rag/sources/tse.source';
import { tcuSource } from '@/lib/alia/rag/sources/tcu.source';
import { tcerrSource } from '@/lib/alia/rag/sources/tcerr.source';

const GABINETE_ID = process.env.GABINETE_ID!;

const ALL_SOURCES: Record<string, LegalSource> = {
  sapl: saplSource,
  planalto: planaltoSource,
  lexml: lexmlSource,
  alerr: alerrSource,
  transparencia: transparenciaSource,
  stf: stfSource,
  stj: stjSource,
  tjrr: tjrrSource,
  tse: tseSource,
  tcu: tcuSource,
  tcerr: tcerrSource,
};

// Mode → sources + theme mapping
const MODE_CONFIG: Record<string, { sources: string[]; theme: string }> = {
  daily: {
    sources: ['stf', 'stj'],
    theme: 'sumula',
  },
  weekly: {
    sources: ['tjrr', 'tcu', 'tcerr'],
    theme: 'municipio',
  },
  monthly: {
    sources: ['lexml', 'alerr', 'sapl'],
    theme: 'all',
  },
  bootstrap: {
    sources: ['planalto'],
    theme: 'all',
  },
};

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') ?? 'daily';
  const sourceParam = url.searchParams.get('source');
  const themeParam = url.searchParams.get('theme');

  try {
    let sources: string[];
    let theme: string;

    if (sourceParam) {
      // Specific source requested
      if (!ALL_SOURCES[sourceParam]) {
        return NextResponse.json(
          { error: `Unknown source: ${sourceParam}. Available: ${Object.keys(ALL_SOURCES).join(', ')}` },
          { status: 400 },
        );
      }
      sources = [sourceParam];
      theme = themeParam ?? 'all';
    } else {
      // Mode-based
      const config = MODE_CONFIG[mode];
      if (!config) {
        return NextResponse.json(
          { error: `Unknown mode: ${mode}. Available: daily, weekly, monthly, bootstrap` },
          { status: 400 },
        );
      }
      sources = config.sources;
      theme = themeParam ?? config.theme;
    }

    // Run all selected sources in sequence (to avoid hitting rate limits on external APIs)
    const results: IngestResult[] = [];
    for (const sourceName of sources) {
      const source = ALL_SOURCES[sourceName];
      if (!source) continue;
      try {
        const result = await ingestFromSource(source, theme, GABINETE_ID, { limit: 50 });
        results.push(result);
      } catch (err) {
        console.error(`[legal-sync] source ${sourceName} error:`, err);
        results.push({
          source: sourceName,
          documents_fetched: 0,
          chunks_created: 0,
          chunks_upserted: 0,
          errors: [String(err)],
        });
      }
    }

    const summary = {
      ok: true,
      mode,
      theme,
      sources: sources.length,
      total_documents: results.reduce((s, r) => s + r.documents_fetched, 0),
      total_chunks: results.reduce((s, r) => s + r.chunks_created, 0),
      total_upserted: results.reduce((s, r) => s + r.chunks_upserted, 0),
      per_source: results,
      ran_at: new Date().toISOString(),
    };

    return NextResponse.json(summary);
  } catch (err) {
    console.error('[alia-legal-sync] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
