// src/lib/alia/sentinel/collectors/doerr-collector.ts
// DOERR — Diário Oficial do Estado de Roraima
// PDF-based gazette from Imprensa Oficial de Roraima

import type { DiarioCollector, DiarioEntry } from '../collector.interface';

const BASE_URL = 'https://www.imprensaoficial.rr.gov.br';

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function buildPdfUrl(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  // Typical pattern: /diario/{yyyy}/{mm}/{dd}/diario.pdf (adjust when endpoint confirmed)
  return `${BASE_URL}/diario/${yyyy}/${mm}/${dd}/diario.pdf`;
}

export class DoerrCollector implements DiarioCollector {
  readonly source = 'doerr';

  async fetchLatest(date?: Date): Promise<DiarioEntry[]> {
    const target = date ?? new Date();
    const isoDate = toISODate(target);
    const pdfUrl = buildPdfUrl(target);

    try {
      const response = await fetch(pdfUrl, {
        headers: { 'Accept': 'application/pdf, */*' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) return [];

      // In production: pipe response body through pdf-parse to extract text.
      // For now, acknowledge receipt and return a placeholder entry.
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) return [];

      // TODO: replace with: const data = await pdfParse(Buffer.from(buffer));
      const rawText = `[PDF recebido: ${buffer.byteLength} bytes — parsing pendente]`;

      return [{
        source: this.source,
        date: isoDate,
        rawText,
        url: pdfUrl,
        section: 'Atos de Pessoal',
      }];
    } catch {
      return [];
    }
  }
}
