// POST /api/pls/gerar-docx
// Sprint 6 — Geração do DOCX oficial do PL (padrão CMBV + LC 95/1998)
// Inclui brasão municipal no cabeçalho
//
// Recebe: { pl_id, texto_aprovado, ementa }
// Retorna: { ok, url, filename } — URL pública no Supabase Storage

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  BorderStyle,
  Header,
  Footer,
} from 'docx';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function dataExtenso(): string {
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const d = new Date();
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

// Constrói array de Paragraphs a partir do texto estruturado do PL
function buildParagraphs(ementa: string, textoCompleto: string): Paragraph[] {
  const linhas = textoCompleto
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const paragrafos: Paragraph[] = [];

  // Cabeçalho institucional
  paragrafos.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({ text: 'CÂMARA MUNICIPAL DE BOA VISTA', bold: true, size: 28, font: 'Arial' }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({ text: 'Estado de Roraima', size: 24, font: 'Arial' }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 400 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1a1a6e' } },
      children: [
        new TextRun({ text: 'Gabinete da Vereadora Carol Dantas', size: 22, color: '1a1a6e', font: 'Arial' }),
      ],
    }),
  );

  // Converte cada linha em parágrafo formatado
  for (const linha of linhas) {
    const isEpigrafe = linha.startsWith('PROJETO DE LEI');
    const isPreambulo = linha.startsWith('A CÂMARA MUNICIPAL');
    const isArtigo = /^Art\.\s*\d/.test(linha);
    const isJustificativaHeader = linha === 'JUSTIFICATIVA';
    const isSeparador = linha.startsWith('───');
    const isEmentaLinha = linha.startsWith('Ementa:');
    const isInciso = /^\s*(I{1,3}V?|VI{0,3}|IX|X)\s*[-–]/.test(linha) || /^\s*§/.test(linha);

    if (isSeparador) {
      paragrafos.push(
        new Paragraph({
          spacing: { before: 0, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'cccccc' } },
          children: [],
        }),
      );
      continue;
    }

    if (isEpigrafe) {
      paragrafos.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 200 },
        children: [new TextRun({ text: linha, bold: true, size: 24, allCaps: true, font: 'Arial' })],
      }));
      continue;
    }

    if (isEmentaLinha) {
      const textoEmenta = linha.replace('Ementa:', '').trim();
      paragrafos.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 200, after: 200 },
        indent: { left: 720 },
        children: [
          new TextRun({ text: 'Ementa: ', bold: true, size: 22, font: 'Arial' }),
          new TextRun({ text: textoEmenta, bold: true, italics: true, size: 22, font: 'Arial' }),
        ],
      }));
      continue;
    }

    if (isPreambulo) {
      paragrafos.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 400, after: 200 },
        children: [new TextRun({ text: linha, size: 22, font: 'Arial' })],
      }));
      continue;
    }

    if (isJustificativaHeader) {
      paragrafos.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 600, after: 200 },
        children: [new TextRun({ text: 'JUSTIFICATIVA', bold: true, size: 24, allCaps: true, font: 'Arial' })],
      }));
      continue;
    }

    if (isArtigo) {
      paragrafos.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 200, after: 120 },
        children: [new TextRun({ text: linha, size: 22, font: 'Arial' })],
      }));
      continue;
    }

    // Parágrafos e incisos (indentados)
    paragrafos.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 0, after: 120 },
      indent: { left: isInciso ? 1440 : 720 },
      children: [new TextRun({ text: linha, size: 22, font: 'Arial' })],
    }));
  }

  // Bloco de assinatura
  paragrafos.push(
    new Paragraph({ spacing: { before: 800, after: 0 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: '____________________________________', size: 22, font: 'Arial' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 0 },
      children: [new TextRun({ text: 'CAROL DANTAS', bold: true, allCaps: true, size: 22, font: 'Arial' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: 'Vereadora — Câmara Municipal de Boa Vista/RR', size: 22, font: 'Arial' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 0 },
      children: [new TextRun({ text: `Boa Vista, ${dataExtenso()}.`, size: 22, italics: true, font: 'Arial' })],
    }),
  );

  return paragrafos;
}

export async function POST(request: NextRequest) {
  let body: { pl_id?: string; texto_aprovado?: string; ementa?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { pl_id, texto_aprovado, ementa } = body;
  if (!pl_id || !texto_aprovado) {
    return NextResponse.json({ error: 'pl_id e texto_aprovado são obrigatórios' }, { status: 400 });
  }

  try {
    const paragrafos = buildParagraphs(ementa || '', texto_aprovado);

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, bottom: 1440, left: 1800, right: 1440 },
            },
          },
          headers: {
            default: new Header({
              children: (() => {
                const headerChildren: Paragraph[] = [];
                // Tenta carregar o brasão municipal
                try {
                  const brasaoPath = path.join(process.cwd(), 'public', 'brasao_municipal.png');
                  const brasaoBuffer = fs.readFileSync(brasaoPath);
                  headerChildren.push(
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { before: 0, after: 80 },
                      children: [
                        new ImageRun({
                          data: brasaoBuffer,
                          transformation: { width: 72, height: 72 },
                          type: 'png',
                        }),
                      ],
                    }),
                  );
                } catch {
                  // Brasão não encontrado — continua sem imagem
                }
                headerChildren.push(
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 0, after: 0 },
                    children: [
                      new TextRun({
                        text: 'Câmara Municipal de Boa Vista — Vereadora Carol Dantas',
                        size: 16,
                        color: '666666',
                        font: 'Arial',
                      }),
                    ],
                  }),
                );
                return headerChildren;
              })(),
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: 'Av. Cap. Ene Garcez, 1088 — Boa Vista/RR  |  www.boavista.rr.leg.br',
                      size: 16,
                      color: '888888',
                      font: 'Arial',
                    }),
                  ],
                }),
              ],
            }),
          },
          children: paragrafos,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    // Upload no Supabase Storage bucket 'gabinete_docs'
    const supabase = getServiceClient();
    const filename = `pls/${pl_id}/pl_${Date.now()}.docx`;

    const { error: uploadError } = await supabase.storage
      .from('gabinete_docs')
      .upload(filename, buffer, {
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });

    if (uploadError) {
      console.error('[gerar-docx] Storage upload error:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: publicUrlData } = supabase.storage
      .from('gabinete_docs')
      .getPublicUrl(filename);

    const publicUrl = publicUrlData?.publicUrl ?? null;

    return NextResponse.json({ ok: true, url: publicUrl, filename });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[gerar-docx] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
