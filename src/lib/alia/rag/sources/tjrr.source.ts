// src/lib/alia/rag/sources/tjrr.source.ts
// Fetches jurisprudência from Tribunal de Justiça do Estado de Roraima.
// Covers: acórdãos e decisões estaduais.
// Full parser TBD — scaffolding with real URLs and graceful failure.

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma, Tribunal } from '../legal-types';

export const tjrrSource: LegalSource = {
  name: 'TJRR',
  baseUrl: 'https://www.tjrr.jus.br',

  async fetchByTheme(theme, opts) {
    try {
      // TJRR jurisprudência search — returns HTML. Full parsing TBD.
      const url = `${this.baseUrl}/juris/detalhes.asp?pesquisa=${encodeURIComponent(theme)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ALIA-Legal/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return [];
      console.log('[TJRR] fetch ok — parser not yet implemented');
      return [];
    } catch (err) {
      console.error('[TJRR] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo: TipoNorma, numero: string, ano: number): Promise<LegalDocument | null> {
    // TJRR uses acórdãos, not numbered laws
    return null;
  },
};
