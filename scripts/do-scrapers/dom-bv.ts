/**
 * dom-bv.ts — Scraper do Diário Oficial do Município de Boa Vista (DOM-BV)
 * Portal: https://dombv.boavista.rr.gov.br/
 */

export interface DoEdition {
  source: 'dom-bv';
  date: string;
  pdfUrl: string;
}

/**
 * Retorna a URL do PDF do DOM-BV para uma data.
 * Padrão observado: https://dombv.boavista.rr.gov.br/edicoes/YYYY/MM/dom_YYYYMMDD.pdf
 */
export async function fetchDOMBVEdition(date: Date): Promise<DoEdition | null> {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const candidates = [
    `https://dombv.boavista.rr.gov.br/edicoes/${yyyy}/${mm}/dom_${yyyy}${mm}${dd}.pdf`,
    `https://dombv.boavista.rr.gov.br/edicoes/${yyyy}/dom_${yyyy}${mm}${dd}.pdf`,
    `https://dombv.boavista.rr.gov.br/${yyyy}/${mm}/${dd}/dom.pdf`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'GabineteCarol-DO-Scraper/1.0' },
      });
      if (res.ok && res.headers.get('content-type')?.includes('pdf')) {
        return { source: 'dom-bv', date: dateStr, pdfUrl: url };
      }
    } catch {
      // tenta próximo
    }
  }

  return null;
}
