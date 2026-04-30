// ══════════════════════════════════════════════════════════
// PAUTA PARSER — Extração estruturada da Ordem do Dia (CMBV)
//
// Resolve o problema fundamental: a extração simples por links /materia/ID
// PERDE o contexto de bloco e de "PARECER CONTRÁRIO DA COMISSÃO".
//
// A pauta da CMBV tem 3 blocos visuais:
//   • EM ÚNICA DISCUSSÃO E VOTAÇÃO       (PDLs + pareceres contrários)
//   • EM SEGUNDA DISCUSSÃO E VOTAÇÃO     (PLLs em 2º turno)
//   • EM PRIMEIRA DISCUSSÃO E VOTAÇÃO    (PLLs em 1º turno)
//
// Dentro do bloco ÚNICA, alguns itens são VOTOS SOBRE PARECER CONTRÁRIO
// emitido pela CLJRF — não votação direta sobre o PLL. O texto típico é:
//   "4. PARECER CONTRÁRIO DA COMISSÃO DE LEGISLAÇÃO E JUSTIÇA AO
//       PROJETO DE LEI DO LEGISLATIVO Nº 24/2024"
//
// Essa flag muda completamente a recomendação de voto:
//   - Item normal:   o gabinete avalia o mérito do PL.
//   - Parecer contr.: o gabinete tipicamente acompanha a comissão (FAVORÁVEL
//                     ao parecer contrário) — análise de constitucionalidade
//                     já foi feita pela comissão competente.
// ══════════════════════════════════════════════════════════

import { extractTextFromPdfBuffer } from './ocr';

export type PautaBloco = 'UNICA' | 'SEGUNDA' | 'PRIMEIRA';

export interface PautaItem {
  numeroOrdem: number;
  bloco: PautaBloco;
  isParecerContrario: boolean;
  tipo: string;   // PDL, PLL, PLC, ...
  numero: number;
  ano: number;
}

export interface PautaItemMeta {
  bloco: PautaBloco;
  isParecerContrario: boolean;
  numeroOrdem: number;
}

const BLOCO_LABEL: Record<PautaBloco, string> = {
  UNICA: 'ÚNICA DISCUSSÃO E VOTAÇÃO',
  SEGUNDA: 'SEGUNDA DISCUSSÃO E VOTAÇÃO',
  PRIMEIRA: 'PRIMEIRA DISCUSSÃO E VOTAÇÃO',
};

export function blocoLabel(bloco: PautaBloco, isParecerContrario: boolean): string {
  if (isParecerContrario) {
    return `${BLOCO_LABEL.UNICA} (PARECER CONTRÁRIO DA COMISSÃO)`;
  }
  return BLOCO_LABEL[bloco];
}

/**
 * Mapeia o texto do "PROJETO DE [tipo] DO LEGISLATIVO" para a sigla SAPL.
 * Cobre os tipos efetivamente usados na CMBV.
 */
function tipoTextoToSigla(texto: string): string | null {
  const upper = texto.toUpperCase();
  if (upper.includes('DECRETO LEGISLATIVO')) return 'PDL';
  if (upper.includes('LEI COMPLEMENTAR')) return 'PLC';
  if (upper.includes('LEI DO LEGISLATIVO')) return 'PLL';
  // Tolera mojibake em "RESOLUÇÃO" → "RESOLU??O"
  if (/RESOLU\S{1,3}\S{0,3}O/.test(upper)) return 'PRE';
  // "EMENDA [À] LEI [ORGÂNICA]" — prefixo + "LEI" basta
  if (upper.includes('EMENDA') && upper.includes('LEI')) return 'PELOM';
  return null;
}

/**
 * Parser principal — recebe o texto extraído do PDF (via pdftotext)
 * e retorna a sequência ordenada de itens da pauta.
 */
export function parsePautaText(text: string): PautaItem[] {
  if (!text) return [];

  // Normaliza: remove múltiplos espaços/quebras para facilitar regex multilinha,
  // mas preserva quebras de linha (úteis para detectar início de item).
  const normalized = text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ');

  // ── 1. Localiza posições de cada bloco ──
  // Tolera mojibake nos acentos: PDFs CMBV descomprimem com encoding customizado
  // que vira `` para `Ú`, `Ã`, `Ç`. Usa \S{1,3} nas posições afetadas.
  // Para "ÚNICA": o `Ú` pode virar 1-3 chars não-espaço; aceitamos `\S{0,3}NICA`.
  const blocoRegex = /EM\s+(\S{0,3}NICA|UNICA|SEGUNDA|PRIMEIRA)\s+DISCUSS\S{1,3}O\s+E\s+VOTA\S{1,3}O/gi;
  const blocoEvents: Array<{ pos: number; bloco: PautaBloco }> = [];
  let bm: RegExpExecArray | null;
  while ((bm = blocoRegex.exec(normalized)) !== null) {
    const tag = bm[1].toUpperCase();
    let bloco: PautaBloco;
    if (tag.startsWith('SEGUND')) bloco = 'SEGUNDA';
    else if (tag.startsWith('PRIMEIR')) bloco = 'PRIMEIRA';
    else bloco = 'UNICA';
    blocoEvents.push({ pos: bm.index, bloco });
  }

  // ── 2. Localiza referências a matérias dentro do texto ──
  // Padrão CMBV: "PROJETO DE [TIPO] [DO LEGISLATIVO] Nº X/YYYY"
  // O "º" frequentemente vira mojibake — aceitamos qualquer sequência curta entre
  // "N" e o número da matéria. O grupo do tipo aceita ASCII e não-espaços (mojibake).
  const materiaRegex = /PROJETO\s+DE\s+([A-Z][A-Z\s\S]{0,60}?)\s+N\S{0,3}\s*(\d+)\s*\/\s*(\d{4})/gi;
  const materiaEvents: Array<{
    pos: number;
    tipoTexto: string;
    numero: number;
    ano: number;
  }> = [];
  let mm: RegExpExecArray | null;
  while ((mm = materiaRegex.exec(normalized)) !== null) {
    materiaEvents.push({
      pos: mm.index,
      tipoTexto: mm[1].trim(),
      numero: parseInt(mm[2], 10),
      ano: parseInt(mm[3], 10),
    });
  }

  // ── 3. Localiza prefixos "PARECER CONTRÁRIO DA COMISSÃO ... AO PROJETO" ──
  // O texto da comissão pode quebrar linha entre "JUSTIÇA" e "AO PROJETO".
  // Tolera mojibake em "CONTRÁRIO" e "COMISSÃO" via \S{1,3}.
  const parecerContraRegex = /PARECER\s+CONTR\S{1,3}RIO\s+DA\s+COMISS\S{1,3}O[\s\S]{1,200}?\s+AO\s+PROJETO/gi;
  const parecerEvents: Array<{ pos: number; end: number }> = [];
  let pm: RegExpExecArray | null;
  while ((pm = parecerContraRegex.exec(normalized)) !== null) {
    parecerEvents.push({ pos: pm.index, end: pm.index + pm[0].length });
  }

  // ── 4. Combina eventos em ordem de leitura ──
  // Para cada matéria detectada, determinar:
  //   • bloco atual (último blocoEvent antes da posição da matéria)
  //   • isParecerContrario (existe parecerEvent que termina logo antes da posição da matéria
  //     E está no MESMO bloco, ou seja, sem blocoEvent entre eles)
  const items: PautaItem[] = [];
  const seenKeys = new Set<string>();
  let numeroOrdem = 0;

  for (const me of materiaEvents) {
    const sigla = tipoTextoToSigla(me.tipoTexto);
    if (!sigla) continue;

    // Determina bloco atual
    let bloco: PautaBloco = 'UNICA';
    for (const be of blocoEvents) {
      if (be.pos < me.pos) bloco = be.bloco;
      else break;
    }

    // Detecta parecer contrário: existe parecer cujo "AO PROJETO" termina
    // dentro de uma janela curta antes da posição da matéria E não há outro
    // bloco/matéria entre eles.
    let isParecerContrario = false;
    for (const pe of parecerEvents) {
      // O "AO PROJETO" do parecer-contrário casa imediatamente com a matéria
      // (mesma ocorrência textual). Aceita gap de até 80 chars (espaços/Nº).
      const gap = me.pos - pe.end;
      if (gap >= -50 && gap <= 80) {
        isParecerContrario = true;
        break;
      }
    }

    // Deduplica matéria pelo trio (sigla, numero, ano) — o link costuma
    // aparecer 2x no PDF (uma vez no texto, outra na URL de annotation).
    const key = `${sigla}|${me.numero}|${me.ano}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    numeroOrdem++;
    items.push({
      numeroOrdem,
      bloco,
      isParecerContrario,
      tipo: sigla,
      numero: me.numero,
      ano: me.ano,
    });
  }

  return items;
}

/**
 * Extrai itens estruturados do PDF da pauta.
 * Pipeline: pdftotext → parsePautaText.
 */
export async function extractPautaItems(buf: Buffer): Promise<PautaItem[]> {
  try {
    const text = await extractTextFromPdfBuffer(buf);
    if (!text || text.trim().length < 50) return [];
    return parsePautaText(text);
  } catch {
    return [];
  }
}

/**
 * Faz match dos PautaItem com matérias do SAPL.
 * Retorna mapa materiaId → metadados de pauta.
 */
export function matchPautaToMaterias(
  pautaItems: PautaItem[],
  materias: Array<{ id: number; tipo_sigla?: string; numero: number; ano: number }>,
): Map<number, PautaItemMeta> {
  const result = new Map<number, PautaItemMeta>();

  for (const item of pautaItems) {
    const m = materias.find(
      (mat) =>
        (mat.tipo_sigla || '').toUpperCase() === item.tipo &&
        Number(mat.numero) === item.numero &&
        Number(mat.ano) === item.ano,
    );
    if (m) {
      result.set(m.id, {
        bloco: item.bloco,
        isParecerContrario: item.isParecerContrario,
        numeroOrdem: item.numeroOrdem,
      });
    }
  }

  return result;
}

/**
 * Conveniência: baixa o PDF da pauta + extrai estrutura + faz match.
 * Usado pela rota /api/pareceres/gerar.
 */
export async function fetchAndParsePauta(
  pautaUrl: string,
  saplBase: string,
  materias: Array<{ id: number; tipo_sigla?: string; numero: number; ano: number }>,
): Promise<Map<number, PautaItemMeta>> {
  try {
    const absoluteUrl = pautaUrl.startsWith('http') ? pautaUrl : `${saplBase}${pautaUrl}`;
    const res = await fetch(absoluteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 CMBV-Gabinete/2.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return new Map();
    const buf = Buffer.from(await res.arrayBuffer());
    const items = await extractPautaItems(buf);
    return matchPautaToMaterias(items, materias);
  } catch {
    return new Map();
  }
}
