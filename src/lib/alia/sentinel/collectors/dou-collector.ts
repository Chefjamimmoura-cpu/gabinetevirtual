// src/lib/alia/sentinel/collectors/dou-collector.ts
// DOU — Diário Oficial da União (federal)
// Uses INLABS API (secao=2 = atos de pessoal: nomeações, exonerações)

import type { DiarioCollector, DiarioEntry } from '../collector.interface';

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export class DouCollector implements DiarioCollector {
  readonly source = 'dou';

  async fetchLatest(date?: Date): Promise<DiarioEntry[]> {
    const target = date ?? new Date();
    const dateStr = formatDate(target);
    const isoDate = toISODate(target);
    const url = `https://www.in.gov.br/leiturajornal?secao=2&data=${dateStr}`;

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json, text/html' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) return [];

      const text = await response.text();

      if (!text || text.trim().length === 0) return [];

      return [{
        source: this.source,
        date: isoDate,
        rawText: text,
        url,
        section: 'Seção 2 — Atos de Pessoal',
      }];
    } catch {
      // Network error, timeout, INLABS auth required — return empty gracefully
      return [];
    }
  }
}
