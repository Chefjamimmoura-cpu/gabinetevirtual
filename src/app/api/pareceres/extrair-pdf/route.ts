// POST /api/pareceres/extrair-pdf
// Recebe um PDF da pauta (multipart/form-data, campo "file"),
// extrai IDs de matérias usando a mesma lógica dual-strategy do ordem-dia,
// e retorna a lista enriquecida (lightEnrichMateria) pronta para o dashboard.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { inflateSync, inflateRawSync } from 'zlib';
import { fetchMateria, lightEnrichMateria } from '@/lib/sapl/client';

const ENRICH_BATCH_SIZE = 10;

function extractMateriaIdsFromBuffer(buf: Buffer): number[] {
  const ids = new Set<number>();
  const urlRegex = /sapl\.boavista\.rr\.leg\.br\/materia\/(\d+)/g;

  // Estratégia 1: buffer bruto (latin1) — PDFs recentes com anotações URI plaintext
  const rawText = buf.toString('latin1');
  let m: RegExpExecArray | null;
  urlRegex.lastIndex = 0;
  while ((m = urlRegex.exec(rawText)) !== null) {
    ids.add(parseInt(m[1], 10));
  }

  // Estratégia 2: streams FlateDecode comprimidos — PDFs antigos
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

    const compressed = buf.slice(streamStart + headerLen, endstream);
    for (const inflate of [inflateSync, inflateRawSync]) {
      try {
        const text = inflate(compressed).toString('latin1');
        urlRegex.lastIndex = 0;
        while ((m = urlRegex.exec(text)) !== null) {
          ids.add(parseInt(m[1], 10));
        }
        break;
      } catch {
        // stream não é FlateDecode — ignora
      }
    }
    pos = endstream + 9;
  }

  return Array.from(ids);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'Campo "file" (PDF) obrigatório.' }, { status: 400 });
    }

    if (file.type && !file.type.includes('pdf')) {
      return NextResponse.json({ error: 'Arquivo deve ser um PDF.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    const materiaIds = extractMateriaIdsFromBuffer(buf);

    if (materiaIds.length === 0) {
      return NextResponse.json({
        total: 0,
        materias: [],
        aviso: 'Nenhum link de matéria do SAPL encontrado neste PDF. Verifique se é o PDF correto da pauta.',
      });
    }

    // Enriquecimento leve em lotes paralelos
    const materias = [];
    for (let i = 0; i < materiaIds.length; i += ENRICH_BATCH_SIZE) {
      const batch = materiaIds.slice(i, i + ENRICH_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            const materia = await fetchMateria(id);
            return await lightEnrichMateria(materia);
          } catch {
            return null;
          }
        })
      );
      materias.push(...results.filter((m): m is NonNullable<typeof m> => m !== null));
    }

    return NextResponse.json({ total: materias.length, materias });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao processar PDF';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
