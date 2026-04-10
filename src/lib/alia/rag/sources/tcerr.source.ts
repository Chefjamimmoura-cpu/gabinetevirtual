// src/lib/alia/rag/sources/tcerr.source.ts
// Fetches jurisprudência from Tribunal de Contas do Estado de Roraima.
// Covers: decisões de controle externo estadual, auditorias, acórdãos.
// Full parser TBD — scaffolding with real URLs and graceful failure.

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma, Tribunal } from '../legal-types';

export const tcerrSource: LegalSource = {
  name: 'TCE-RR',
  baseUrl: 'https://www.tce.rr.gov.br',

  async fetchByTheme(theme, opts) {
    try {
      // TCE-RR jurisprudência search — returns HTML. Full parsing TBD.
      const url = `${this.baseUrl}/jurisprudencia?search=${encodeURIComponent(theme)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ALIA-Legal/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return [];
      console.log('[TCE-RR] fetch ok — parser not yet implemented');
      return [];
    } catch (err) {
      console.error('[TCE-RR] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo: TipoNorma, numero: string, ano: number): Promise<LegalDocument | null> {
    // TCE-RR uses acórdãos estaduais — future implementation will query by number
    return null;
  },
};
