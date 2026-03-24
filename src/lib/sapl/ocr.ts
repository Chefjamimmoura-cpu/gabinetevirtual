// ══════════════════════════════════════════════════════════
// OCR — Extração de texto e votos de PDFs da CMBV
// Usa pdftoppm (poppler-utils) + tesseract para ler PDFs
// que são gerados como imagem JPEG (caso da CMBV).
// ══════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { promisify } from 'util';
import { inflateSync, inflateRawSync } from 'zlib';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

// ── Detecção de votos por palavras-chave ─────────────────────
// Padrões utilizados nos pareceres da CMBV (procuradoria + comissões)
const CONTRARY_PATTERNS = [
  'PARECER CONTRÁRIO', 'VOTO CONTRÁRIO', 'CONTRÁRIO AO PROJETO',
  'PELA INCONSTITUCIONALIDADE', 'É INCONSTITUCIONAL', 'INCONSTITUCIONALIDADE',
  'REJEIÇÃO DO PROJETO', 'PELO ARQUIVAMENTO', 'ARQUIVAMENTO DO PROJETO',
  'DESFAVORÁVEL', 'VOTAÇÃO: CONTRÁRIO', 'VOTO: CONTRÁRIO',
  'OPINIÃO CONTRÁRIA', 'MANIFESTAÇÃO CONTRÁRIA',
];
const FAVORABLE_PATTERNS = [
  'PARECER FAVORÁVEL', 'VOTO FAVORÁVEL', 'FAVORÁVEL AO PROJETO',
  'PELA CONSTITUCIONALIDADE', 'CONSTITUCIONALIDADE DO PROJETO',
  'SEM ÓBICE', 'SEM OBICE', 'NÃO HÁ IMPEDIMENTO', 'NAO HA IMPEDIMENTO',
  'APROVAÇÃO DO PROJETO', 'VOTAÇÃO: FAVORÁVEL', 'VOTO: FAVORÁVEL',
  'OPINIÃO FAVORÁVEL', 'MANIFESTAÇÃO FAVORÁVEL',
];

/**
 * Detecta o voto em texto livre extraído de um documento PDF.
 * Usa padrões de linguagem jurídica da CMBV.
 */
export function detectVoteInText(text: string): 'FAVORÁVEL' | 'CONTRÁRIO' | 'NÃO IDENTIFICADO' {
  const upper = text.toUpperCase();

  // Contrário tem precedência (evita falso-favorável por "constitucionalidade" sem contexto)
  for (const p of CONTRARY_PATTERNS) {
    if (upper.includes(p)) return 'CONTRÁRIO';
  }
  for (const p of FAVORABLE_PATTERNS) {
    if (upper.includes(p)) return 'FAVORÁVEL';
  }
  return 'NÃO IDENTIFICADO';
}

// ── Extração de texto via FlateDecode (sem OCR) ──────────────
export function extractTextFlateDecode(buf: Buffer): string {
  const parts: string[] = [];

  // Buffer bruto (URIs e anotações plaintext)
  parts.push(buf.toString('latin1'));

  // Streams FlateDecode
  let pos = 0;
  while (pos < buf.length) {
    let streamStart = buf.indexOf(Buffer.from('stream\n'), pos);
    const streamStartCRLF = buf.indexOf(Buffer.from('stream\r\n'), pos);
    let headerLen = 7;
    if (streamStartCRLF !== -1 && (streamStart === -1 || streamStartCRLF < streamStart)) {
      streamStart = streamStartCRLF;
      headerLen = 8;
    }
    if (streamStart === -1) break;
    const endstream = buf.indexOf(Buffer.from('endstream'), streamStart + headerLen);
    if (endstream === -1) break;
    const compressed = buf.subarray(streamStart + headerLen, endstream);
    for (const inflate of [inflateSync, inflateRawSync]) {
      try {
        parts.push(inflate(compressed).toString('latin1'));
        break;
      } catch { /* não é FlateDecode */ }
    }
    pos = endstream + 9;
  }

  return parts.join(' ');
}

// ── Extração de texto via OCR (tesseract) ───────────────────

async function ocrBuffer(buf: Buffer, maxPagesSec = 30): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbv_doc_'));
  const tmpPdf = path.join(tmpDir, 'doc.pdf');
  const pgPrefix = path.join(tmpDir, 'pg');
  try {
    fs.writeFileSync(tmpPdf, buf);

    await execFileAsync('pdftoppm', ['-r', '120', '-png', tmpPdf, pgPrefix], {
      timeout: 45_000,
    });

    const pages = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith('pg') && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(tmpDir, f));

    const texts: string[] = [];
    for (const pg of pages) {
      for (const lang of ['por', 'eng']) {
        try {
          const { stdout } = await execFileAsync('tesseract', [pg, 'stdout', '-l', lang], {
            timeout: maxPagesSec * 1000,
          });
          texts.push(stdout);
          break;
        } catch { /* tenta próxima língua */ }
      }
    }
    return texts.join('\n');
  } catch {
    return '';
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignora */ }
  }
}

// ── API Pública ───────────────────────────────────────────────

/**
 * Extrai todo o texto de um buffer PDF.
 * Tenta FlateDecode primeiro (rápido); cai para OCR se o documento for imagem.
 */
export async function extractTextFromPdfBuffer(buf: Buffer): Promise<string> {
  const flatText = extractTextFlateDecode(buf);

  // Se o texto extraído por FlateDecode contém palavras-chave de voto → usa diretamente
  if (detectVoteInText(flatText) !== 'NÃO IDENTIFICADO') return flatText;

  // Heurística: PDF baseado em imagem tem muito binário e pouco texto legível
  // Verifica se o "texto" extraído é principalmente lixo binário
  const printableRatio =
    (flatText.match(/[\x20-\x7e\xc0-\xff]/g)?.length ?? 0) / Math.max(flatText.length, 1);

  if (printableRatio < 0.5 && buf.length < 8 * 1024 * 1024) {
    // Provável imagem — tenta OCR (máx 25s por página)
    const ocrText = await ocrBuffer(buf, 25);
    if (ocrText.trim().length > 50) return ocrText;
  }

  return flatText;
}

/**
 * Detecta o voto em um URL de documento PDF.
 * Baixa o arquivo, extrai texto (com OCR se necessário) e identifica o voto.
 * Retorna 'NÃO IDENTIFICADO' silenciosamente em caso de erro.
 */
export async function detectVoteFromDocUrl(
  docUrl: string,
  saplBase: string,
): Promise<'FAVORÁVEL' | 'CONTRÁRIO' | 'NÃO IDENTIFICADO'> {
  if (!docUrl) return 'NÃO IDENTIFICADO';
  try {
    const absoluteUrl = docUrl.startsWith('http') ? docUrl : `${saplBase}${docUrl}`;
    const res = await fetch(absoluteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 CMBV-Gabinete/2.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return 'NÃO IDENTIFICADO';
    const buf = Buffer.from(await res.arrayBuffer());
    const text = await extractTextFromPdfBuffer(buf);
    return detectVoteInText(text);
  } catch {
    return 'NÃO IDENTIFICADO';
  }
}

/**
 * Extrai IDs de matéria de um PDF baseado em imagem via OCR.
 * Requer pdftoppm e tesseract instalados no sistema.
 */
export async function extractMateriaIdsViaOcr(pdfBuffer: Buffer): Promise<number[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapl_ocr_'));
  const tmpPdf = path.join(tmpDir, 'pauta.pdf');
  const pgsPrefix = path.join(tmpDir, 'pg');

  try {
    fs.writeFileSync(tmpPdf, pdfBuffer);

    await execFileAsync('pdftoppm', ['-r', '150', '-png', tmpPdf, pgsPrefix], {
      timeout: 60_000,
    });

    const pageFiles = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith('pg') && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(tmpDir, f));

    if (pageFiles.length === 0) return [];

    const ids = new Set<number>();
    const urlRegex = /sapl\.boavista\.rr\.leg\.br\/materia\/(\d+)/g;
    const relRegex = /\/materia\/(\d{4,6})\b/g;

    function scanText(text: string) {
      let m: RegExpExecArray | null;
      urlRegex.lastIndex = 0;
      while ((m = urlRegex.exec(text)) !== null) ids.add(parseInt(m[1], 10));
      relRegex.lastIndex = 0;
      while ((m = relRegex.exec(text)) !== null) ids.add(parseInt(m[1], 10));
    }

    for (const pageFile of pageFiles) {
      for (const lang of ['por', 'eng']) {
        try {
          const { stdout } = await execFileAsync(
            'tesseract',
            [pageFile, 'stdout', '-l', lang],
            { timeout: 30_000 },
          );
          scanText(stdout);
          break;
        } catch { /* tenta próxima língua */ }
      }
    }

    return Array.from(ids);
  } catch {
    return [];
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignora */ }
  }
}
