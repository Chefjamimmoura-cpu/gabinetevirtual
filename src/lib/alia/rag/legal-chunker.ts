// src/lib/alia/rag/legal-chunker.ts
// Parses legal document text into article-level chunks.
// Each Art. X becomes 1 chunk including its parágrafos and incisos.

import type { LegalDocument, LegalChunk, TipoNorma } from './legal-types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface RawArticle {
  artigo: string;
  hierarquia: string;
  texto: string;
}

/**
 * Splits the full legal text into one entry per article.
 * Handles:
 *   "Art. 1º"  "Art. 1"  "Art. 10-A"
 *
 * Also tries to detect the current Título / Capítulo / Seção / Subseção
 * context from the text that precedes each article.
 */
function parseLegalArticles(text: string): RawArticle[] {
  const artRegex = /^Art\.?\s*(\d+[º°]?(?:-[A-Z])?)\.?\s*/gm;

  // Collect hierarchy markers (Título, Capítulo, Seção, Subseção)
  const hierRegex =
    /^(T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O)[^\n]*/gim;

  // Build a flat list of hierarchy markers with their positions
  const hierMarkers: { pos: number; label: string }[] = [];
  let hm: RegExpExecArray | null;
  const hierCopy = new RegExp(hierRegex.source, hierRegex.flags);
  while ((hm = hierCopy.exec(text)) !== null) {
    hierMarkers.push({ pos: hm.index, label: hm[0].trim() });
  }

  /** Returns the last hierarchy marker before `pos` */
  function hierAt(pos: number): string {
    let label = '';
    for (const m of hierMarkers) {
      if (m.pos < pos) label = m.label;
      else break;
    }
    return label;
  }

  // Collect all article matches with their positions
  const matches: { index: number; artigo: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = artRegex.exec(text)) !== null) {
    matches.push({ index: m.index, artigo: m[1] });
  }

  if (matches.length === 0) return [];

  const articles: RawArticle[] = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const rawText = text.slice(start, end).trim();

    articles.push({
      artigo: matches[i].artigo,
      hierarquia: hierAt(start),
      texto: rawText,
    });
  }

  return articles;
}

/** Normalise tipo_norma + numero + ano into a human-readable document label. */
function buildDocumentoLabel(doc: LegalDocument): string {
  const tipoMap: Partial<Record<TipoNorma, string>> = {
    constituicao: 'Constituição Federal',
    lei: 'Lei',
    lc: 'Lei Complementar',
    lei_ordinaria: 'Lei Ordinária',
    lei_organica: 'Lei Orgânica',
    decreto: 'Decreto',
    resolucao: 'Resolução',
    portaria: 'Portaria',
    regimento: 'Regimento',
    sumula: 'Súmula',
    sumula_vinculante: 'Súmula Vinculante',
    acordao: 'Acórdão',
    tema_repetitivo: 'Tema Repetitivo',
    loa: 'LOA',
    ldo: 'LDO',
    ppa: 'PPA',
    lrf: 'LRF',
  };

  const tipo = tipoMap[doc.tipo_norma] ?? doc.tipo_norma;
  if (!doc.numero) return `${tipo} ${doc.ano}`;
  return `${tipo} ${doc.numero}/${doc.ano}`;
}

/**
 * Extracts a simple tema_principal from the first few meaningful words
 * of the article text (ignores "Art. Xº" header and short stop-words).
 */
function extractTemaPrincipal(texto: string): string {
  const stopWords = new Set([
    'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'a', 'o', 'as', 'os',
    'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'sem', 'se',
    'que', 'ao', 'à', 'um', 'uma', 'uns', 'umas', 'art',
  ]);

  const words = texto
    .replace(/^Art\.?\s*\d+[º°]?(?:-[A-Z])?\.?\s*/i, '') // strip header
    .split(/\s+/)
    .map(w => w.replace(/[^a-záàâãéèêíïóôõöúüçñ]/gi, ''))
    .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()));

  return words.slice(0, 4).join(' ');
}

/**
 * Extracts unique keywords from the article text.
 * Simple heuristic: unique tokens longer than 4 chars, lowercased,
 * excluding common stop-words and the article header.
 */
function extractPalavrasChave(texto: string): string[] {
  const stopWords = new Set([
    'para', 'pela', 'pelo', 'pelos', 'pelas', 'como', 'quando', 'onde',
    'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas',
    'aquele', 'aquela', 'aqueles', 'aquelas', 'será', 'serão', 'sendo',
    'foram', 'sejam', 'seja', 'pode', 'podem', 'deve', 'devem', 'deverá',
    'deverão', 'fazer', 'feito', 'feita', 'entre', 'sobre', 'artigo',
    'inciso', 'parágrafo', 'alínea', 'dispõe', 'disposto',
  ]);

  const seen = new Set<string>();
  const keywords: string[] = [];

  const tokens = texto
    .replace(/^Art\.?\s*\d+[º°]?(?:-[A-Z])?\.?\s*/i, '')
    .split(/\s+/);

  for (const token of tokens) {
    const word = token
      .replace(/[^a-záàâãéèêíïóôõöúüçñ]/gi, '')
      .toLowerCase();

    if (word.length > 4 && !stopWords.has(word) && !seen.has(word)) {
      seen.add(word);
      keywords.push(word);
    }
  }

  return keywords;
}

/**
 * Detects references to other articles within the text.
 * e.g. "Art. 5º", "Art. 37", "art. 10-A"
 */
function extractArtigosRelacionados(texto: string): string[] {
  const refs = new Set<string>();
  const refRegex = /Art\.?\s*(\d+[º°]?(?:-[A-Z])?)/gi;
  let match: RegExpExecArray | null;

  while ((match = refRegex.exec(texto)) !== null) {
    refs.add(`Art. ${match[1]}`);
  }

  // Remove the article's own number if present (first occurrence is self-reference)
  return Array.from(refs);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Splits a legal document into one LegalChunk per article.
 *
 * If no articles are detected (e.g. a súmula), returns a single chunk
 * covering the entire text — see also `chunkSumula` for that case.
 */
export function chunkLegalDocument(doc: LegalDocument): LegalChunk[] {
  const rawArticles = parseLegalArticles(doc.texto_integral);
  const documento = buildDocumentoLabel(doc);
  const vigente = doc.situacao === 'vigente';

  // No articles found — treat entire text as a single chunk
  if (rawArticles.length === 0) {
    return [
      {
        documento,
        tipo_norma: doc.tipo_norma,
        hierarquia: '',
        artigo: 'único',
        dispositivo_completo: 'Art. único',
        texto: doc.texto_integral,
        tema_principal: extractTemaPrincipal(doc.texto_integral),
        temas_secundarios: [],
        palavras_chave: extractPalavrasChave(doc.texto_integral),
        artigos_relacionados: extractArtigosRelacionados(doc.texto_integral),
        vigente,
        tribunal: doc.tribunal,
        esfera: doc.esfera,
        fonte_url: doc.fonte_url,
      },
    ];
  }

  return rawArticles.map((raw): LegalChunk => {
    const dispositivoCompleto = `Art. ${raw.artigo}`;

    // Self-references pollute artigos_relacionados — filter them out
    const todosRefs = extractArtigosRelacionados(raw.texto);
    const artigos_relacionados = todosRefs.filter(
      r => r !== dispositivoCompleto && r !== `Art. ${raw.artigo}º`,
    );

    return {
      documento,
      tipo_norma: doc.tipo_norma,
      hierarquia: raw.hierarquia,
      artigo: raw.artigo,
      dispositivo_completo: dispositivoCompleto,
      texto: raw.texto,
      tema_principal: extractTemaPrincipal(raw.texto),
      temas_secundarios: [],
      palavras_chave: extractPalavrasChave(raw.texto),
      artigos_relacionados,
      vigente,
      tribunal: doc.tribunal,
      esfera: doc.esfera,
      fonte_url: doc.fonte_url,
    };
  });
}

/**
 * Creates a single LegalChunk for a súmula (or any short enunciado).
 * Súmulas have no articles — the full text is the chunk.
 */
export function chunkSumula(doc: LegalDocument): LegalChunk {
  const documento = buildDocumentoLabel(doc);

  return {
    documento,
    tipo_norma: doc.tipo_norma,
    hierarquia: '',
    artigo: 'único',
    dispositivo_completo: documento,
    texto: doc.texto_integral,
    tema_principal: extractTemaPrincipal(doc.texto_integral),
    temas_secundarios: [],
    palavras_chave: extractPalavrasChave(doc.texto_integral),
    artigos_relacionados: [],
    vigente: doc.situacao === 'vigente',
    tribunal: doc.tribunal,
    esfera: doc.esfera,
    fonte_url: doc.fonte_url,
  };
}
