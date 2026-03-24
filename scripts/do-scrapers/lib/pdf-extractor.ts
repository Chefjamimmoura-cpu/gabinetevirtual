/**
 * pdf-extractor.ts
 * Baixa PDF de uma URL, extrai texto bruto e filtra trechos com nomeações.
 * Usa pdf-parse (CommonJS). Não faz chunking — janela de 1M tokens do Gemini Flash
 * é suficiente para D.O. de câmara municipal (~200 páginas).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

const NOMEACAO_RE = /\b(nomear|nomeação|nomeado|exonerar|exoneração|exonerado|designar|designação|designado|dispens[ao]r?|destituir|substituir)\b/i;

export interface ExtractResult {
  fullText: string;
  filteredText: string;        // apenas parágrafos com nomeações
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
    throw new Error(`PDF fetch falhou: ${response.status} ${response.statusText} — ${pdfUrl}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = await pdfParse(buffer);
  const fullText: string = parsed.text ?? '';

  // Divide em parágrafos e filtra os que têm vocabulário de nomeação
  const paragraphs = fullText
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 20);

  const relevant = paragraphs.filter(p => NOMEACAO_RE.test(p));

  return {
    fullText,
    filteredText: relevant.join('\n\n---\n\n'),
    hasAppointments: relevant.length > 0,
    pageCount: parsed.numpages ?? 0,
    charCount: fullText.length,
  };
}
