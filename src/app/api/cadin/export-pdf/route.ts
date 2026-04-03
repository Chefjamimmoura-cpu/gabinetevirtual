import { NextRequest } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { requireAuth } from '@/lib/supabase/auth-guard';

// Timeout de 5 minutos para geração com muitas autoridades
export const maxDuration = 300;

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Sphere = 'federal' | 'estadual' | 'municipal';

interface CadinPerson {
  full_name: string;
  phone: string | null;
  email: string | null;
  party: string | null;
  notes: string | null;
  photo_url: string | null;
  birthday: string | null;
}

interface CadinOrganization {
  name: string;
  acronym: string | null;
  type: string | null;
  sphere: Sphere;
  phone: string | null;
  email: string | null;
  website: string | null;
}

interface Authority {
  title: string;
  dou_url: string | null;
  notes: string | null;
  created_at: string;
  cadin_persons: CadinPerson;
  cadin_organizations: CadinOrganization;
}

// ── Layout ────────────────────────────────────────────────────────────────────
// Margem esquerda maior para encadernação (wire/argola/cola)

const A4_W = 595.28;
const A4_H = 841.89;
const ML   = 65;   // esquerda — maior para encadernação
const MR   = 42;
const MT   = 45;
const MB   = 36;

const HEADER_H  = 42;   // cabeçalho de cada página de conteúdo
const FOOTER_H  = 22;   // rodapé
const COL_GAP   = 10;   // gap entre colunas
const CW        = A4_W - ML - MR;         // 488.28
const COL_W     = (CW - COL_GAP) / 2;    // 239.14

const SECTION_H = 22;   // altura do banner de esfera
const CARD_H    = 74;   // altura de cada card de autoridade
const CARD_VGAP = 4;    // espaço vertical entre cards
const PHOTO_W   = 30;   // largura do slot de foto
const PHOTO_H   = 40;   // altura do slot de foto

// Área útil de conteúdo por página
const PAGE_Y0 = MT + HEADER_H + 8;            // 95
const PAGE_Y1 = A4_H - MB - FOOTER_H - 4;    // 779.89

// ── Paleta de cores (estilo da imagem: azul marinho + verde Roraima) ──────────

const C = {
  navy:     '#0B2559',
  navyMid:  '#1A4A8A',
  green:    '#1D7A4F',

  federal:  '#1d4ed8',
  estadual: '#6d28d9',
  municipal:'#065f46',

  fedBg:    '#eff6ff',
  estBg:    '#f5f3ff',
  munBg:    '#f0fdf4',

  name:     '#1e1b4b',
  cargo:    '#374151',
  org:      '#6b7280',
  contact:  '#4b5563',
  bday:     '#be185d',

  divider:  '#e5e7eb',
  photoBg:  '#e2e8f0',
  cardBg:   '#fafafa',
  white:    '#ffffff',
  footLine: '#d1d5db',
  footText: '#9ca3af',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string | null, org: string): string {
  const src = (name || org).trim();
  const w = src.split(/\s+/);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function fmtBirthday(bday: string | null): string | null {
  if (!bday) return null;
  const parts = bday.split('-');
  if (parts.length < 2) return null;
  const months = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mi = parseInt(parts[0], 10);
  const di = parseInt(parts[1], 10);
  if (mi < 1 || mi > 12 || isNaN(di)) return null;
  return `${di} de ${months[mi]}`;
}

function sphereColor(sphere: Sphere): string {
  return sphere === 'federal' ? C.federal : sphere === 'estadual' ? C.estadual : C.municipal;
}

// ── Pré-carregamento de fotos ─────────────────────────────────────────────────

async function prefetchPhotos(authorities: Authority[]): Promise<Map<string, Buffer>> {
  const urls = [...new Set(
    authorities.map(a => a.cadin_persons.photo_url).filter(Boolean),
  )] as string[];

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        return { url, buf: Buffer.from(await res.arrayBuffer()) };
      } catch { return null; }
      finally { clearTimeout(timer); }
    }),
  );

  const map = new Map<string, Buffer>();
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) map.set(r.value.url, r.value.buf);
  }
  return map;
}

// ── Renderers de página ───────────────────────────────────────────────────────

function drawPageHeader(doc: PDFKit.PDFDocument, brasao: string) {
  // Fundo azul marinho com faixa verde à direita (cores de Roraima)
  doc.save();
  doc.rect(0, 0, A4_W, HEADER_H).fill(C.navy);
  doc.rect(A4_W * 0.73, 0, A4_W * 0.27, HEADER_H).fill(C.green);
  doc.rect(A4_W * 0.69, 0, A4_W * 0.06, HEADER_H).fill(C.navyMid);
  doc.restore();

  if (fs.existsSync(brasao)) {
    doc.image(brasao, A4_W - MR - 26, 5, { height: 32 });
  }

  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11).text(
    'GABINETE VIRTUAL', ML, 10, { lineBreak: false },
  );
  doc.fillColor('#a5f3fc').font('Helvetica').fontSize(7.5).text(
    'ESTADO DE RORAIMA', ML, 24, { lineBreak: false },
  );

  // Linha de separação
  doc.save();
  doc.rect(0, HEADER_H, A4_W, 1).fill('#93c5fd');
  doc.restore();
}

function drawPageFooter(doc: PDFKit.PDFDocument, pg: number, total: number) {
  const fy = A4_H - MB - FOOTER_H;
  doc.save();
  doc.moveTo(ML, fy + 4).lineTo(A4_W - MR, fy + 4)
    .strokeColor(C.footLine).lineWidth(0.5).stroke();
  doc.restore();
  doc.fillColor(C.footText).font('Helvetica').fontSize(6.5).text(
    'Caderno de Autoridades  \u00b7  Estado de Roraima  \u00b7  Gabinete Virtual',
    ML, fy + 9, { lineBreak: false },
  );
  doc.fillColor(C.footText).font('Helvetica-Bold').fontSize(7).text(
    `${pg} / ${total}`,
    ML, fy + 9, { width: CW, align: 'right', lineBreak: false },
  );
}

// ── Banner de seção (esfera) ──────────────────────────────────────────────────

function drawSphereBanner(doc: PDFKit.PDFDocument, sphere: Sphere, y: number, customLabel?: string): number {
  const bg    = sphereColor(sphere);
  const label = customLabel || (sphere === 'federal'   ? 'ESFERA FEDERAL'
              : sphere === 'estadual'  ? 'ESFERA ESTADUAL'
              : 'ESFERA MUNICIPAL');

  doc.save();
  doc.rect(ML, y, CW, SECTION_H).fill(bg);
  doc.restore();
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8.5).text(
    label, ML + 10, y + (SECTION_H - 8.5) / 2 + 1, { lineBreak: false },
  );
  return y + SECTION_H + 4;
}

// ── Slot de foto (placeholder ou imagem real) ─────────────────────────────────

function drawPhotoSlot(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  text: string, color: string, buf?: Buffer,
) {
  if (buf) {
    try {
      doc.save();
      doc.rect(x, y, w, h).clip();
      doc.image(buf, x, y, { width: w, height: h });
      doc.restore();
      return;
    } catch { /* foto corrompida — usa iniciais */ }
  }
  // Placeholder com iniciais e "3x4"
  doc.save();
  doc.rect(x, y, w, h).fill(C.photoBg);
  doc.restore();
  doc.save();
  doc.rect(x, y, w, h).stroke(C.divider);
  doc.restore();
  doc.fillColor(color).font('Helvetica-Bold').fontSize(11).text(
    text, x, y + h / 2 - 8, { width: w, align: 'center', lineBreak: false },
  );
  doc.fillColor('#94a3b8').font('Helvetica').fontSize(5).text(
    '3\u00d74', x, y + h - 8, { width: w, align: 'center', lineBreak: false },
  );
}

// ── Card de autoridade ────────────────────────────────────────────────────────

function drawCard(
  doc: PDFKit.PDFDocument,
  a: Authority,
  x: number, y: number, w: number,
  photos: Map<string, Buffer>,
) {
  const p  = a.cadin_persons;
  const o  = a.cadin_organizations;
  const sc = sphereColor(o.sphere);

  // Fundo do card + borda lateral colorida
  doc.save();
  doc.roundedRect(x, y, w, CARD_H, 2).fill(C.cardBg);
  doc.rect(x, y, 3, CARD_H).fill(sc);
  doc.restore();

  // Foto
  const px  = x + 3 + 6;
  const py  = y + (CARD_H - PHOTO_H) / 2;
  const buf = p.photo_url ? photos.get(p.photo_url) : undefined;
  drawPhotoSlot(doc, px, py, PHOTO_W, PHOTO_H, getInitials(p.full_name, o.name), sc, buf);

  // Área de texto
  const tx = px + PHOTO_W + 6;
  const tw = w - (tx - x) - 6;
  let ty   = y + 6;

  // Nome
  doc.fillColor(C.name).font('Helvetica-Bold').fontSize(8).text(
    trunc(p.full_name, 38), tx, ty, { width: tw, lineBreak: false },
  );
  ty += 11;

  // Cargo
  doc.fillColor(sc).font('Helvetica-Bold').fontSize(6.5).text(
    trunc(a.title.toUpperCase(), 44), tx, ty, { width: tw, lineBreak: false },
  );
  ty += 9;

  // Órgão
  const orgLabel = o.acronym ? o.acronym : trunc(o.name, 32);
  doc.fillColor(C.org).font('Helvetica').fontSize(6).text(
    orgLabel, tx, ty, { width: tw, lineBreak: false },
  );
  ty += 9;

  // Aniversário
  const bday = fmtBirthday(p.birthday);
  if (bday) {
    doc.fillColor(C.bday).font('Helvetica').fontSize(6).text(
      'Aniv.: ' + bday, tx, ty, { width: tw, lineBreak: false },
    );
    ty += 9;
  }

  // Contatos
  const lines: string[] = [];
  if (p.phone) lines.push(p.phone);
  if (p.email) lines.push(trunc(p.email, 30));
  if (lines.length > 0) {
    doc.fillColor(C.contact).font('Helvetica').fontSize(5.5).text(
      lines.join('  |  '), tx, ty, { width: tw, lineBreak: false },
    );
  }
}

// ── Capa + Editorial ──────────────────────────────────────────────────────────

function buildCoverPage(
  doc: PDFKit.PDFDocument,
  authorities: Authority[],
  filterLabel: string | undefined,
  brasao: string,
  dateStr: string,
) {
  // Header grande (mesma paleta)
  doc.save();
  doc.rect(0, 0, A4_W, 215).fill(C.navy);
  doc.rect(A4_W * 0.65, 0, A4_W * 0.35, 215).fill(C.green);
  doc.rect(A4_W * 0.61, 0, A4_W * 0.07, 215).fill(C.navyMid);
  doc.restore();

  if (fs.existsSync(brasao)) {
    doc.image(brasao, A4_W / 2 - 36, 26, { height: 74 });
  }

  doc.fillColor('#bfdbfe').font('Helvetica').fontSize(10).text(
    'GABINETE VIRTUAL', ML, 108, { align: 'center', width: CW },
  );
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(18).text(
    'ESTADO DE RORAIMA', ML, 124, { align: 'center', width: CW },
  );

  // Linha decorativa
  doc.save();
  doc.moveTo(ML + 80, 154).lineTo(A4_W - MR - 80, 154)
    .strokeColor('#60a5fa').lineWidth(1).stroke();
  doc.restore();

  const titleText = filterLabel || 'CADERNO DE AUTORIDADES';
  doc.fillColor('#e0f2fe').font('Helvetica-Bold').fontSize(12).text(
    titleText, ML, 161, { align: 'center', width: CW },
  );

  // ── EDITORIAL ───────────────────────────────────────────────────────────
  const ey = 240;
  doc.fillColor(C.name).font('Helvetica-Bold').fontSize(12).text('EDITORIAL', ML, ey);
  doc.save();
  doc.moveTo(ML, ey + 18).lineTo(ML + 56, ey + 18)
    .strokeColor(C.navy).lineWidth(2).stroke();
  doc.restore();

  const paragrafos = [
    'Este Caderno de Autoridades foi elaborado pelo Gabinete da Vereadora Carol Dantas para uso interno da equipe parlamentar e relacionamento institucional do mandato na C\u00e2mara Municipal de Boa Vista \u2013 Roraima.',
    'O documento re\u00fane os principais agentes p\u00fablicos do Poder Executivo Federal, Estadual e Municipal, incluindo secret\u00e1rios, presidentes de autarquias, vereadores e demais autoridades que integram o mapa do poder do Estado de Roraima.',
    'Os dados s\u00e3o mantidos e atualizados pela plataforma Gabinete Virtual. Recomenda-se a confer\u00eancia das informa\u00e7\u00f5es de contato antes de correspond\u00eancias formais.',
  ];

  let ety = ey + 28;
  for (const para of paragrafos) {
    doc.fillColor(C.cargo).font('Helvetica').fontSize(9).text(
      para, ML, ety, { width: CW, lineGap: 2 },
    );
    ety += 55;
  }

  // ── ESTATÍSTICAS ────────────────────────────────────────────────────────
  const sy   = ety + 12;
  const total = authorities.length;
  const fedN  = authorities.filter(a => a.cadin_organizations.sphere === 'federal').length;
  const estN  = authorities.filter(a => a.cadin_organizations.sphere === 'estadual').length;
  const munN  = authorities.filter(a => a.cadin_organizations.sphere === 'municipal').length;

  const bw   = 112;
  const bgap = (CW - 3 * bw) / 2;
  const stats = [
    { label: 'Federal',   n: fedN, color: C.federal,   bg: C.fedBg },
    { label: 'Estadual',  n: estN, color: C.estadual,  bg: C.estBg },
    { label: 'Municipal', n: munN, color: C.municipal, bg: C.munBg },
  ];

  stats.forEach((s, i) => {
    const bx = ML + i * (bw + bgap);
    doc.save();
    doc.roundedRect(bx, sy, bw, 60, 6).fill(s.bg);
    doc.restore();
    doc.fillColor(s.color).font('Helvetica-Bold').fontSize(28).text(
      String(s.n), bx, sy + 6, { width: bw, align: 'center' },
    );
    doc.fillColor(C.cargo).font('Helvetica').fontSize(9).text(
      s.label, bx, sy + 42, { width: bw, align: 'center' },
    );
  });

  doc.fillColor(C.org).font('Helvetica').fontSize(8.5).text(
    `${total} autoridade${total !== 1 ? 's' : ''} cadastrada${total !== 1 ? 's' : ''}   \u00b7   Atualizado: ${dateStr}`,
    ML, sy + 70, { align: 'center', width: CW },
  );

  // Rodapé da capa
  doc.save();
  doc.rect(0, A4_H - 30, A4_W, 30).fill(C.navy);
  doc.restore();
  doc.fillColor('#93c5fd').font('Helvetica').fontSize(7.5).text(
    'Gabinete Vereadora Carol Dantas  \u00b7  CMBV  \u00b7  Boa Vista \u2014 Roraima',
    ML, A4_H - 30 + 10, { align: 'center', width: CW },
  );
}

// ── Gerador principal ─────────────────────────────────────────────────────────

async function buildPDF(authorities: Authority[], filterLabel?: string): Promise<Buffer> {
  const photoCache = await prefetchPhotos(authorities);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MT, bottom: MB + FOOTER_H, left: ML, right: MR },
      bufferPages: true,
      info: {
        Title:   filterLabel || 'Caderno de Autoridades do Estado de Roraima',
        Author:  'Gabinete Virtual \u2014 CMBV',
        Subject: 'Caderno de Autoridades do Estado de Roraima',
        Creator: 'Gabinete Virtual \u2014 CMBV',
      },
    });

    doc.on('data',  c  => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const now     = new Date();
    const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const brasao  = path.join(process.cwd(), 'Marcas', 'Bras\u00e3o_de_Roraima.svg.png');

    // ── CAPA ────────────────────────────────────────────────────────────────
    buildCoverPage(doc, authorities, filterLabel, brasao, dateStr);

    // ── ORDENAÇÃO: hierarquia de poder (modelo CADIN set/2025) ──────────────
    // Sequência: Governo Estadual → Secretarias Estaduais → PGE/Defensoria →
    //            Autarquias/Empresas Estaduais → Comandos Militares/Delegacias →
    //            Senadores → Deputados Federais → Assembleia Legislativa →
    //            Tribunais/MP → Prefeitura Municipal → Câmara Municipal
    //
    // Dentro de cada grupo: por nome do órgão, depois importância do cargo
    // (Governador/Prefeito/Presidente > Secretário > Adj. > Diretor > outros)

    function orgSortGroup(o: CadinOrganization, title: string): number {
      const n = (o.name || '').toUpperCase();
      const t = (o.type || '').toLowerCase();
      const cargo = title.toUpperCase();

      // ── ESTADUAL ──
      if (o.sphere === 'estadual') {
        if (n.includes('GOVERNO DO ESTADO') || n.includes('GOVERNADORIA')) return 10;
        if (n.includes('CASA CIVIL')) return 11;
        if (n.includes('CASA MILITAR')) return 12;
        if (n.includes('CERIMONIAL') || n.includes('RELAÇÕES PÚBLICAS')) return 13;
        if (n.includes('SECRETARIA') || t === 'secretaria') return 20;
        if (n.includes('PROCURADORIA GERAL DO ESTADO') || n.includes('PGE')) return 30;
        if (n.includes('DEFENSORIA')) return 31;
        if (t === 'autarquia' || t === 'empresa_publica' || t === 'fundacao' ||
            n.includes('COMPANHIA') || n.includes('INSTITUTO') || n.includes('AGÊNCIA') ||
            n.includes('FUNDAÇÃO')) return 40;
        if (n.includes('COMANDO') || n.includes('POLÍCIA MILITAR') || n.includes('BOMBEIRO') ||
            n.includes('BRIGADA') || n.includes('DELEGACIA') || n.includes('CIPA')) return 50;
        if (n.includes('ASSEMBLEIA LEGISLATIVA') || cargo.includes('DEPUTADO ESTADUAL')) return 70;
        if (n.includes('TRIBUNAL') || n.includes('MINISTÉRIO PÚBLICO')) return 80;
        return 45; // outros estaduais
      }

      // ── FEDERAL ──
      if (o.sphere === 'federal') {
        if (n.includes('SENADO') || cargo.includes('SENADOR')) return 60;
        if (n.includes('CÂMARA DOS DEPUTADOS') || cargo.includes('DEPUTADO FEDERAL')) return 65;
        if (n.includes('TRIBUNAL') || n.includes('MINISTÉRIO PÚBLICO') || n.includes('TCU')) return 80;
        return 66; // outros federais
      }

      // ── MUNICIPAL ──
      if (o.sphere === 'municipal') {
        if (n.includes('PREFEITURA') || cargo.includes('PREFEITO')) return 90;
        if (n.includes('SECRETARIA') && o.sphere === 'municipal') return 91;
        if (n.includes('CÂMARA MUNICIPAL') || cargo.includes('VEREADOR')) return 95;
        return 92; // outros municipais
      }

      return 99;
    }

    function cargoSortRank(title: string): number {
      const t = title.toUpperCase();
      if (t.includes('GOVERNADOR') && !t.includes('VICE')) return 0;
      if (t.includes('VICE-GOVERNADOR') || t.includes('VICE GOVERNADOR')) return 1;
      if (t.includes('PREFEITO') && !t.includes('VICE')) return 0;
      if (t.includes('VICE-PREFEITO') || t.includes('VICE PREFEITO')) return 1;
      if (t.includes('PRESIDENTE') && !t.includes('VICE')) return 0;
      if (t.includes('VICE-PRESIDENTE') || t.includes('VICE PRESIDENTE')) return 1;
      if (t.includes('SENADOR')) return 2;
      if (/\bSECRET[ÁA]RI[OA]\b/.test(t) && t.includes('CHEFE')) return 2;
      if (/\bSECRET[ÁA]RI[OA]\b/.test(t) && !t.includes('ADJUNT')) return 3;
      if (/\bSECRET[ÁA]RI[OA]\b/.test(t) && t.includes('ADJUNT')) return 4;
      if (t.includes('DIRETOR') && t.includes('PRESIDENTE')) return 3;
      if (t.includes('DIRETOR') && !t.includes('ADJUNT')) return 4;
      if (t.includes('COMANDANTE') || t.includes('DELEGADO GERAL')) return 3;
      if (t.includes('PROCURADOR') || t.includes('DEFENSOR')) return 3;
      if (t.includes('DESEMBARGADOR')) return 3;
      if (t.includes('VEREADOR')) return 5;
      if (t.includes('DEPUTADO')) return 5;
      return 6;
    }

    const sorted = [...authorities].sort((a, b) => {
      const ga = orgSortGroup(a.cadin_organizations, a.title);
      const gb = orgSortGroup(b.cadin_organizations, b.title);
      if (ga !== gb) return ga - gb;
      // Dentro do mesmo grupo: por órgão
      const orgCmp = (a.cadin_organizations.name || '').localeCompare(b.cadin_organizations.name || '', 'pt-BR');
      if (orgCmp !== 0) return orgCmp;
      // Dentro do mesmo órgão: por importância do cargo
      const ra = cargoSortRank(a.title);
      const rb = cargoSortRank(b.title);
      if (ra !== rb) return ra - rb;
      return (a.cadin_persons.full_name || '').localeCompare(b.cadin_persons.full_name || '', 'pt-BR');
    });

    // ── Mapa de grupo → label do banner ──
    const GROUP_LABELS: Record<number, { label: string; sphere: Sphere }> = {
      10: { label: 'GOVERNO DO ESTADO DE RORAIMA', sphere: 'estadual' },
      20: { label: 'SECRETARIAS DE ESTADO', sphere: 'estadual' },
      30: { label: 'PROCURADORIA E DEFENSORIA', sphere: 'estadual' },
      40: { label: 'AUTARQUIAS E EMPRESAS ESTADUAIS', sphere: 'estadual' },
      45: { label: 'OUTROS ÓRGÃOS ESTADUAIS', sphere: 'estadual' },
      50: { label: 'COMANDOS MILITARES E DELEGACIAS', sphere: 'estadual' },
      60: { label: 'SENADORES DA REPÚBLICA', sphere: 'federal' },
      65: { label: 'DEPUTADOS FEDERAIS', sphere: 'federal' },
      66: { label: 'OUTROS ÓRGÃOS FEDERAIS', sphere: 'federal' },
      70: { label: 'ASSEMBLEIA LEGISLATIVA DE RORAIMA', sphere: 'estadual' },
      80: { label: 'TRIBUNAIS E MINISTÉRIO PÚBLICO', sphere: 'estadual' },
      90: { label: 'PREFEITURA MUNICIPAL DE BOA VISTA', sphere: 'municipal' },
      91: { label: 'SECRETARIAS MUNICIPAIS', sphere: 'municipal' },
      92: { label: 'OUTROS ÓRGÃOS MUNICIPAIS', sphere: 'municipal' },
      95: { label: 'CÂMARA MUNICIPAL DE BOA VISTA', sphere: 'municipal' },
    };

    // ── LAYOUT 2 COLUNAS ────────────────────────────────────────────────────
    let pageOpen       = false;
    let col            = 0;
    let rowY           = PAGE_Y0;
    let currentGroup: number | null = null;

    function openPage() {
      doc.addPage();
      drawPageHeader(doc, brasao);
      rowY     = PAGE_Y0;
      col      = 0;
      pageOpen = true;
    }

    for (let i = 0; i < sorted.length; i++) {
      const a      = sorted[i];
      const group  = orgSortGroup(a.cadin_organizations, a.title);

      // ── Mudança de grupo hierárquico: inserir banner de seção ──────────
      if (group !== currentGroup) {
        // Fechar linha incompleta se estiver na coluna direita
        if (col === 1) {
          col   = 0;
          rowY += CARD_H + CARD_VGAP;
        }

        if (!pageOpen) openPage();

        // Espaço extra antes do banner (exceto se estiver no topo da página)
        if (rowY > PAGE_Y0 + 2) rowY += 8;

        // Nova página se não couber banner + ao menos 1 card
        if (rowY + SECTION_H + 4 + CARD_H > PAGE_Y1) {
          openPage();
        }

        const groupInfo = GROUP_LABELS[group] || { label: 'OUTROS', sphere: a.cadin_organizations.sphere };
        rowY = drawSphereBanner(doc, groupInfo.sphere, rowY, groupInfo.label);
        currentGroup = group;
      }

      // ── Garantir que há página aberta ──────────────────────────────────
      if (!pageOpen) openPage();

      // ── Quebra de página ao iniciar coluna esquerda ────────────────────
      if (col === 0 && rowY + CARD_H > PAGE_Y1) {
        openPage();
      }

      // ── Desenhar card ──────────────────────────────────────────────────
      const cardX = col === 0 ? ML : ML + COL_W + COL_GAP;
      drawCard(doc, a, cardX, rowY, COL_W, photoCache);

      if (col === 0) {
        col = 1;
      } else {
        col   = 0;
        rowY += CARD_H + CARD_VGAP;
        // Antecipar quebra de página para o próximo par (não adiciona página vazia no final)
        if (i < sorted.length - 1 && rowY + CARD_H > PAGE_Y1) {
          openPage();
        }
      }
    }

    // ── NUMERAÇÃO DE PÁGINAS ─────────────────────────────────────────────
    const range      = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let p = range.start; p < range.start + totalPages; p++) {
      if (p === 0) continue; // capa tem rodapé próprio
      doc.switchToPage(p);
      drawPageFooter(doc, p + 1, totalPages);
    }

    doc.flushPages();
    doc.end();
  });
}

// ── Helpers do cache / rota ───────────────────────────────────────────────────

function buildFilterHash(params: Record<string, string>): string {
  const sorted = Object.entries(params)
    .filter(([, v]) => !!v)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v.toLowerCase()}`)
    .join('&');
  return crypto.createHash('md5').update(sorted || 'all').digest('hex');
}

function buildFilterLabel(sphere?: string | null, type?: string | null, cargo?: string | null): string | undefined {
  const parts: string[] = [];
  if (cargo) parts.push(cargo.toUpperCase());
  if (type) {
    const TIPO: Record<string, string> = {
      secretaria: 'SECRETARIAS', autarquia: 'AUTARQUIAS', fundacao: 'FUNDA\u00c7\u00d5ES',
      empresa_publica: 'EMPRESAS P\u00daBLICAS', camara: 'C\u00c2MARAS',
      prefeitura: 'PREFEITURAS', judiciario: 'JUDICI\u00c1RIO',
      governo_estadual: 'GOVERNO ESTADUAL', outros: 'OUTROS',
    };
    parts.push(TIPO[type] || type.toUpperCase());
  }
  if (sphere && sphere !== 'todos') {
    const SPHERE: Record<string, string> = { federal: 'FEDERAIS', estadual: 'ESTADUAIS', municipal: 'MUNICIPAIS' };
    parts.push(SPHERE[sphere] || sphere.toUpperCase());
  }
  if (parts.length === 0) return undefined;
  return `CADERNO DE AUTORIDADES \u2014 ${parts.join(' \u00b7 ')}`;
}

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const svc = getServiceSupabase();

    const { searchParams } = new URL(request.url);
    const sphereParam = searchParams.get('sphere') as Sphere | null;
    const typeParam   = searchParams.get('type');
    const cargoParam  = searchParams.get('cargo');

    // ── Verificar cache ────────────────────────────────────────────────────
    const filterHash = buildFilterHash({
      sphere: sphereParam || '',
      type:   typeParam   || '',
      cargo:  cargoParam  || '',
    });

    const { data: cached } = await svc
      .from('cadin_pdf_cache')
      .select('pdf_public_url, pdf_storage_path, expires_at')
      .eq('filter_hash', filterHash)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached?.pdf_storage_path) {
      const { data: fileData } = await svc.storage
        .from('gabinete_media')
        .download(cached.pdf_storage_path);

      if (fileData) {
        const buf         = Buffer.from(await fileData.arrayBuffer());
        const filterLabel = buildFilterLabel(sphereParam, typeParam, cargoParam);
        const filename    = `Caderno_Autoridades_RR_${filterLabel ? filterLabel.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40) : 'Completo'}_${new Date().toISOString().slice(0, 10)}.pdf`;
        return new Response(new Uint8Array(buf), {
          headers: {
            'Content-Type':        'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control':       'public, max-age=3600',
            'X-PDF-Cache':         'HIT',
          },
        });
      }
    }

    // ── Buscar autoridades ─────────────────────────────────────────────────
    const { data: appointments, error: dbError } = await svc
      .from('cadin_appointments')
      .select(`
        title, dou_url, notes, created_at,
        cadin_persons ( full_name, phone, email, party, notes, photo_url, birthday ),
        cadin_organizations ( name, acronym, type, sphere, phone, email, website )
      `)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (dbError) {
      console.error('export-pdf db error:', dbError.message);
      return new Response(dbError.message, { status: 500 });
    }

    let all = (appointments ?? []) as unknown as Authority[];

    if (sphereParam) all = all.filter(a => a.cadin_organizations.sphere === sphereParam);
    if (typeParam)   all = all.filter(a => a.cadin_organizations.type?.toLowerCase() === typeParam.toLowerCase());
    if (cargoParam)  all = all.filter(a => a.title.toLowerCase().includes(cargoParam.toLowerCase()));

    const filterLabel = buildFilterLabel(sphereParam, typeParam, cargoParam);
    const pdfBuffer   = await buildPDF(all, filterLabel);

    // ── Gravar no cache (async, não bloqueia a resposta) ──────────────────
    const storagePath = `cadin-pdfs/${filterHash}_${new Date().toISOString().slice(0, 10)}.pdf`;

    svc.storage
      .from('gabinete_media')
      .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
      .then(({ error: uploadErr }) => {
        if (uploadErr) { console.error('PDF cache upload error:', uploadErr.message); return; }
        const { data: urlData } = svc.storage.from('gabinete_media').getPublicUrl(storagePath);
        svc.from('cadin_pdf_cache').upsert({
          filter_hash:      filterHash,
          sphere:           sphereParam || null,
          org_type:         typeParam   || null,
          cargo:            cargoParam  || null,
          label:            filterLabel || 'Caderno Completo',
          authority_count:  all.length,
          pdf_storage_path: storagePath,
          pdf_public_url:   urlData?.publicUrl || '',
          created_at:       new Date().toISOString(),
          expires_at:       new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'filter_hash' }).then(({ error: e }) => {
          if (e) console.error('PDF cache insert error:', e.message);
        });
      });

    const filename = `Caderno_Autoridades_RR_${new Date().toISOString().slice(0, 10)}.pdf`;

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
        'X-PDF-Cache':         'MISS',
      },
    });
  } catch (err) {
    console.error('export-pdf error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
