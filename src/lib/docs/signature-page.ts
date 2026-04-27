// signature-page — helpers determinísticos para a folha dedicada de assinaturas.
// Quando há disclaimer, o bloco de assinaturas SEMPRE inicia em página nova
// (pageBreakBefore=true) e o disclaimer aparece em itálico no topo dessa página.
// Garantia de auditoria: assinatura nunca fica isolada sem contexto.

import { AlignmentType, Paragraph, TextRun } from 'docx';

export interface SignaturePageHeaderOpts {
  fontSize?: number;
  font?: string;
}

export function buildSignaturePageHeader(
  disclaimer: string,
  opts: SignaturePageHeaderOpts = {},
): Paragraph[] {
  const size = opts.fontSize ?? 20; // 10pt — discreto mas legível
  const font = opts.font ?? 'Times New Roman';

  return [
    new Paragraph({
      pageBreakBefore: true,
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 0, after: 480 },
      children: [
        new TextRun({
          text: disclaimer,
          size,
          italics: true,
          font,
        }),
      ],
    }),
  ];
}
