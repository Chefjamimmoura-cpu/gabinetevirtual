// src/lib/alia/sentinel/collectors/tse-collector.ts
// TSE — Tribunal Superior Eleitoral
// Monitors party changes, cassations, and electoral decisions via TSE API / RSS

import type { DiarioCollector, DiarioEntry } from '../collector.interface';

// TSE DJE RSS / search endpoint (adjust to confirmed TSE Open Data URL)
const TSE_DJE_RSS = 'https://www.tse.jus.br/comunicacao/rss/noticias-dje.xml';
const TSE_API_BASE = 'https://api.tse.jus.br/tse/api';

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function tryRss(isoDate: string): Promise<DiarioEntry | null> {
  const response = await fetch(TSE_DJE_RSS, {
    headers: { 'Accept': 'application/rss+xml, text/xml, */*' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return null;

  const xml = await response.text();
  if (!xml || xml.trim().length === 0) return null;

  return {
    source: 'tse',
    date: isoDate,
    rawText: xml,
    url: TSE_DJE_RSS,
    section: 'Diário da Justiça Eleitoral — RSS',
  };
}

async function tryApi(date: Date, isoDate: string): Promise<DiarioEntry | null> {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const apiUrl = `${TSE_API_BASE}/dje?data=${yyyy}-${mm}-${dd}`;

  const response = await fetch(apiUrl, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return null;

  const json = await response.text();
  if (!json || json.trim().length === 0) return null;

  return {
    source: 'tse',
    date: isoDate,
    rawText: json,
    url: apiUrl,
    section: 'TSE API — Mudanças Partidárias / Cassações',
  };
}

export class TseCollector implements DiarioCollector {
  readonly source = 'tse';

  async fetchLatest(date?: Date): Promise<DiarioEntry[]> {
    const target = date ?? new Date();
    const isoDate = toISODate(target);

    try {
      // Try API first, fall back to RSS
      const apiEntry = await tryApi(target, isoDate).catch(() => null);
      if (apiEntry) return [apiEntry];

      const rssEntry = await tryRss(isoDate).catch(() => null);
      if (rssEntry) return [rssEntry];

      return [];
    } catch {
      return [];
    }
  }
}
