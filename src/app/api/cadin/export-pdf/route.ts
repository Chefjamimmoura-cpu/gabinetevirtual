import { createClient as createServiceClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Aumenta o timeout da rota para 5 minutos (geração de PDF com muitas autoridades)
export const maxDuration = 300;

// ── Tipos ────────────────────────────────────────────────────────────────────

type Sphere = 'federal' | 'estadual' | 'municipal';

interface CadinPerson {
  full_name: string;
  phone: string | null;
  email: string | null;
  party: string | null;
  notes: string | null;
  photo_url: string | null;
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

// ── Constantes visuais ────────────────────────────────────────────────────────

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 60;
const CONTENT_W = A4_W - MARGIN * 2;

const COLORS: Record<string, string> = {
  dark:        '#1e1b4b',
  purple:      '#6d28d9',
  purpleLight: '#a78bfa',
  purplePale:  '#ede9fe',
  federal:     '#1d4ed8',
  estadual:    '#9d174d',
  municipal:   '#065f46',
  gray:        '#4b5563',
  grayLight:   '#9ca3af',
  divider:     '#e5e7eb',
  cardBg:      '#f8f7ff',
  white:       '#ffffff',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(nome: string | null, orgao: string): string {
  const src = nome || orgao;
  const w = src.trim().split(/\s+/);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

// ── Gerador de PDF ────────────────────────────────────────────────────────────

function addPageFooter(
  doc: PDFKit.PDFDocument,
  pageIndex: number,
  totalPages: number
) {
  const y = A4_H - 36;
  doc.save();
  doc.rect(0, y, A4_W, 36).fill(COLORS.dark);
  doc.fillColor(COLORS.purpleLight).font('Helvetica').fontSize(7.5).text(
    'Gabinete Vereadora Carol Dantas  \u00b7  CMBV  \u00b7  Boa Vista \u2014 Roraima',
    MARGIN,
    y + 11,
    { width: CONTENT_W - 60 }
  );
  doc.fillColor(COLORS.white).font('Helvetica').fontSize(7.5).text(
    `P\u00e1g. ${pageIndex} / ${totalPages}`,
    MARGIN,
    y + 11,
    { width: CONTENT_W, align: 'right' }
  );
  doc.restore();
}

// Pré-busca todas as fotos em paralelo com timeout de 4s cada.
// Retorna Map<photo_url, Buffer> — fotos que falharem ficam ausentes (usa iniciais).
async function prefetchPhotos(authorities: Authority[]): Promise<Map<string, Buffer>> {
  const urls = [...new Set(authorities.map(a => a.cadin_persons.photo_url).filter(Boolean))] as string[];
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return { url, buf };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const map = new Map<string, Buffer>();
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) map.set(r.value.url, r.value.buf);
  }
  return map;
}

async function buildPDF(authorities: Authority[], filterLabel?: string): Promise<Buffer> {
  // Pré-carrega fotos em paralelo antes de abrir o documento
  const photoCache = await prefetchPhotos(authorities);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: 72, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: filterLabel || 'Caderno de Autoridades do Estado de Roraima',
        Author: 'Gabinete Virtual',
        Subject: 'Caderno de Autoridades do Estado de Roraima',
        Creator: 'Gabinete Virtual \u2014 CMBV',
      },
    });

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    const total = authorities.length;

    // ── CAPA ─────────────────────────────────────────────────────────────────

    // Lado esquerdo e superior pra decorar
    doc.save();
    doc.rect(0, 0, A4_W, 180).fill(COLORS.dark);
    doc.restore();

    // Brasão Roraima no topo central da capa (pequeno e elegante)
    const brasaoPath = path.join(process.cwd(), 'Marcas', 'Brasão_de_Roraima.svg.png');
    if (fs.existsSync(brasaoPath)) {
      doc.image(brasaoPath, A4_W / 2 - 28, 28, { width: 56 });
    }

    // Título institucional logo abaixo do brasão
    doc.fillColor(COLORS.purpleLight).font('Helvetica').fontSize(9).text(
      'ESTADO DE RORAIMA',
      MARGIN, 96, { align: 'center', width: CONTENT_W }
    );

    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(filterLabel ? 13 : 15).text(
      filterLabel || 'CADERNO DE AUTORIDADES DO ESTADO DE RORAIMA',
      MARGIN, 112, { align: 'center', width: CONTENT_W }
    );

    // Linha decorativa fina
    doc.save();
    const lineW = 200;
    doc.moveTo(A4_W / 2 - lineW / 2, 140)
       .lineTo(A4_W / 2 + lineW / 2, 140)
       .strokeColor(COLORS.purpleLight)
       .lineWidth(0.8)
       .stroke();
    doc.restore();

    doc.fillColor(COLORS.purplePale).font('Helvetica').fontSize(9).text(
      'Relacionamento Institucional & Mapa do Poder',
      MARGIN, 148, { align: 'center', width: CONTENT_W }
    );

    // Caixas de estatísticas
    const boxW = 120;
    const boxGap = 20;
    const totalBoxW = 3 * boxW + 2 * boxGap;
    const startX = (A4_W - totalBoxW) / 2;
    const boxY = 350;

    const fedList = authorities.filter(a => a.cadin_organizations.sphere === 'federal').length;
    const estList = authorities.filter(a => a.cadin_organizations.sphere === 'estadual').length;
    const munList = authorities.filter(a => a.cadin_organizations.sphere === 'municipal').length;

    const sphereStats = [
      { label: 'Federal',   count: fedList,   bg: '#dbeafe', fg: COLORS.federal },
      { label: 'Estadual',  count: estList,  bg: '#fce7f3', fg: COLORS.estadual },
      { label: 'Municipal', count: munList, bg: '#d1fae5', fg: COLORS.municipal },
    ];

    sphereStats.forEach((s, i) => {
      const bx = startX + i * (boxW + boxGap);
      doc.save();
      doc.roundedRect(bx, boxY, boxW, 62, 10).fill(s.bg);
      doc.restore();
      doc.fillColor(s.fg).font('Helvetica-Bold').fontSize(28).text(
        String(s.count), bx, boxY + 8, { width: boxW, align: 'center' }
      );
      doc.fillColor(COLORS.gray).font('Helvetica').fontSize(10).text(
        s.label, bx, boxY + 40, { width: boxW, align: 'center' }
      );
    });

    // Total e data
    doc.fillColor(COLORS.grayLight).font('Helvetica').fontSize(10).text(
      `${total} autoridade${total !== 1 ? 's' : ''} cadastrada${total !== 1 ? 's' : ''}   \u00b7   Atualizado: ${dateStr}`,
      MARGIN, 440, { align: 'center', width: CONTENT_W }
    );

    // Gabinete credit (subtle, bottom area)
    doc.fillColor(COLORS.grayLight).font('Helvetica').fontSize(8).text(
      'Gabinete Virtual — Câmara Municipal de Boa Vista',
      MARGIN, 480, { align: 'center', width: CONTENT_W }
    );

    // Faixa rodapé da capa
    doc.save();
    doc.rect(0, A4_H - 36, A4_W, 36).fill(COLORS.dark);
    doc.restore();
    doc.fillColor(COLORS.purpleLight).font('Helvetica').fontSize(7.5).text(
      'Gabinete Vereadora Carol Dantas  \u00b7  CMBV  \u00b7  Boa Vista \u2014 Roraima',
      MARGIN, A4_H - 36 + 11, { align: 'center', width: CONTENT_W }
    );

    // ── LISTA CONTÍNUA DE AUTORIDADES ─────────────────────────────────────────

    doc.addPage();
    let y = MARGIN;

    // Faixa de cabeçalho da lista
    doc.save();
    doc.rect(0, 0, A4_W, 70).fill(COLORS.dark);
    doc.restore();

    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(16).text(
      'Lista Oficial de Autoridades', MARGIN, 26, { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor(COLORS.purpleLight).font('Helvetica').fontSize(9.5).text(
      `Estado de Roraima \u2014 ${dateStr}`, MARGIN, 46, { width: CONTENT_W, align: 'center' }
    );

    y = 90;

    for (let i = 0; i < authorities.length; i++) {
        const a = authorities[i];
        const p = a.cadin_persons;
        const o = a.cadin_organizations;

        const sphereColor = COLORS[o.sphere] || COLORS.gray;

        // Linhas de contato para calcular a altura do card
        const contactLines: string[] = [];
        if (p.phone) contactLines.push(`Tel: ${p.phone}`);
        if (p.email) contactLines.push(`Email: ${p.email}`);
        if (p.party) contactLines.push(`Partido: ${p.party}`);
        if (o.phone && o.phone !== p.phone) contactLines.push(`Org. Tel: ${o.phone}`);

        const hasContacts = contactLines.length > 0;
        const hasNotes = !!p.notes;
        const cardH = 20 + 14 + 14 + (hasContacts ? 14 : 0) + (hasNotes ? 12 : 0) + 16;
        const computedH = cardH < 60 ? 60 : cardH; // Minimal height to fit avatar

        if (y + computedH > A4_H - 80) {
          doc.addPage();
          y = MARGIN;
        }

        if (i % 2 === 0) {
          doc.save();
          doc.roundedRect(MARGIN, y, CONTENT_W, computedH - 6, 4).fill(COLORS.cardBg);
          doc.restore();
        }

        // Pill lateral de esfera
        doc.save();
        doc.rect(MARGIN, y + 2, 4, computedH - 10).fill(sphereColor);
        doc.restore();

        // ── Render Avatar (usa cache pré-carregado, sem await no loop)
        let avatarRendered = false;
        const photoBuffer = p.photo_url ? photoCache.get(p.photo_url) : undefined;
        if (photoBuffer) {
          try {
            doc.save();
            doc.circle(MARGIN + 34, y + (computedH / 2) - 3, 22).clip();
            doc.image(photoBuffer, MARGIN + 12, y + (computedH / 2) - 25, { width: 44, height: 44 });
            doc.restore();
            avatarRendered = true;
          } catch {
            // foto corrompida — cai para iniciais
          }
        }
        if (!avatarRendered) {
          doc.save();
          doc.circle(MARGIN + 34, y + (computedH / 2) - 3, 22).fill('#e2e8f0');
          doc.restore();
          doc.fillColor(sphereColor).font('Helvetica-Bold').fontSize(14).text(
            getInitials(p.full_name, o.name),
            MARGIN + 14, y + (computedH / 2) - 8, { width: 40, align: 'center' }
          );
        }

        const cx2 = MARGIN + 66;

        // Departamento (Órgão) em destaque
        const orgLabel = o.acronym ? `${o.name} (${o.acronym})` : o.name;
        doc.fillColor(COLORS.dark).font('Helvetica-Bold').fontSize(12).text(
          orgLabel, cx2, y + 8, { width: CONTENT_W - 70 }
        );

        // Cargo
        doc.fillColor(COLORS.gray).font('Helvetica-Bold').fontSize(9.5).text(
          a.title.toUpperCase(), cx2, y + 25, { width: CONTENT_W - 70 }
        );

        // Nome
        doc.fillColor('#0ea5e9').font('Helvetica-Bold').fontSize(10).text(
          p.full_name, cx2, y + 38, { width: CONTENT_W - 70 }
        );

        if (hasContacts) {
          doc.fillColor(COLORS.gray).font('Helvetica').fontSize(8.5).text(
            contactLines.join('   |   '), cx2, y + 53, { width: CONTENT_W - 70 }
          );
        }

        if (hasNotes) {
          const notesY = y + (hasContacts ? 67 : 53);
          doc.fillColor(COLORS.grayLight).font('Helvetica-Oblique').fontSize(8).text(
            `Obs: ${p.notes}`, cx2, notesY, { width: CONTENT_W - 70 }
          );
        }

        if (i < authorities.length - 1) {
          doc.save();
          doc.moveTo(MARGIN, y + computedH - 2).lineTo(A4_W - MARGIN, y + computedH - 2)
             .strokeColor(COLORS.divider).lineWidth(0.4).stroke();
          doc.restore();
        }

        y += computedH;
    }

    // ── NUMERAÇÃO DE PÁGINAS ──────────────────────────────────────────────────

    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = range.start; i < range.start + totalPages; i++) {
      if (i === 0) continue; // capa já tem rodapé
      doc.switchToPage(i);
      addPageFooter(doc, i + 1, totalPages);
    }

    doc.flushPages();
    doc.end();
  });
}

// ── Route Handler ─────────────────────────────────────────────────────────────

// ── Cache helpers ─────────────────────────────────────────────────────────────

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
    const TIPO_LABELS: Record<string, string> = {
      secretaria: 'SECRETARIAS', autarquia: 'AUTARQUIAS', fundacao: 'FUNDAÇÕES',
      empresa_publica: 'EMPRESAS PÚBLICAS', camara: 'CÂMARAS', prefeitura: 'PREFEITURAS',
      judiciario: 'JUDICIÁRIO', governo_estadual: 'GOVERNO ESTADUAL', outros: 'OUTROS',
    };
    parts.push(TIPO_LABELS[type] || type.toUpperCase());
  }
  if (sphere && sphere !== 'todos') {
    const SPHERE_LABELS: Record<string, string> = { federal: 'FEDERAIS', estadual: 'ESTADUAIS', municipal: 'MUNICIPAIS' };
    parts.push(SPHERE_LABELS[sphere] || sphere.toUpperCase());
  }
  if (parts.length === 0) return undefined;
  return `CADERNO DE AUTORIDADES — ${parts.join(' · ')}`;
}

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    // Usa service role diretamente — consistente com todas as outras rotas CADIN
    // (organizations, birthdays, persons — nenhuma usa cookie auth)
    const svc = getServiceSupabase();

    const { searchParams } = new URL(request.url);
    const sphereParam = searchParams.get('sphere') as Sphere | null;
    const typeParam = searchParams.get('type');
    const cargoParam = searchParams.get('cargo');

    // ── Verificar cache ────────────────────────────────────────────────────
    const filterHash = buildFilterHash({
      sphere: sphereParam || '',
      type: typeParam || '',
      cargo: cargoParam || '',
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
        const buf = Buffer.from(await fileData.arrayBuffer());
        const filterLabel = buildFilterLabel(sphereParam, typeParam, cargoParam);
        const filename = `Caderno_Autoridades_RR_${filterLabel ? filterLabel.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40) : 'Completo'}_${new Date().toISOString().slice(0, 10)}.pdf`;
        return new Response(new Uint8Array(buf), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'public, max-age=3600',
            'X-PDF-Cache': 'HIT',
          },
        });
      }
    }

    // ── Gerar novo PDF ─────────────────────────────────────────────────────
    const { data: appointments, error: dbError } = await svc
      .from('cadin_appointments')
      .select(`
        title, dou_url, notes, created_at,
        cadin_persons ( full_name, phone, email, party, notes, photo_url ),
        cadin_organizations ( name, acronym, type, sphere, phone, email, website )
      `)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (dbError) {
      console.error('export-pdf db error:', dbError.message);
      return new Response(dbError.message, { status: 500 });
    }

    let all = (appointments ?? []) as unknown as Authority[];

    // Filtros
    if (sphereParam) {
      all = all.filter((a) => a.cadin_organizations.sphere === sphereParam);
    }
    if (typeParam) {
      all = all.filter((a) => a.cadin_organizations.type?.toLowerCase() === typeParam.toLowerCase());
    }
    if (cargoParam) {
      all = all.filter((a) => a.title.toLowerCase().includes(cargoParam.toLowerCase()));
    }

    const filterLabel = buildFilterLabel(sphereParam, typeParam, cargoParam);
    const pdfBuffer = await buildPDF(all, filterLabel);

    // ── Gravar no cache (async, não bloqueia a resposta) ──────────────────
    const storagePath = `cadin-pdfs/${filterHash}_${new Date().toISOString().slice(0, 10)}.pdf`;

    svc.storage
      .from('gabinete_media')
      .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
      .then(({ error: uploadErr }) => {
        if (uploadErr) {
          console.error('PDF cache upload error:', uploadErr.message);
          return;
        }
        const { data: urlData } = svc.storage.from('gabinete_media').getPublicUrl(storagePath);
        const publicUrl = urlData?.publicUrl || '';

        svc.from('cadin_pdf_cache').upsert({
          filter_hash: filterHash,
          sphere: sphereParam || null,
          org_type: typeParam || null,
          cargo: cargoParam || null,
          label: filterLabel || 'Caderno Completo',
          authority_count: all.length,
          pdf_storage_path: storagePath,
          pdf_public_url: publicUrl,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'filter_hash' }).then(({ error: cacheErr }) => {
          if (cacheErr) console.error('PDF cache insert error:', cacheErr.message);
        });
      });

    const filename = `Caderno_Autoridades_RR_${new Date().toISOString().slice(0, 10)}.pdf`;

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-PDF-Cache': 'MISS',
      },
    });
  } catch (err) {
    console.error('export-pdf error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
