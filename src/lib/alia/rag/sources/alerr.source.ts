// src/lib/alia/rag/sources/alerr.source.ts
// Fetches state legislation from ALE-RR (Assembleia Legislativa de Roraima).

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma } from '../legal-types';

export const alerrSource: LegalSource = {
  name: 'ALE-RR',
  baseUrl: 'https://www.al.rr.leg.br',

  async fetchByTheme(theme, opts) {
    try {
      const url = `${this.baseUrl}/legislacao/busca?q=${encodeURIComponent(theme)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ALIA-Legal/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return [];

      // Placeholder: ALE-RR search returns HTML; structured scraping deferred.
      console.log('[ALE-RR] fetch succeeded but HTML parser not yet implemented');
      return [];
    } catch (err) {
      console.error('[ALE-RR] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo, numero, ano) {
    try {
      // ALE-RR does not expose a stable REST API for direct law lookup by number/year.
      // Direct URL pattern to be confirmed with site structure before implementing.
      return null;
    } catch (err) {
      console.error('[ALE-RR] fetchNorma error:', err);
      return null;
    }
  },
};
