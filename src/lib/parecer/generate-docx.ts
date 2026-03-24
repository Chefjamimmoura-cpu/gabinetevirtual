// ═══════════════════════════════════════════
// Geração de DOCX — Parecer Legislativo CMBV
// Portado do cmbv-parecer/src/server.js (L752-1032)
// Para uso como API Route no Next.js
// ═══════════════════════════════════════════
//
// NOTA: Este arquivo contém a lógica COMPLETA de geração DOCX
// extraída do projeto cmbv-parecer. Será invocado pela API Route
// /api/parecer/gerar-docx quando o backend estiver conectado.
//
// Dependências necessárias: npm install docx
// ═══════════════════════════════════════════

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  ShadingType,
  ExternalHyperlink,
  Header,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
import { buildCmbvHeader, buildCmbvFooter } from '@/lib/docx/letterhead';

/** Mapa de palavras-chave de votação para cor de tarja (hex sem #) */
const VOTO_KEYWORDS: { pattern: RegExp; color: string }[] = [
  { pattern: /VOTO FAVORÁVEL/i, color: '92D050' }, // verde
  { pattern: /VOTO CONTRÁRIO/i, color: 'FF0000' }, // vermelho
  { pattern: /CAUTELA/i,        color: 'FFFF00' }, // amarelo
];

/**
 * Constrói runs para linha de Recomendação:
 * aplica tarja apenas na palavra-chave do voto, o restante fica sem highlight.
 */
function buildRecomendacaoRuns(text: string): (TextRun | ExternalHyperlink)[] {
  const base = { size: 24 as never, font: 'Times New Roman' as never };

  for (const { pattern, color } of VOTO_KEYWORDS) {
    const match = pattern.exec(text);
    if (!match) continue;

    const before = text.slice(0, match.index);
    const keyword = match[0];
    const after = text.slice(match.index + keyword.length);

    const runs: (TextRun | ExternalHyperlink)[] = [];
    if (before) runs.push(...parseMarkdownCustom(before, false));
    runs.push(new TextRun({
      text: keyword,
      bold: true,
      shading: { type: ShadingType.CLEAR, fill: color },
      ...base,
    } as never));
    if (after) runs.push(...parseMarkdownCustom(after, false));
    return runs;
  }

  // Nenhuma palavra-chave encontrada — renderiza normalmente
  return parseMarkdownCustom(text, false);
}

/**
 * Normaliza texto de título de item: converte "TIPO NUM/ANO (URL)" para "[TIPO NUM/ANO](URL)"
 * caso a IA não gere o formato markdown correto de hyperlink.
 */
function normalizeLinkInTitle(text: string): string {
  // Tenta: "... SIGLA NUM/ANO (https://...)" → "... [SIGLA NUM/ANO](https://...)"
  return text.replace(
    /([A-ZÁÉÍÓÚÃÕÇÀ]+(?:\s+[\d/]+)+)\s+\((https?:\/\/[^)]+)\)/,
    '[$1]($2)'
  );
}

/** Parseia markdown inline em TextRuns do docx (sem highlight — use buildRecomendacaoRuns para linhas de voto) */
function parseMarkdownCustom(text: string, _unused?: boolean, size: number = 24): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  // Padrões: [texto](url) | URL nua em parênteses (url) | **negrito** | *itálico* | texto simples
  const regex = /\[([^\]]+)\]\(([^)]+)\)|\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|([^*[(]+)/g;
  const base = { size: size as never, font: 'Times New Roman' as never };
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[1] && match[2]) {
      // Formato markdown: [texto](url)
      runs.push(new ExternalHyperlink({
        children: [new TextRun({ text: match[1], color: '0563C1', underline: {}, ...base } as never)],
        link: match[2]
      }));
    } else if (match[3]) {
      // URL nua em parênteses: (https://...) — usa a URL como texto do link também
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

/** Constrói tabela DOCX a partir de linhas de tabela markdown */
function buildDocxTable(tableLines: string[]): Table | null {
  const dataRows = tableLines
    .filter(l => !l.match(/^\|[\s-:|]+\|$/))
    .map(l => l.split('|').filter(c => c.trim()).map(c => c.trim().replace(/\*\*/g, '')));
  if (dataRows.length === 0) return null;

  const colWidths = [800, 1600, 1600, 2400, 3600];
  const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
  const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

  const rows = dataRows.map((cells, ri) => {
    const isHeader = (ri === 0);
    return new TableRow({
      children: cells.map((cellText, ci) => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({
            text: cellText,
            bold: isHeader,
            color: isHeader ? 'FFFFFF' : '333333',
            size: 18,
            font: 'Times New Roman'
          })],
          spacing: { before: 40, after: 40 }
        })],
        width: { size: colWidths[ci] || 2000, type: WidthType.DXA },
        shading: {
          type: ShadingType.CLEAR,
          fill: isHeader ? '1a4731' : (ri % 2 === 0 ? 'F7F5F0' : 'FFFFFF')
        },
        borders
      }))
    });
  });

  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/**
 * Gera um buffer DOCX completo a partir do texto markdown do parecer.
 * @param parecer - Texto markdown do parecer gerado pela IA
 * @param totalMaterias - Número total de matérias analisadas
 * @param dataSessao - Data da sessão (ISO string ou string legível)
 */
export async function generateDocxBuffer(
  parecer: string,
  totalMaterias: number,
  dataSessao?: string
): Promise<Buffer> {
  const dataFmt = new Date(dataSessao || Date.now()).toLocaleDateString('pt-BR', { 
    day: '2-digit', month: '2-digit', year: 'numeric' 
  });

  const children: (Paragraph | Table)[] = [];

  // Cabeçalho e rodapé oficiais (papel timbrado CMBV)
  const headerChildren = buildCmbvHeader();
  const headerParams = new Header({ children: headerChildren });
  const footerParams = buildCmbvFooter();

  // Título Principal
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `PARECER COMPLETO – ORDEM DO DIA (${dataFmt})`, bold: true, size: 24, font: 'Times New Roman', underline: {} })],
      alignment: AlignmentType.CENTER, spacing: { before: 200, after: 400 }
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Para: Vereadora Carol Dantas', italics: true, size: 22, font: 'Times New Roman' })],
      spacing: { after: 120 }
    }),
    new Paragraph({
      children: [new TextRun({ text: `Assunto: Análise Jurídica, Política e Recomendações de Voto (Itens 1 a ${totalMaterias})`, italics: true, size: 22, font: 'Times New Roman' })],
      spacing: { after: 400 }
    })
  );

  // Parse do markdown do parecer
  const linhas = (parecer || '').split('\n');
  let docxTableBuffer: string[] = [];

  linhas.forEach(linha => {
    const trimmed = linha.trim();

    if (trimmed.startsWith('|')) {
      docxTableBuffer.push(trimmed);
      return;
    }

    if (docxTableBuffer.length > 0) {
      const tbl = buildDocxTable(docxTableBuffer);
      if (tbl) children.push(tbl);
      docxTableBuffer = [];
    }

    if (!trimmed) { children.push(new Paragraph({ spacing: { after: 120 } })); return; }

    // Pula h1 e linhas *Para:/Assunto: — já inseridos como hardcoded acima
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) return;
    if (trimmed.startsWith('*Para:') || trimmed.startsWith('*Assunto:')) return;

    const isRecomendacao = trimmed.includes('Recomendação:');
    // Detecta recuo de 4 espaços (bullet nível 1) e 8 espaços (nível 2 — Relator) ANTES do trim
    const isDeepNestedBullet = /^        [-*●○■]/.test(linha);
    const isNestedBullet = !isDeepNestedBullet && /^    [-*●○]/.test(linha);
    // Detecta linhas de relator (sub-item de comissão) — italic, 10pt
    const isRelatorLine = isDeepNestedBullet && /relator:/i.test(trimmed);

    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      const clean = trimmed.replace(/^#+ /, '').replace(/\*\*/g, '');
      children.push(new Paragraph({
        children: [new TextRun({ text: clean, bold: true, underline: {}, size: 24, font: 'Times New Roman' })],
        alignment: AlignmentType.CENTER, spacing: { before: 160, after: 200 }
      }));
    } else if (trimmed.startsWith('#### ') || trimmed.startsWith('Item') || trimmed.startsWith('**Item')) {
      const clean = normalizeLinkInTitle(trimmed.replace(/^#### /, ''));
      const childrenRuns = parseMarkdownCustom(clean);
      children.push(new Paragraph({
        children: childrenRuns,
        spacing: { before: 160, after: 100 }
      }));
    } else if (
      trimmed.startsWith('- ') || trimmed.startsWith('● ') ||
      trimmed.startsWith('○ ') || trimmed.startsWith('* ') ||
      trimmed.startsWith('■ ')
    ) {
      const clean = trimmed.replace(/^[-●○*■]\s*/, '');
      const bulletLevel = isDeepNestedBullet ? 2 : isNestedBullet ? 1 : 0;
      // Relator: italic, 10pt (size=20 half-points); comissão/normal: 12pt (size=24)
      const fontSize = isRelatorLine ? 20 : 24;
      const runs = isRecomendacao
        ? buildRecomendacaoRuns(clean)
        : isRelatorLine
          ? [new TextRun({ text: clean, italics: true, size: fontSize as never, font: 'Times New Roman' as never })]
          : parseMarkdownCustom(clean);

      children.push(new Paragraph({
        children: runs,
        bullet: { level: bulletLevel },
        spacing: { after: isRelatorLine ? 40 : 80, line: 360 },
        alignment: AlignmentType.JUSTIFIED
      }));
    } else if (trimmed.startsWith('---')) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 4, color: '999999' } }
      }));
    } else {
      const runs = isRecomendacao ? buildRecomendacaoRuns(trimmed) : parseMarkdownCustom(trimmed);

      children.push(new Paragraph({
        children: runs,
        spacing: { after: 120, line: 360 },
        alignment: AlignmentType.JUSTIFIED
      }));
    }
  });

  if (docxTableBuffer.length > 0) {
    const tbl = buildDocxTable(docxTableBuffer);
    if (tbl) children.push(tbl);
  }

  // Assinatura
  children.push(
    new Paragraph({ spacing: { before: 800 } }),
    new Paragraph({
      children: [new TextRun({ text: 'ASSESSORIA JURÍDICA PARLAMENTAR', bold: true, size: 24, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER, spacing: { after: 40 }
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Vereadora do Município de Boa Vista – PSD', size: 24, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER
    })
  );

  const doc = new Document({
    creator: 'Sistema CMBV',
    title: 'Parecer CMBV Oficial',
    sections: [{
      properties: { page: { margin: { top: 1100, bottom: 1100, left: 1440, right: 1440 } } },
      headers: { default: headerParams },
      footers: { default: footerParams },
      children
    }]
  });

  return await Packer.toBuffer(doc) as Buffer;
}

/**
 * Gera DOCX de Parecer de Relatoria com cabeçalho correto.
 * Formato: logo → CÂMARA MUNICIPAL → GABINETE VEREADORA [nome] → título "PARECER DA RELATORIA" → comissão.
 */
export async function generateRelatorDocxBuffer(
  text: string,
  opts: {
    commissionNome: string;
    commissionSigla: string;
    gabineteNome?: string;
  }
): Promise<Buffer> {
  const { commissionNome, commissionSigla, gabineteNome = 'Parlamentar' } = opts;
  const gabineteLabel = `GABINETE VEREADORA ${gabineteNome.toUpperCase()}`;
  const SIZE = 22; // 11pt

  const children: (Paragraph | Table)[] = [];

  // Cabeçalho e rodapé oficiais (papel timbrado CMBV)
  const headerChildren = buildCmbvHeader({ gabineteLabel });
  const footerParams = buildCmbvFooter();

  // Título do documento
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'PARECER DA RELATORIA', bold: true, size: SIZE + 2, font: 'Times New Roman', underline: {} })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${commissionNome.toUpperCase()} - ${commissionSigla}`, bold: true, size: SIZE, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    })
  );

  // Parse do corpo do markdown — pula as primeiras linhas de cabeçalho geradas pela IA
  const linhas = (text || '').split('\n');
  let headerSkipping = true;
  let docxTableBuffer: string[] = [];

  linhas.forEach(linha => {
    const trimmed = linha.trim();

    // Flush tabela pendente
    if (!trimmed.startsWith('|') && docxTableBuffer.length > 0) {
      const tbl = buildDocxTable(docxTableBuffer);
      if (tbl) children.push(tbl);
      docxTableBuffer = [];
    }

    // Pula bloco de cabeçalho gerado pela IA (CÂMARA MUNICIPAL, COMISSÃO, backticks)
    if (headerSkipping) {
      if (
        /^CÂMARA MUNICIPAL/i.test(trimmed) ||
        /^COMISSÃO\s+DE\s+/i.test(trimmed) ||
        /^```/.test(trimmed)
      ) return;
      headerSkipping = false;
    }

    if (trimmed.startsWith('|')) {
      docxTableBuffer.push(trimmed);
      return;
    }

    if (!trimmed) { children.push(new Paragraph({ spacing: { after: 100 } })); return; }

    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      const clean = trimmed.replace(/^#+ /, '').replace(/\*\*/g, '');
      children.push(new Paragraph({
        children: [new TextRun({ text: clean, bold: true, underline: {}, size: SIZE, font: 'Times New Roman' })],
        alignment: AlignmentType.CENTER, spacing: { before: 200, after: 160 },
      }));
    } else if (trimmed.startsWith('---')) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: 'cccccc' } },
      }));
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const clean = trimmed.replace(/^[-*]\s*/, '');
      children.push(new Paragraph({
        children: parseMarkdownCustom(clean, false, SIZE),
        bullet: { level: 0 },
        spacing: { after: 80, line: 360 },
        alignment: AlignmentType.JUSTIFIED,
      }));
    } else {
      children.push(new Paragraph({
        children: parseMarkdownCustom(trimmed, false, SIZE),
        spacing: { after: 100, line: 360 },
        alignment: AlignmentType.JUSTIFIED,
      }));
    }
  });

  if (docxTableBuffer.length > 0) {
    const tbl = buildDocxTable(docxTableBuffer);
    if (tbl) children.push(tbl);
  }

  const doc = new Document({
    creator: 'Sistema CMBV',
    title: `Parecer de Relatoria — ${commissionSigla}`,
    sections: [{
      properties: { page: { margin: { top: 1100, bottom: 1100, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: footerParams },
      children,
    }],
  });

  return await Packer.toBuffer(doc) as Buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades para Parecer da Comissão e ATA
// ─────────────────────────────────────────────────────────────────────────────

const DIAS_EXTENSO = [
  'PRIMEIRO','DOIS','TRÊS','QUATRO','CINCO','SEIS','SETE','OITO','NOVE','DEZ',
  'ONZE','DOZE','TREZE','QUATORZE','QUINZE','DEZESSEIS','DEZESSETE','DEZOITO',
  'DEZENOVE','VINTE','VINTE E UM','VINTE E DOIS','VINTE E TRÊS','VINTE E QUATRO',
  'VINTE E CINCO','VINTE E SEIS','VINTE E SETE','VINTE E OITO','VINTE E NOVE',
  'TRINTA','TRINTA E UM',
];
const MESES_EXTENSO = [
  'JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO',
  'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO',
];
const ANOS_EXTENSO: Record<number, string> = {
  2024: 'DOIS MIL E VINTE E QUATRO',
  2025: 'DOIS MIL E VINTE E CINCO',
  2026: 'DOIS MIL E VINTE E SEIS',
  2027: 'DOIS MIL E VINTE E SETE',
  2028: 'DOIS MIL E VINTE E OITO',
  2029: 'DOIS MIL E VINTE E NOVE',
  2030: 'DOIS MIL E TRINTA',
};

export function dateToExtenso(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth();
  const y = date.getFullYear();
  const dia = DIAS_EXTENSO[d - 1] ?? String(d);
  const mes = MESES_EXTENSO[m] ?? String(m + 1);
  const ano = ANOS_EXTENSO[y] ?? String(y);
  return `${dia} DE ${mes} DO ANO ${ano}`;
}

export interface ComissaoMembro {
  nome: string;
  cargo: 'presidente' | 'vice-presidente' | 'membro' | 'suplente';
}

/**
 * Gera DOCX do Parecer da Comissão.
 */
export async function generateParecerComissaoDocx(
  text: string,
  opts: { commissionNome: string; commissionSigla: string; gabineteNome?: string; membros?: ComissaoMembro[] }
): Promise<Buffer> {
  const { commissionNome, commissionSigla, gabineteNome = 'Parlamentar', membros = [] } = opts;
  const gabineteLabel = `GABINETE VEREADORA ${gabineteNome.toUpperCase()}`;
  const SIZE = 22; // 11pt

  const children: (Paragraph | Table)[] = [];

  // Cabeçalho e rodapé oficiais (papel timbrado CMBV)
  const headerChildren = buildCmbvHeader({ gabineteLabel });
  const footerParams = buildCmbvFooter();

  // Título
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'PARECER DA COMISSÃO', bold: true, size: SIZE + 2, font: 'Times New Roman', underline: {} })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 480, after: 480 },
    })
  );

  // Body — renderização com espaçamento harmônico A4
  // Parágrafo vazio = separador visual entre blocos
  const BODY_SPACING = { after: 280, line: 360 } as const; // 1,5 entrelinhas + 14pt entre parágrafos
  const SEPARATOR_SPACING = { after: 280 } as const;

  const linhas = (text || '').split('\n');
  for (const linha of linhas) {
    const t = linha.trim();
    if (!t) {
      children.push(new Paragraph({ spacing: SEPARATOR_SPACING }));
      continue;
    }
    children.push(new Paragraph({
      children: parseMarkdownCustom(t, false, SIZE),
      spacing: BODY_SPACING,
      alignment: AlignmentType.JUSTIFIED,
      indent: { firstLine: 709 }, // recuo de primeira linha ≈ 1,25 cm
    }));
  }

  // Assinaturas: linha + nome + cargo — formato oficial centralizado
  if (membros.length > 0) {
    children.push(new Paragraph({ spacing: { before: 900 } }));

    // Ordena: presidente primeiro, depois membros, depois vice-presidente
    const sortOrder: Record<string, number> = { presidente: 0, membro: 1, suplente: 2, 'vice-presidente': 3 };
    const sorted = [...membros].sort((a, b) => (sortOrder[a.cargo] ?? 9) - (sortOrder[b.cargo] ?? 9));

    for (const m of sorted) {
      const cargoLabel = m.cargo === 'presidente' ? `Presidente da ${commissionNome}`
        : m.cargo === 'vice-presidente' ? `Vice-presidente da ${commissionNome}`
        : `Membro da ${commissionNome}`;
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '__________________________________________', size: SIZE, font: 'Times New Roman', color: '999999' })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 400, after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `${m.cargo === 'presidente' ? 'Vereadora' : 'Vereador(a)'} ${m.nome}`, bold: true, size: SIZE, font: 'Times New Roman' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: cargoLabel, size: SIZE - 2, font: 'Times New Roman', italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
        }),
      );
    }
  }

  const doc = new Document({
    creator: 'Sistema CMBV',
    title: `Parecer da Comissão — ${commissionSigla}`,
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1800, right: 1800 } } },
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: footerParams },
      children,
    }],
  });
  return await Packer.toBuffer(doc) as Buffer;
}

/**
 * Gera DOCX da ATA da Reunião de Comissão.
 */
export async function generateAtaDocx(
  text: string,
  opts: { commissionNome: string; commissionSigla: string; gabineteNome?: string; membros?: ComissaoMembro[]; dataStr?: string }
): Promise<Buffer> {
  const { commissionNome, commissionSigla, gabineteNome = 'Parlamentar', membros = [], dataStr } = opts;
  const gabineteLabel = `GABINETE VEREADORA ${gabineteNome.toUpperCase()}`;
  const SIZE = 24; // 12pt — ATA em maiúsculas segue o modelo original

  const children: (Paragraph | Table)[] = [];

  // Cabeçalho e rodapé oficiais (papel timbrado CMBV)
  const headerChildren = buildCmbvHeader({ gabineteLabel });
  const footerParams = buildCmbvFooter();

  // Título
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'ATA DA REUNIÃO DE COMISSÃO', bold: true, size: SIZE, font: 'Times New Roman', underline: {} })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 300 },
    })
  );

  // Body (ATA em maiúsculas, justificado)
  const linhas = (text || '').split('\n');
  for (const linha of linhas) {
    const t = linha.trim();
    if (!t) { children.push(new Paragraph({ spacing: { after: 100 } })); continue; }
    children.push(new Paragraph({
      children: [new TextRun({ text: t.toUpperCase(), size: SIZE, font: 'Times New Roman' })],
      spacing: { after: 120, line: 360 },
      alignment: AlignmentType.JUSTIFIED,
    }));
  }

  // Data e assinaturas
  if (dataStr || membros.length > 0) {
    children.push(new Paragraph({ spacing: { before: 600 } }));
    if (dataStr) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `CÂMARA MUNICIPAL DE BOA VISTA, ${dataStr.toUpperCase()}.`, size: SIZE, font: 'Times New Roman' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      }));
    }

    const presidente = membros.find(m => m.cargo === 'presidente');
    const vice = membros.find(m => m.cargo === 'vice-presidente');
    const outrosMembros = membros.filter(m => m.cargo === 'membro' || m.cargo === 'suplente');

    // Linha 1: Presidente (esq) | Membro (dir) — tabela sem bordas, centralizada
    if (presidente || outrosMembros.length > 0) {
      const makeSigCell = (nome: string, cargo: string) => new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.NONE, size: 0 }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 } },
        children: [
          new Paragraph({
            children: [new TextRun({ text: '________________________________', size: SIZE, font: 'Courier New' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 0 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `${cargo === 'PRESIDENTE' ? 'VEREADORA' : 'VEREADOR(A)'} ${nome}`, bold: true, size: SIZE, font: 'Times New Roman' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 0 },
          }),
          new Paragraph({
            children: [new TextRun({ text: cargo, size: SIZE, font: 'Times New Roman' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 0 },
          }),
        ],
      });

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              makeSigCell(
                presidente ? presidente.nome.toUpperCase() : '',
                presidente ? 'PRESIDENTE' : '',
              ),
              makeSigCell(
                outrosMembros[0] ? outrosMembros[0].nome.toUpperCase() : '',
                outrosMembros[0] ? 'MEMBRO' : '',
              ),
            ],
          }),
        ],
      }));
      children.push(new Paragraph({ spacing: { after: 600 } }));
    }

    // Linha 2: Vice-Presidente — centralizado abaixo
    if (vice) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '________________________________', size: SIZE, font: 'Courier New' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `VEREADOR(A) ${vice.nome.toUpperCase()}`, bold: true, size: SIZE, font: 'Times New Roman' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'VICE-PRESIDENTE', size: SIZE, font: 'Times New Roman' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
        }),
      );
    }
  }

  const doc = new Document({
    creator: 'Sistema CMBV',
    title: `ATA — ${commissionNome} — ${commissionSigla}`,
    sections: [{
      properties: { page: { margin: { top: 1100, bottom: 1100, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: footerParams },
      children,
    }],
  });
  return await Packer.toBuffer(doc) as Buffer;
}
