// GET /api/cadin/export-pdf-birthdays?month=4&day=15
// Gera PDF A4 formatado da lista de aniversariantes do CADIN.
// Usa cadin_pdf_cache (7 dias) para evitar regeneração.

import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createClient as createServiceClient } from '@supabase/supabase-js';

export const maxDuration = 120;

// ── Constantes visuais ────────────────────────────────────────────────────────

const A4_W  = 595.28;
const A4_H  = 841.89;
const MARGIN = 50;
const COL_W  = A4_W - MARGIN * 2;

const C = {
  dark:        '#1e1b4b',
  purple:      '#6d28d9',
  purpleLight: '#a78bfa',
  purplePale:  '#ede9fe',
  pink:        '#be185d',
  pinkLight:   '#fce7f3',
  federal:     '#1d4ed8',
  estadual:    '#9d174d',
  municipal:   '#065f46',
  gray:        '#4b5563',
  grayLight:   '#9ca3af',
  divider:     '#e5e7eb',
  cardBg:      '#fdf4ff',
  white:       '#ffffff',
};

const MESES: Record<number, string> = {
  1:'Janeiro', 2:'Fevereiro', 3:'Março', 4:'Abril',
  5:'Maio', 6:'Junho', 7:'Julho', 8:'Agosto',
  9:'Setembro', 10:'Outubro', 11:'Novembro', 12:'Dezembro',
};

const SPHERE_COLOR: Record<string, string> = {
  federal: C.federal, estadual: C.estadual, municipal: C.municipal,
};

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface BdPerson {
  full_name: string;
  birthday_day: number;
  birthday_display: string | null;
  cargo: string | null;
  org_name: string | null;
  org_sphere: string | null;
  phone: string | null;
  email: string | null;
  org_phone: string | null;
  org_email: string | null;
  org_address: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function footer(doc: PDFKit.PDFDocument, page: number, total: number) {
  doc.save();
  doc.rect(0, A4_H - 32, A4_W, 32).fill(C.dark);
  doc.fillColor(C.purpleLight).font('Helvetica').fontSize(7).text(
    'Gabinete Vereadora Carol Dantas  ·  CMBV  ·  Boa Vista — Roraima',
    MARGIN, A4_H - 32 + 10, { width: COL_W - 60 },
  );
  doc.fillColor(C.white).font('Helvetica').fontSize(7).text(
    `Pág. ${page} / ${total}`, MARGIN, A4_H - 32 + 10,
    { width: COL_W, align: 'right' },
  );
  doc.restore();
}

// ── Gerador de PDF ────────────────────────────────────────────────────────────

function buildBirthdayPDF(persons: BdPerson[], month: number, day: number | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: 60, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `Aniversariantes — ${day ? `${String(day).padStart(2,'0')}/` : ''}${MESES[month]}`,
        Author: 'Gabinete Virtual — CMBV',
      },
    });

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const titulo = day
      ? `Aniversariantes em ${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`
      : `Aniversariantes em ${MESES[month]}`;

    // ── CAPA ─────────────────────────────────────────────────────────────────

    doc.rect(0, 0, A4_W, 160).fill(C.dark);

    // Brasão
    const brasao = path.join(process.cwd(), 'Marcas', 'Brasão_de_Roraima.svg.png');
    if (fs.existsSync(brasao)) {
      doc.image(brasao, A4_W / 2 - 24, 20, { width: 48 });
    }

    doc.fillColor(C.purpleLight).font('Helvetica').fontSize(8).text(
      'ESTADO DE RORAIMA', MARGIN, 76, { align: 'center', width: COL_W },
    );
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(15).text(
      titulo.toUpperCase(), MARGIN, 92, { align: 'center', width: COL_W },
    );

    // Linha decorativa
    doc.moveTo(A4_W / 2 - 80, 120).lineTo(A4_W / 2 + 80, 120)
       .strokeColor(C.purpleLight).lineWidth(0.8).stroke();

    doc.fillColor(C.purplePale).font('Helvetica').fontSize(8).text(
      'Caderno de Autoridades · Relacionamento Institucional',
      MARGIN, 128, { align: 'center', width: COL_W },
    );

    // Caixa de total
    const boxX = A4_W / 2 - 60;
    doc.roundedRect(boxX, 320, 120, 64, 10).fill(C.pinkLight);
    doc.fillColor(C.pink).font('Helvetica-Bold').fontSize(36).text(
      String(persons.length), boxX, 328, { width: 120, align: 'center' },
    );
    doc.fillColor(C.gray).font('Helvetica').fontSize(10).text(
      persons.length === 1 ? 'aniversariante' : 'aniversariantes',
      boxX, 366, { width: 120, align: 'center' },
    );

    doc.fillColor(C.grayLight).font('Helvetica').fontSize(9).text(
      `Emitido em ${dateStr}`,
      MARGIN, 420, { align: 'center', width: COL_W },
    );

    // Rodapé da capa
    doc.rect(0, A4_H - 32, A4_W, 32).fill(C.dark);
    doc.fillColor(C.purpleLight).font('Helvetica').fontSize(7).text(
      'Gabinete Vereadora Carol Dantas  ·  CMBV  ·  Boa Vista — Roraima',
      MARGIN, A4_H - 32 + 10, { align: 'center', width: COL_W },
    );

    // ── LISTA ─────────────────────────────────────────────────────────────────

    doc.addPage();
    let y = MARGIN;

    // Cabeçalho da lista
    doc.rect(0, 0, A4_W, 60).fill(C.dark);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(14).text(
      titulo, MARGIN, 18, { width: COL_W, align: 'center' },
    );
    doc.fillColor(C.purpleLight).font('Helvetica').fontSize(8.5).text(
      `${persons.length} aniversariante${persons.length !== 1 ? 's' : ''}  ·  ${dateStr}`,
      MARGIN, 38, { width: COL_W, align: 'center' },
    );

    y = 76;

    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const sphereColor = SPHERE_COLOR[p.org_sphere ?? ''] ?? C.gray;

      const lines: string[] = [];
      if (p.phone)     lines.push(`📱 ${p.phone}`);
      if (p.org_phone && p.org_phone !== p.phone) lines.push(`☎️ ${p.org_phone}`);
      if (p.email)     lines.push(`✉️ ${p.email}`);
      if (p.org_email && p.org_email !== p.email)  lines.push(`✉️ ${p.org_email}`);
      if (p.org_address) lines.push(`📍 ${p.org_address}`);

      const cardH = Math.max(68, 14 + 13 + 12 + (lines.length > 0 ? Math.ceil(lines.length / 2) * 13 + 4 : 0) + 12);

      if (y + cardH > A4_H - 50) {
        doc.addPage();
        y = MARGIN;
      }

      // Fundo alternado
      if (i % 2 === 0) {
        doc.roundedRect(MARGIN, y, COL_W, cardH - 4, 4).fill(C.cardBg);
      }

      // Pill de esfera (cor lateral)
      doc.rect(MARGIN, y + 2, 4, cardH - 8).fill(sphereColor);

      // Avatar com inicial
      doc.circle(MARGIN + 28, y + cardH / 2 - 2, 20).fill(C.pinkLight);
      doc.fillColor(C.pink).font('Helvetica-Bold').fontSize(13).text(
        p.full_name.charAt(0).toUpperCase(),
        MARGIN + 18, y + cardH / 2 - 9, { width: 20, align: 'center' },
      );

      const tx = MARGIN + 56;
      const tw = COL_W - 60;

      // Data de aniversário (destaque)
      const bdDisplay = p.birthday_display ?? `dia ${p.birthday_day}`;
      doc.fillColor(C.pink).font('Helvetica-Bold').fontSize(9).text(
        `🎂 ${bdDisplay}`, A4_W - MARGIN - 60, y + 10, { width: 60, align: 'right' },
      );

      // Nome
      doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(11).text(
        p.full_name, tx, y + 10, { width: tw - 65 },
      );

      // Cargo
      if (p.cargo) {
        doc.fillColor(C.gray).font('Helvetica-Bold').fontSize(8.5).text(
          p.cargo.toUpperCase(), tx, y + 25, { width: tw },
        );
      }

      // Órgão
      if (p.org_name) {
        doc.fillColor(sphereColor).font('Helvetica').fontSize(8.5).text(
          p.org_name, tx, y + 37, { width: tw },
        );
      }

      // Contatos
      if (lines.length > 0) {
        const contactStr = lines.join('   ');
        doc.fillColor(C.gray).font('Helvetica').fontSize(7.5).text(
          contactStr, tx, y + 50, { width: tw },
        );
      }

      // Divisor
      if (i < persons.length - 1) {
        doc.moveTo(MARGIN, y + cardH).lineTo(A4_W - MARGIN, y + cardH)
           .strokeColor(C.divider).lineWidth(0.3).stroke();
      }

      y += cardH;
    }

    // ── PAGINAÇÃO ─────────────────────────────────────────────────────────────

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      if (i === 0) continue; // capa já tem rodapé
      doc.switchToPage(i);
      footer(doc, i + 1, range.count);
    }

    doc.flushPages();
    doc.end();
  });
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function buildBdHash(month: number, day: number | null): string {
  const key = day ? `type=birthday&month=${month}&day=${day}` : `type=birthday&month=${month}`;
  return crypto.createHash('md5').update(key).digest('hex');
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const monthParam = searchParams.get('month');
  const dayParam   = searchParams.get('day');

  const month = monthParam ? parseInt(monthParam) : new Date().getMonth() + 1;
  const day   = dayParam   ? parseInt(dayParam)   : null;

  const mesNome = MESES[month] ?? String(month);
  const filename = day
    ? `Aniversariantes_${String(day).padStart(2,'0')}_${mesNome}.pdf`
    : `Aniversariantes_${mesNome}.pdf`;

  const svc = getServiceSupabase();
  const filterHash = buildBdHash(month, day);

  // ── Verificar cache (7 dias) ───────────────────────────────────────────────
  const { data: cached } = await svc
    .from('cadin_pdf_cache')
    .select('pdf_storage_path')
    .eq('filter_hash', filterHash)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached?.pdf_storage_path) {
    const { data: fileData } = await svc.storage
      .from('gabinete_media')
      .download(cached.pdf_storage_path);

    if (fileData) {
      const buf = Buffer.from(await fileData.arrayBuffer());
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

  // ── Busca dados e gera PDF ─────────────────────────────────────────────────
  const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const params = new URLSearchParams({ month: String(month) });
  if (day) params.set('day', String(day));

  const res = await fetch(`${INTERNAL_BASE}/api/cadin/birthdays?${params}`);
  if (!res.ok) {
    return NextResponse.json({ error: 'Falha ao buscar aniversariantes' }, { status: 502 });
  }

  const data = await res.json() as { birthdays: BdPerson[] };
  const persons = data.birthdays ?? [];

  const pdfBuffer = await buildBirthdayPDF(persons, month, day);

  // ── Gravar no cache (async, não bloqueia a resposta) ──────────────────────
  const label = day
    ? `Aniversariantes — ${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`
    : `Aniversariantes — ${mesNome}`;
  const storagePath = `cadin-pdfs/${filterHash}_${new Date().toISOString().slice(0, 10)}.pdf`;

  svc.storage
    .from('gabinete_media')
    .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
    .then(({ error: uploadErr }) => {
      if (uploadErr) { console.error('BD PDF cache upload error:', uploadErr.message); return; }
      const { data: urlData } = svc.storage.from('gabinete_media').getPublicUrl(storagePath);
      svc.from('cadin_pdf_cache').upsert({
        filter_hash:      filterHash,
        sphere:           null,
        org_type:         null,
        cargo:            null,
        label,
        authority_count:  persons.length,
        pdf_storage_path: storagePath,
        pdf_public_url:   urlData?.publicUrl || '',
        created_at:       new Date().toISOString(),
        expires_at:       new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'filter_hash' }).then(({ error: cacheErr }) => {
        if (cacheErr) console.error('BD PDF cache insert error:', cacheErr.message);
      });
    });

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-PDF-Cache': 'MISS',
    },
  });
}
