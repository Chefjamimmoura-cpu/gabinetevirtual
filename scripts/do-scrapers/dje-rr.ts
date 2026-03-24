/**
 * dje-rr.ts — Scraper do Diário da Justiça Eletrônico de Roraima (DJE-RR)
 * Portal: https://www.tjrr.jus.br/index.php/dje
 * Relevância: nomeações de servidores do TJ e do MP que aparecem no CADIN.
 */

export interface DoEdition {
  source: 'dje-rr';
  date: string;
  pdfUrl: string;
}

/**
 * Retorna a URL do PDF do DJE-RR para uma data.
 */
export async function fetchDJERREdition(date: Date): Promise<DoEdition | null> {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const candidates = [
    `https://www.tjrr.jus.br/dje/${yyyy}/${mm}/dje_${yyyy}${mm}${dd}.pdf`,
    `https://www.tjrr.jus.br/dje/diario/${yyyy}${mm}${dd}.pdf`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'GabineteCarol-DO-Scraper/1.0' },
      });
      if (res.ok && res.headers.get('content-type')?.includes('pdf')) {
        return { source: 'dje-rr', date: dateStr, pdfUrl: url };
      }
    } catch {
      // tenta próximo
    }
  }

  return null;
}
