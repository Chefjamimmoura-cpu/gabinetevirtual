// src/lib/alia/rag/sources/transparencia.source.ts
// Fetches municipal budget laws (LOA, LDO, PPA) from the Portal da Transparência de Boa Vista.

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma } from '../legal-types';

// Known budget document URLs — populated with actual URLs when the gabinete is configured.
// Key format: '{tipo}_{ano}' for unique lookup by type+year.
const BUDGET_DOCS: Record<string, { url: string; tipo: TipoNorma; ano: number; ementa: string }> = {
  // Example (uncomment and adjust once real URLs are confirmed):
  // 'loa_2025': {
  //   url: 'https://transparencia.boavista.rr.gov.br/loa/2025/lei.pdf',
  //   tipo: 'loa',
  //   ano: 2025,
  //   ementa: 'Lei Orçamentária Anual 2025 — Município de Boa Vista',
  // },
  // 'ldo_2025': {
  //   url: 'https://transparencia.boavista.rr.gov.br/ldo/2025/lei.pdf',
  //   tipo: 'ldo',
  //   ano: 2025,
  //   ementa: 'Lei de Diretrizes Orçamentárias 2025 — Município de Boa Vista',
  // },
  // 'ppa_2022': {
  //   url: 'https://transparencia.boavista.rr.gov.br/ppa/2022-2025/lei.pdf',
  //   tipo: 'ppa',
  //   ano: 2022,
  //   ementa: 'Plano Plurianual 2022-2025 — Município de Boa Vista',
  // },
};

export const transparenciaSource: LegalSource = {
  name: 'Portal Transparência',
  baseUrl: 'https://transparencia.boavista.rr.gov.br',

  async fetchByTheme(theme, opts) {
    const results: LegalDocument[] = [];
    const themeLower = theme.toLowerCase();

    for (const [key, info] of Object.entries(BUDGET_DOCS)) {
      if (themeLower !== 'all' && !info.ementa.toLowerCase().includes(themeLower)) continue;

      try {
        const res = await fetch(info.url, {
          headers: { 'User-Agent': 'ALIA-Legal/1.0' },
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) continue;

        const text = await res.text();
        results.push({
          tipo_norma: info.tipo,
          numero: key,
          ano: info.ano,
          esfera: 'municipal',
          ementa: info.ementa,
          texto_integral: text.slice(0, 100000), // cap size to avoid OOM
          fonte_url: info.url,
          data_publicacao: `${info.ano}-01-01`,
          situacao: 'vigente',
        });
      } catch (err) {
        console.error('[Transparência]', key, 'fetch error:', err);
      }
    }

    return results.slice(0, opts?.limit ?? 20);
  },

  async fetchNorma(tipo, numero, ano) {
    // Match by tipo + ano (budget laws are unique per type per year in this portal)
    for (const [_key, info] of Object.entries(BUDGET_DOCS)) {
      if (info.tipo !== tipo || info.ano !== ano) continue;

      try {
        const res = await fetch(info.url, {
          headers: { 'User-Agent': 'ALIA-Legal/1.0' },
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) return null;

        const text = await res.text();
        return {
          tipo_norma: tipo,
          numero,
          ano,
          esfera: 'municipal',
          ementa: info.ementa,
          texto_integral: text.slice(0, 100000),
          fonte_url: info.url,
          data_publicacao: `${ano}-01-01`,
          situacao: 'vigente',
        };
      } catch (err) {
        console.error('[Transparência] fetchNorma error:', err);
        return null;
      }
    }

    return null;
  },
};
