// src/lib/alia/sentinel/collectors/dombv-collector.ts
// DOMBV — Diário Oficial do Município de Boa Vista
// PDF-based gazette from Prefeitura de Boa Vista

import type { DiarioCollector, DiarioEntry } from '../collector.interface';

const BASE_URL = 'https://www.boavista.rr.gov.br/diariooficial';

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function buildSearchUrl(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  // Typical listing pattern — adjust to confirmed endpoint
  return `${BASE_URL}/${yyyy}/${mm}/${dd}`;
}

export class DombvCollector implements DiarioCollector {
  readonly source = 'dombv';

  async fetchLatest(date?: Date): Promise<DiarioEntry[]> {
    const target = date ?? new Date();
    const isoDate = toISODate(target);
    const listUrl = buildSearchUrl(target);

    try {
      const response = await fetch(listUrl, {
        headers: { 'Accept': 'application/pdf, text/html, */*' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) return [];

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('application/pdf')) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) return [];

        // TODO: replace with pdf-parse in production
        const rawText = `[PDF recebido: ${buffer.byteLength} bytes — parsing pendente]`;

        return [{
          source: this.source,
          date: isoDate,
          rawText,
          url: listUrl,
          section: 'Atos de Pessoal',
        }];
      }

      // HTML listing — extract PDF link (production: parse DOM for .pdf hrefs)
      const html = await response.text();
      if (!html || html.trim().length === 0) return [];

      return [{
        source: this.source,
        date: isoDate,
        rawText: html,
        url: listUrl,
        section: 'Listagem DOMBV',
      }];
    } catch {
      return [];
    }
  }
}
