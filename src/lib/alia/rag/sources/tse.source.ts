// src/lib/alia/rag/sources/tse.source.ts
// Fetches jurisprudência from Tribunal Superior Eleitoral.
// Covers: decisões eleitorais, resoluções, acórdãos.
// Full parser TBD — scaffolding with real URLs and graceful failure.

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma, Tribunal } from '../legal-types';

export const tseSource: LegalSource = {
  name: 'TSE',
  baseUrl: 'https://www.tse.jus.br',

  async fetchByTheme(theme, opts) {
    try {
      // TSE jurisprudência search endpoint — returns HTML. Full parsing TBD.
      const url = `${this.baseUrl}/jurisprudencia/pesquisa-de-jurisprudencia?q=${encodeURIComponent(theme)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ALIA-Legal/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return [];
      console.log('[TSE] fetch ok — parser not yet implemented');
      return [];
    } catch (err) {
      console.error('[TSE] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo: TipoNorma, numero: string, ano: number): Promise<LegalDocument | null> {
    // TSE uses acórdãos/resoluções, not numbered laws
    return null;
  },
};
