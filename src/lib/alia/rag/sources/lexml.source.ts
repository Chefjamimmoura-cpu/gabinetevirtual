// src/lib/alia/rag/sources/lexml.source.ts
// Fetches federal and state legislation from LexML (legislação brasileira unificada).

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma } from '../legal-types';

export const lexmlSource: LegalSource = {
  name: 'LexML',
  baseUrl: 'https://www.lexml.gov.br',

  async fetchByTheme(theme, opts) {
    try {
      // LexML exposes a search endpoint that returns XML/HTML results.
      // Full XML schema parsing (LexML-BR ABNT NBR 22402) is deferred to a follow-up task.
      const url = `${this.baseUrl}/busca/search?keyword=${encodeURIComponent(theme)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ALIA-Legal/1.0', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return [];

      // Placeholder: fetch confirmed reachable; parser not yet implemented.
      console.log('[LexML] fetch succeeded but XML/HTML parser not yet implemented');
      return [];
    } catch (err) {
      console.error('[LexML] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo, numero, ano) {
    try {
      // LexML URN format: urn:lex:br:federal:lei:{ano}-{mm}-{dd};{numero}
      // Specific lookup deferred — requires resolving publication date from metadata.
      return null;
    } catch (err) {
      console.error('[LexML] fetchNorma error:', err);
      return null;
    }
  },
};
