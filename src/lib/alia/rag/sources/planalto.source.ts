// src/lib/alia/rag/sources/planalto.source.ts
// Fetches federal laws from planalto.gov.br.
// Uses targeted scraping for specific laws (CF/88, LC 95, LRF, etc.).

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma } from '../legal-types';

// Known legal URLs for P0 priority documents
const KNOWN_LAWS: Record<string, { url: string; tipo: TipoNorma; ementa: string }> = {
  'cf_1988': {
    url: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
    tipo: 'constituicao',
    ementa: 'Constituição da República Federativa do Brasil de 1988',
  },
  'lc_95_1998': {
    url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp95.htm',
    tipo: 'lc',
    ementa: 'Técnica legislativa — elaboração, redação, alteração e consolidação das leis',
  },
  'lc_101_2000': {
    url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp101.htm',
    tipo: 'lrf',
    ementa: 'Lei de Responsabilidade Fiscal',
  },
  'lei_4320_1964': {
    url: 'https://www.planalto.gov.br/ccivil_03/leis/l4320.htm',
    tipo: 'lei',
    ementa: 'Normas Gerais de Direito Financeiro',
  },
  'lei_14133_2021': {
    url: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14133.htm',
    tipo: 'lei',
    ementa: 'Nova Lei de Licitações e Contratos Administrativos',
  },
};

async function fetchAndStripHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ALIA-Legal-Ingestor/1.0' },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    // Strip HTML tags and normalize whitespace
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  } catch (err) {
    console.error('[Planalto] fetch error:', err);
    return '';
  }
}

export const planaltoSource: LegalSource = {
  name: 'Planalto',
  baseUrl: 'https://www.planalto.gov.br',

  async fetchByTheme(theme, opts) {
    // For Planalto we return the known P0 laws filtered by theme keywords
    const results: LegalDocument[] = [];
    const themeLower = theme.toLowerCase();

    for (const [key, info] of Object.entries(KNOWN_LAWS)) {
      if (!info.ementa.toLowerCase().includes(themeLower) && themeLower !== 'all') continue;

      const texto = await fetchAndStripHtml(info.url);
      if (!texto) continue;

      const match = key.match(/(.+)_(\d+)_(\d+)/);
      results.push({
        tipo_norma: info.tipo,
        numero: match?.[2] ?? key,
        ano: Number(match?.[3] ?? new Date().getFullYear()),
        esfera: 'federal',
        ementa: info.ementa,
        texto_integral: texto,
        fonte_url: info.url,
        data_publicacao: `${match?.[3] ?? '1988'}-01-01`,
        situacao: 'vigente',
      });
    }

    return results.slice(0, opts?.limit ?? 50);
  },

  async fetchNorma(tipo, numero, ano) {
    const key = `${tipo}_${numero}_${ano}`;
    const info = KNOWN_LAWS[key];
    if (!info) return null;

    const texto = await fetchAndStripHtml(info.url);
    if (!texto) return null;

    return {
      tipo_norma: tipo,
      numero,
      ano,
      esfera: 'federal',
      ementa: info.ementa,
      texto_integral: texto,
      fonte_url: info.url,
      data_publicacao: `${ano}-01-01`,
      situacao: 'vigente',
    };
  },
};
