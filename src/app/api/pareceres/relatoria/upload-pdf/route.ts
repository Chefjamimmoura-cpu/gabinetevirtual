// POST /api/pareceres/relatoria/upload-pdf
// Recebe um PDF da PLL (o documento completo da matéria, não a pauta).
// Extrai o texto via FlateDecode ou OCR (tesseract para PDFs-imagem),
// identifica o tipo/número/ano da matéria legislativa, e busca o ID real no SAPL.
//
// Body: multipart/form-data com campo "file" (PDF)
//
// Retorno (sucesso):
//   { found: true, tipo, numero, ano, materia_id, ementa, sapl_url, source }
//
// Retorno (não identificado):
//   { found: false, extracted_text_preview, candidates: [] }

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { extractTextFromPdfBuffer } from '@/lib/sapl/ocr';

const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';

// Tipos de matérias legislativas aceitos
const TIPOS_LEGISLATIVOS = [
  'PLL', 'PL', 'PDL', 'PLC', 'PLP',
  'REQ', 'MOC', 'IND', 'REC', 'PEC',
];

interface MateriaCandidate {
  tipo: string;
  numero: number;
  ano: number;
  raw: string;
}

/**
 * Extrai candidatos de identificadores de matéria do texto.
 * Suporta formatos:
 *   - "PLL nº 32, de 2026"
 *   - "PLL nº 32/2026"
 *   - "PLL 32/2026"
 *   - "Projeto de Lei nº 32, de 2026"
 *   - "Projeto de Lei Complementar nº 15/2025"
 */
function extractMateriaIdentifiers(text: string): MateriaCandidate[] {
  const candidates: MateriaCandidate[] = [];
  const seen = new Set<string>();

  const tiposPattern = TIPOS_LEGISLATIVOS.join('|');

  const patterns = [
    // "PLL nº 32, de 2026" | "PLL n. 32, de 2026" | "PLL n° 32 de 2026"
    new RegExp(`\\b(${tiposPattern})\\s+n[.°o]?\\s*(\\d{1,4})[,\\s]+de\\s+(\\d{4})\\b`, 'gi'),
    // "PLL 32/2026" | "PLL32/2026"
    new RegExp(`\\b(${tiposPattern})\\s*(\\d{1,4})\\s*\\/\\s*(\\d{4})\\b`, 'gi'),
    // "Projeto de Lei nº 32/2026" | "Projeto de Lei Complementar nº 32, de 2026"
    /\bProjeto\s+de\s+Lei(?:\s+Complementar)?\s+n[.°o]?\s*(\d{1,4})[,\s/]+(?:de\s+)?(\d{4})\b/gi,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      let tipo: string, numero: number, ano: number;

      if (match.length === 4 && isNaN(Number(match[1])) && TIPOS_LEGISLATIVOS.includes(match[1].toUpperCase())) {
        // Padrões 1 e 2: tipo + numero + ano
        tipo = match[1].toUpperCase();
        numero = parseInt(match[2], 10);
        ano = parseInt(match[3], 10);
      } else if (match.length === 3) {
        // Padrão 3: "Projeto de Lei nº X/AAAA"
        tipo = 'PL';
        numero = parseInt(match[1], 10);
        ano = parseInt(match[2], 10);
      } else {
        continue;
      }

      if (isNaN(numero) || isNaN(ano) || ano < 1990 || ano > 2100) continue;
      const key = `${tipo}-${numero}-${ano}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ tipo, numero, ano, raw: match[0] });
    }
  }

  return candidates;
}

/** Busca o ID SAPL de uma matéria por tipo+numero+ano */
async function resolverMateriaIdNoSapl(tipo: string, numero: number, ano: number): Promise<{
  id: number;
  ementa: string;
  tipo_sigla: string;
} | null> {
  try {
    const url = `${SAPL_BASE}/api/materia/materia/?numero=${numero}&ano=${ano}&limit=10`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      results?: { id: number; ementa?: string; tipo?: { sigla?: string } }[]
    };
    const results = json.results || [];
    if (results.length === 0) return null;

    // Se tipo informado, tenta filtrar; senão usa o primeiro
    const match = tipo
      ? results.find(r => r.tipo?.sigla?.toUpperCase() === tipo.toUpperCase())
      : null;
    const chosen = match ?? results[0];
    return {
      id: chosen.id,
      ementa: chosen.ementa || '',
      tipo_sigla: chosen.tipo?.sigla || tipo,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Falha ao ler multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'Campo "file" é obrigatório' }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Apenas arquivos PDF são aceitos' }, { status: 415 });
  }

  // Lê o buffer do PDF
  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  // Extrai texto (FlateDecode rápido → OCR fallback para PDFs-imagem)
  let text: string;
  try {
    text = await extractTextFromPdfBuffer(buf);
  } catch (err) {
    console.error('[upload-pdf] Falha na extração de texto:', err);
    return NextResponse.json({ error: 'Falha ao processar o PDF. Verifique se o arquivo não está corrompido.' }, { status: 422 });
  }

  if (!text || text.trim().length < 20) {
    return NextResponse.json({
      found: false,
      error: 'Não foi possível extrair texto do PDF. O arquivo pode estar protegido ou vazio.',
      extracted_text_preview: text?.substring(0, 200) || '',
      candidates: [],
    });
  }

  // Identifica matérias no texto
  const candidates = extractMateriaIdentifiers(text);

  if (candidates.length === 0) {
    return NextResponse.json({
      found: false,
      message: 'Nenhum identificador de matéria encontrado no documento. Use "Buscar por ID" manualmente.',
      extracted_text_preview: text.substring(0, 400),
      candidates: [],
    });
  }

  // Tenta resolver o ID no SAPL para o candidato mais provável (primeiro da lista)
  const primary = candidates[0];
  const saplMateria = await resolverMateriaIdNoSapl(primary.tipo, primary.numero, primary.ano);

  if (saplMateria) {
    return NextResponse.json({
      found: true,
      tipo: saplMateria.tipo_sigla,
      numero: primary.numero,
      ano: primary.ano,
      materia_id: saplMateria.id,
      ementa: saplMateria.ementa,
      sapl_url: `${SAPL_BASE}/materia/${saplMateria.id}`,
      source: 'pdf_ocr_sapl_api',
      candidates,
    });
  }

  // Candidato encontrado mas SAPL não confirmou — retorna o candidato para o usuário confirmar
  return NextResponse.json({
    found: false,
    message: `Identificado "${primary.tipo} ${primary.numero}/${primary.ano}" no documento, mas não foi possível confirmar no SAPL. Use "Buscar por ID" com esse número.`,
    suggested_query: `${primary.tipo} ${primary.numero}/${primary.ano}`,
    extracted_text_preview: text.substring(0, 400),
    candidates,
  });
}
