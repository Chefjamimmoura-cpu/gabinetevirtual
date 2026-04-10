// src/lib/alia/rag/sources/tcu.source.ts
// Fetches jurisprudência from Tribunal de Contas da União.
// Covers: acórdãos sobre licitações, orçamento, controle externo.
// Full parser TBD — scaffolding with real URLs and graceful failure.

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma, Tribunal } from '../legal-types';

export const tcuSource: LegalSource = {
  name: 'TCU',
  baseUrl: 'https://pesquisa.apps.tcu.gov.br',

  async fetchByTheme(theme, opts) {
    try {
      // TCU Juris search API — returns JSON. Full parsing TBD.
      const url = `${this.baseUrl}/#/pesquisa/jurisprudencia?q=${encodeURIComponent(theme)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ALIA-Legal/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return [];
      console.log('[TCU] fetch ok — parser not yet implemented');
      return [];
    } catch (err) {
      console.error('[TCU] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo: TipoNorma, numero: string, ano: number): Promise<LegalDocument | null> {
    // TCU uses acórdãos numerados — future implementation will query by number
    return null;
  },
};
