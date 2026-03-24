/**
 * src/lib/do/pdf-extractor.ts
 * Extrai texto de PDFs de Diários Oficiais e filtra trechos com nomeações.
 * Usa pdf-parse (CommonJS). Requer Node.js runtime (não roda no Edge).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

const NOMEACAO_RE = /\b(nomear|nomeação|nomeado|exonerar|exoneração|exonerado|designar|designação|designado|dispens[ao]r?|destituir|substituir)\b/i;

export interface ExtractResult {
  fullText: string;
  filteredText: string;
  hasAppointments: boolean;
  pageCount: number;
  charCount: number;
}

export async function extractFromUrl(pdfUrl: string): Promise<ExtractResult> {
  const response = await fetch(pdfUrl, {
    signal: AbortSignal.timeout(60_000),
    headers: { 'User-Agent': 'GabineteCarol-DO-Scraper/1.0' },
  });

  if (!response.ok) {
    throw new Error(`PDF fetch falhou: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = await pdfParse(buffer);
  const fullText: string = parsed.text ?? '';

  const paragraphs = fullText
    .split(/\n{2,}/)
    .map((p: string) => p.trim())
    .filter((p: string) => p.length > 20);

  const relevant = paragraphs.filter((p: string) => NOMEACAO_RE.test(p));

  return {
    fullText,
    filteredText: relevant.join('\n\n---\n\n'),
    hasAppointments: relevant.length > 0,
    pageCount: parsed.numpages ?? 0,
    charCount: fullText.length,
  };
}
