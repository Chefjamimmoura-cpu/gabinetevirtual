// ═══════════════════════════════════════════════════════════════════════
// Geração de DOCX — Ofício Oficial CMBV
// ═══════════════════════════════════════════════════════════════════════

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  Header,
} from 'docx';
import { buildCmbvHeader, buildCmbvFooter } from '@/lib/docx/letterhead';

// ── Interface ──────────────────────────────────────────────────────────

export interface OficioData {
  numero: string;
  cidadeData: string;
  pronomeTratamento: string;
  destinatarioFinal: string;
  cargoFinal: string;
  assuntoOficial: string;
  corpo: string;
  assinaturaNome: string;
  assinaturaCargo: string;
}

// ── Gerador ────────────────────────────────────────────────────────────

/**
 * Gera um buffer DOCX de Ofício com papel timbrado oficial da CMBV.
 */
export async function generateOficioDocxBuffer(data: OficioData): Promise<Buffer> {
  const SIZE = 24; // 12pt
  const FONT = 'Times New Roman';

  const children: Paragraph[] = [];

  // Cabeçalho e rodapé oficiais (papel timbrado CMBV)
  const headerChildren = buildCmbvHeader();
  const footerParams = buildCmbvFooter();

  // ── Número do ofício + Cidade/Data (alinhados à direita) ───────────

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `Ofício nº ${data.numero}`, bold: true, size: SIZE, font: FONT }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { before: 200, after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: data.cidadeData, size: SIZE, font: FONT }),
      ],
      alignment: AlignmentType.RIGHT,
      spacing: { after: 400 },
    })
  );

  // ── Destinatário ───────────────────────────────────────────────────

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `${data.pronomeTratamento},`, size: SIZE, font: FONT }),
      ],
      spacing: { after: 0 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: data.destinatarioFinal, bold: true, size: SIZE, font: FONT }),
      ],
      spacing: { after: 0 },
    })
  );

  if (data.cargoFinal) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: data.cargoFinal, size: SIZE, font: FONT }),
        ],
        spacing: { after: 400 },
      })
    );
  } else {
    children.push(new Paragraph({ spacing: { after: 400 } }));
  }

  // ── Assunto ────────────────────────────────────────────────────────

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Assunto: ', bold: true, size: SIZE, font: FONT }),
        new TextRun({ text: data.assuntoOficial, size: SIZE, font: FONT }),
      ],
      spacing: { after: 400 },
    })
  );

  // ── Corpo ──────────────────────────────────────────────────────────

  const paragraphs = data.corpo.split('\n').filter(Boolean);
  for (const paragraph of paragraphs) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: paragraph.trim(), size: SIZE, font: FONT }),
        ],
        spacing: { after: 200, line: 360 },
        alignment: AlignmentType.JUSTIFIED,
        indent: { firstLine: 709 }, // recuo de 1ª linha ≈ 1,25cm
      })
    );
  }

  // ── Assinatura ─────────────────────────────────────────────────────

  children.push(
    new Paragraph({ spacing: { before: 800 } }),
    new Paragraph({
      children: [
        new TextRun({ text: data.assinaturaNome, bold: true, size: SIZE, font: FONT }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: data.assinaturaCargo, size: SIZE, font: FONT }),
      ],
      alignment: AlignmentType.CENTER,
    })
  );

  // ── Documento ──────────────────────────────────────────────────────

  const doc = new Document({
    creator: 'Gabinete Virtual CMBV',
    title: `Ofício nº ${data.numero}`,
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1800, right: 1800 } },
      },
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: footerParams },
      children,
    }],
  });

  return await Packer.toBuffer(doc) as Buffer;
}
