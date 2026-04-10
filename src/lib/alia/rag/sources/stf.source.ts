// src/lib/alia/rag/sources/stf.source.ts
// Fetches jurisprudência from Supremo Tribunal Federal.
// Covers: Súmulas Vinculantes, Súmulas regulares, Teses de Repercussão Geral.
// Full parser TBD — scaffolding with real URLs and graceful failure.

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma, Tribunal } from '../legal-types';

export const stfSource: LegalSource = {
  name: 'STF',
  baseUrl: 'https://portal.stf.jus.br',

  async fetchByTheme(theme, opts) {
    try {
      // STF search endpoint — returns HTML. Full parsing TBD.
      const url = `${this.baseUrl}/servicos/busca?q=${encodeURIComponent(theme)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ALIA-Legal/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return [];
      console.log('[STF] fetch ok — parser not yet implemented');
      return [];
    } catch (err) {
      console.error('[STF] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo: TipoNorma, numero: string, ano: number): Promise<LegalDocument | null> {
    // STF uses súmulas/acórdãos, not numbered laws
    return null;
  },
};
