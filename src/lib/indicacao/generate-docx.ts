import fs from 'fs';
import path from 'path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  Header,
  HorizontalPositionRelativeFrom,
  HorizontalPositionAlign,
  VerticalPositionRelativeFrom,
  VerticalPositionAlign,
  ExternalHyperlink,
} from 'docx';
import { buildCmbvHeader, buildCmbvFooter } from '@/lib/docx/letterhead';

/**
 * Faz download da imagem via URL e converte em Buffer
 */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Erro ao baixar imagem:', error);
    return null;
  }
}

/** Parseia markdown inline (simplificado) */
function parseMarkdownCustom(text: string): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)|\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|([^*[(]+)/g;
  const base = { size: 24 as never, font: 'Times New Roman' as never };
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[1] && match[2]) {
      runs.push(new ExternalHyperlink({
        children: [new TextRun({ text: match[1], color: '0563C1', underline: {}, ...base } as never)],
        link: match[2]
      }));
    } else if (match[3]) {
      runs.push(new ExternalHyperlink({
        children: [new TextRun({ text: match[3], color: '0563C1', underline: {}, ...base } as never)],
        link: match[3]
      }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], bold: true, ...base } as never));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], italics: true, ...base } as never));
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6], ...base } as never));
    }
  }
  return runs;
}

export async function generateIndicacaoDocxBuffer(
  ementa: string,
  texto_md: string,
  fotos_urls?: string[] | null,
  incluirMarcaDagua: boolean = true
): Promise<Buffer> {
  const children: Paragraph[] = [];

  // ==========================================
  // 1. CARREGAR MARCA D'ÁGUA E BRASÃO
  // ==========================================
  let watermarkRun: ImageRun | undefined;
  try {
    if (incluirMarcaDagua) {
      const wmPath = path.join(process.cwd(), 'public', 'marca_dagua_carol.jpeg');
      if (fs.existsSync(wmPath)) {
        const wmBuf = fs.readFileSync(wmPath);
        watermarkRun = new ImageRun({
          data: wmBuf,
          transformation: { width: 450, height: 630 },
          type: 'jpg',
          floating: {
            horizontalPosition: {
              relative: HorizontalPositionRelativeFrom.PAGE,
              align: HorizontalPositionAlign.CENTER,
            },
            verticalPosition: {
              relative: VerticalPositionRelativeFrom.PAGE,
              align: VerticalPositionAlign.CENTER,
            },
            behindDocument: true,
            wrap: { type: process.env.DOCX_WRAP_NONE || 'none' } as any, // Wrap NONE type for background
          },
        });
      }
    }
  } catch (e) {
    console.error('Erro na marca dagua', e);
  }

  // ==========================================
  // 2. HEADER: Cabeçalho Oficial (papel timbrado CMBV)
  // ==========================================
  const headerParagraphs = buildCmbvHeader({
    ...(watermarkRun ? { watermarkRun } : {}),
  });
  const headerParams = new Header({ children: headerParagraphs });

  // ==========================================
  // 3. FOOTER (papel timbrado CMBV)
  // ==========================================
  const footerParams = buildCmbvFooter();

  // ==========================================
  // 4. CORPO DA INDICAÇÃO
  // ==========================================
  
  // EMENTA (Alinhamento central à Direita - Indent)
  children.push(new Paragraph({
    children: [new TextRun({ text: 'INDICAÇÃO', bold: true, size: 24, font: 'Times New Roman' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 400 }
  }));

  children.push(
    new Paragraph({ children: [new TextRun({ text: 'Excelentíssimo Senhor', size: 24, font: 'Times New Roman' })], spacing: { after: 0 } }),
    new Paragraph({ children: [new TextRun({ text: 'GENILSON COSTA E SILVA', bold: true, size: 24, font: 'Times New Roman' })], spacing: { after: 0 } }),
    new Paragraph({ children: [new TextRun({ text: 'Presidente da Câmara Municipal de Boa Vista', size: 24, font: 'Times New Roman' })], spacing: { after: 400 } })
  );

  children.push(
    new Paragraph({
      indent: { left: 5670 }, // Metade da página
      children: [new TextRun({ text: ementa, bold: true, size: 24, font: 'Times New Roman' })],
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 400 }
    })
  );

  const linhas = (texto_md || '').split('\n');
  linhas.forEach(linha => {
    const trimmed = linha.trim();
    if (!trimmed) {
      children.push(new Paragraph({ spacing: { after: 120 } }));
      return;
    }

    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      const clean = trimmed.replace(/^#+ /, '').replace(/\*\*/g, '');
      children.push(new Paragraph({
        children: [new TextRun({ text: clean, bold: true, underline: {}, size: 24, font: 'Times New Roman' })],
        alignment: AlignmentType.CENTER, spacing: { before: 160, after: 200 }
      }));
    } else {
      children.push(new Paragraph({
        children: parseMarkdownCustom(trimmed),
        spacing: { after: 120, line: 360 }, // Espaçamento 1.5
        indent: { firstLine: 720 }, // Recuo de primeira linha (1,27cm)
        alignment: AlignmentType.JUSTIFIED
      }));
    }
  });

  // ==========================================
  // 5. INSERIR FOTOS DA INDICAÇÃO (se houver)
  // ==========================================
  if (fotos_urls && fotos_urls.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'MÍDIAS REPORTADAS PELO CIDADÃO:', bold: true, size: 24, font: 'Times New Roman' })],
      spacing: { before: 400, after: 200 }
    }));

    for (const url of fotos_urls) {
      if (!url) continue;
      const buf = await fetchImageBuffer(url);
      if (buf) {
        children.push(new Paragraph({
          children: [
            new ImageRun({
              data: buf,
              transformation: { width: 350, height: 350 }, // Tamanho seguro
              type: 'jpg'
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 }
        }));
      }
    }
  }

  // ==========================================
  // 6. ASSINATURA AUTOMÁTICA
  // ==========================================
  children.push(
    new Paragraph({ spacing: { before: 800 } }),
    new Paragraph({
      children: [new TextRun({ text: 'CAROL DANTAS', bold: true, size: 24, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER, spacing: { after: 40 }
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Vereadora do Município de Boa Vista - PSD', size: 24, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER
    })
  );

  const doc = new Document({
    creator: 'Gabinete Virtual CMBV',
    title: 'Indicação - Carol Dantas',
    sections: [{
      properties: { page: { margin: { top: 1100, bottom: 1100, left: 1440, right: 1440 } } },
      headers: { default: headerParams },
      footers: { default: footerParams },
      children
    }]
  });

  return await Packer.toBuffer(doc) as Buffer;
}
