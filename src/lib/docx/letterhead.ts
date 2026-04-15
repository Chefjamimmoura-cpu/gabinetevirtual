// ═══════════════════════════════════════════════════════════════════════
// Papel Timbrado Oficial — Câmara Municipal de Boa Vista
// Módulo centralizado para header/footer de todos os documentos DOCX
// ═══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import {
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  BorderStyle,
  Footer,
} from 'docx';

// ── Configuração visual ────────────────────────────────────────────────

const HEADER_COLOR = '000000'; // Alterado para preto rígido institucional
const FOOTER_COLOR = '333333';
const FONT = 'Times New Roman';

/** Tamanho em half-points (docx). 16 = 8pt, 20 = 10pt, 22 = 11pt */
const HEADER_SIZE = 20; // 10pt (anteriormente era 8pt, muito pequeno)
const FOOTER_SIZE = 20; // 10pt
const FOOTER_SIZE_SMALL = 18; // 9pt

// ── Interface ──────────────────────────────────────────────────────────

export interface LetterheadOptions {
  /** Nome completo do vereador(a) para o cabeçalho. Default: 'Carol Dantas' */
  vereadorNome?: string;
  /** Override completo da 3ª linha do header (ex: 'GABINETE PARLAMENTAR') */
  gabineteLabel?: string;
  /** Se true, insere watermark (marca d'água) no header via paragraphs extras */
  watermarkRun?: ImageRun;
}

// ── Brasão ─────────────────────────────────────────────────────────────

function loadBrasaoRun(): ImageRun | null {
  try {
    // Prioridade: brasão municipal > brasão genérico
    const candidates = [
      path.join(process.cwd(), 'public', 'brasao_municipal.png'),
      path.join(process.cwd(), 'Marcas', 'Brasão_Municipal_de_Boa_Vista_Roraima.png'),
      path.join(process.cwd(), 'public', 'brasao.png'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const buf = fs.readFileSync(candidate);
        return new ImageRun({
          data: buf,
          // 2,5cm × 2,5cm ≈ 71pt × 71pt (1cm ≈ 28,35pt)
          transformation: { width: 71, height: 71 },
          type: 'png',
        });
      }
    }
  } catch (err) {
    console.error('[letterhead] Erro ao carregar brasão:', err);
  }
  return null;
}

// ── Header (Cabeçalho) ────────────────────────────────────────────────

/**
 * Constrói os parágrafos do cabeçalho oficial da CMBV.
 *
 * Layout:
 *   [Brasão Municipal centralizado 2,5×2,5cm]
 *   ESTADO DE RORAIMA
 *   CÂMARA MUNICIPAL DE BOA VISTA
 *   GABINETE DO(A) VEREADOR(A) [NOME]
 *   ────────────────────── (linha sólida)
 */
export function buildCmbvHeader(opts?: LetterheadOptions): Paragraph[] {
  const vereador = opts?.vereadorNome ?? 'Carol Dantas';
  const gabinete =
    opts?.gabineteLabel ??
    `GABINETE DA VEREADORA ${vereador.toUpperCase()}`;

  const paragraphs: Paragraph[] = [];

  // 1. Brasão centralizado
  const brasaoRun = loadBrasaoRun();
  if (brasaoRun) {
    paragraphs.push(
      new Paragraph({
        children: [brasaoRun],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      })
    );
  }

  // 2. ESTADO DE RORAIMA
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'ESTADO DE RORAIMA',
          color: HEADER_COLOR,
          size: HEADER_SIZE,
          font: FONT,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 0 },
    })
  );

  // 3. CÂMARA MUNICIPAL DE BOA VISTA
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'CÂMARA MUNICIPAL DE BOA VISTA',
          color: HEADER_COLOR,
          size: HEADER_SIZE,
          bold: true,
          font: FONT,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 0 },
    })
  );

  // 4. GABINETE DO(A) VEREADOR(A) [NOME] + linha sólida
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: gabinete,
          color: HEADER_COLOR,
          size: HEADER_SIZE,
          font: FONT,
        }),
      ],
      alignment: AlignmentType.CENTER,
      border: {
        bottom: {
          color: '999999',
          space: 8,
          size: 6,
          style: BorderStyle.SINGLE,
        },
      },
      spacing: { after: 200 },
    })
  );

  // 5. Watermark (se fornecido)
  if (opts?.watermarkRun) {
    paragraphs.push(new Paragraph({ children: [opts.watermarkRun] }));
  }

  return paragraphs;
}

// ── Footer (Rodapé) ───────────────────────────────────────────────────

/**
 * Constrói o Footer oficial da CMBV.
 *
 * Layout centralizado:
 *   **Câmara Municipal de Boa Vista**
 *   Palácio João Evangelista Pereira de Melo - Gabinete da vereadora [Nome]
 *   Avenida Capitão Ene Garcêz, 1264 - São Francisco - CEP: 69 301 160 - Tel: 95 3623-0974
 *   Email: presidência.cmbv@gmail.com - Boa Vista - Roraima
 */
export function buildCmbvFooter(opts?: LetterheadOptions): Footer {
  const vereador = opts?.vereadorNome ?? 'Carol Dantas';

  return new Footer({
    children: [
      // Linha 1: Câmara Municipal de Boa Vista (bold, 10pt)
      new Paragraph({
        children: [
          new TextRun({
            text: 'Câmara Municipal de Boa Vista',
            bold: true,
            color: FOOTER_COLOR,
            size: FOOTER_SIZE,
            font: FONT,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
      }),
      // Linha 2: Palácio + Gabinete
      new Paragraph({
        children: [
          new TextRun({
            text: `Palácio João Evangelista Pereira de Melo - Gabinete da vereadora ${vereador}`,
            color: FOOTER_COLOR,
            size: FOOTER_SIZE_SMALL,
            font: FONT,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
      }),
      // Linha 3: Endereço + Tel
      new Paragraph({
        children: [
          new TextRun({
            text: 'Avenida Capitão Ene Garcêz, 1264 - São Francisco - CEP: 69 301 160 - Tel: 95 3623-0974',
            color: FOOTER_COLOR,
            size: FOOTER_SIZE_SMALL,
            font: FONT,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
      }),
      // Linha 4: Email + Cidade
      new Paragraph({
        children: [
          new TextRun({
            text: 'Email: presidência.cmbv@gmail.com - Boa Vista - Roraima',
            color: FOOTER_COLOR,
            size: FOOTER_SIZE_SMALL,
            font: FONT,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
      }),
    ],
  });
}
