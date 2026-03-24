/**
 * doerr.ts — Scraper do Diário Oficial do Estado de Roraima (DOERR)
 * Portal: https://www.doe.rr.gov.br/
 * Estratégia: tenta URL padrão para a data solicitada.
 */

export interface DoEdition {
  source: 'doerr';
  date: string;   // YYYY-MM-DD
  pdfUrl: string;
}

/**
 * Retorna a URL do PDF do DOERR para uma data.
 * Padrão observado: https://www.doe.rr.gov.br/doe/YYYY/MM/DD/doe_YYYYMMDD.pdf
 * Faz HEAD request para confirmar existência antes de retornar.
 */
export async function fetchDOERREdition(date: Date): Promise<DoEdition | null> {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // Padrões de URL conhecidos do DOERR (testar em ordem)
  const candidates = [
    `https://www.doe.rr.gov.br/doe/${yyyy}/${mm}/${dd}/doe_${yyyy}${mm}${dd}.pdf`,
    `https://www.doe.rr.gov.br/doe/${yyyy}${mm}${dd}.pdf`,
    `https://diariooficial.rr.gov.br/portal/do/${yyyy}/${mm}/doe_${yyyy}${mm}${dd}.pdf`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'GabineteCarol-DO-Scraper/1.0' },
      });
      if (res.ok && res.headers.get('content-type')?.includes('pdf')) {
        return { source: 'doerr', date: dateStr, pdfUrl: url };
      }
    } catch {
      // tenta próximo candidato
    }
  }

  return null; // edição não encontrada para essa data
}
