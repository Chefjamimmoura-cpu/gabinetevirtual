// src/lib/alia/rag/sources/stj.source.ts
// Fetches jurisprudência from Superior Tribunal de Justiça.
// Covers: Súmulas, Temas Repetitivos.
// Full parser TBD — scaffolding with real URLs and graceful failure.

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma, Tribunal } from '../legal-types';

export const stjSource: LegalSource = {
  name: 'STJ',
  baseUrl: 'https://scon.stj.jus.br',

  async fetchByTheme(theme, opts) {
    try {
      // STJ SCON search endpoint — returns HTML. Full parsing TBD.
      const url = `${this.baseUrl}/SCON/pesquisar.jsp?b=ACOR&livre=${encodeURIComponent(theme)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ALIA-Legal/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return [];
      console.log('[STJ] fetch ok — parser not yet implemented');
      return [];
    } catch (err) {
      console.error('[STJ] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo: TipoNorma, numero: string, ano: number): Promise<LegalDocument | null> {
    // STJ uses súmulas/acórdãos, not numbered laws
    return null;
  },
};
