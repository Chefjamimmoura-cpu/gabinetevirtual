// src/lib/alia/sentinel/collectors/dje-collector.ts
// DJE-RR — Diário da Justiça Eletrônico do Tribunal de Justiça de Roraima
// Targets judicial nominations and appointments

import type { DiarioCollector, DiarioEntry } from '../collector.interface';

const BASE_URL = 'https://www.tjrr.jus.br/diarioJustica';

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function buildDjeUrl(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  // Typical TJRR DJE pattern — confirm exact path from portal
  return `${BASE_URL}/diario.do?action=pesquisar&data=${yyyy}-${mm}-${dd}`;
}

export class DjeCollector implements DiarioCollector {
  readonly source = 'dje';

  async fetchLatest(date?: Date): Promise<DiarioEntry[]> {
    const target = date ?? new Date();
    const isoDate = toISODate(target);
    const djeUrl = buildDjeUrl(target);

    try {
      const response = await fetch(djeUrl, {
        headers: {
          'Accept': 'application/pdf, text/html, */*',
          'User-Agent': 'Mozilla/5.0 (compatible; CADINSentinel/1.0)',
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) return [];

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('application/pdf')) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) return [];

        // TODO: wire up pdf-parse in production
        const rawText = `[PDF recebido: ${buffer.byteLength} bytes — parsing pendente]`;

        return [{
          source: this.source,
          date: isoDate,
          rawText,
          url: djeUrl,
          section: 'Nomeações e Portarias Judiciais',
        }];
      }

      const html = await response.text();
      if (!html || html.trim().length === 0) return [];

      return [{
        source: this.source,
        date: isoDate,
        rawText: html,
        url: djeUrl,
        section: 'DJE-RR',
      }];
    } catch {
      return [];
    }
  }
}
