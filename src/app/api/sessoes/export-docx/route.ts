// POST /api/sessoes/export-docx — Gera DOCX da transcrição para download

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  HeadingLevel, BorderStyle,
} from 'docx';
import { requireAuth } from '@/lib/supabase/auth-guard';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { sessao_id?: string; tipo?: 'transcricao' | 'relatorio' };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }); }

  const { sessao_id, tipo = 'transcricao' } = body;
  if (!sessao_id) return NextResponse.json({ error: 'sessao_id obrigatório' }, { status: 400 });

  const supabase = getSupabase();
  const { data: sessao, error } = await supabase
    .from('sessoes_transcritas')
    .select('titulo, data_sessao, duracao_segundos, transcricao, pontos_chave, relatorio')
    .eq('id', sessao_id)
    .single();

  if (error || !sessao) {
    return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  }

  const children: Paragraph[] = [];

  // ── Cabeçalho ──
  children.push(new Paragraph({
    children: [new TextRun({ text: 'CÂMARA MUNICIPAL DE BOA VISTA', bold: true, size: 28, font: 'Times New Roman', color: '1a4731' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: sessao.titulo || 'Sessão Plenária', bold: true, size: 24, font: 'Times New Roman' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
  }));

  const infoTexts: string[] = [];
  if (sessao.data_sessao) infoTexts.push(`Data: ${new Date(sessao.data_sessao + 'T12:00').toLocaleDateString('pt-BR')}`);
  if (sessao.duracao_segundos) infoTexts.push(`Duração: ${formatTime(sessao.duracao_segundos)}`);

  if (infoTexts.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: infoTexts.join('  |  '), size: 20, font: 'Times New Roman', color: '666666' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }));
  }

  // Separador
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' } },
    spacing: { after: 200 },
  }));

  if (tipo === 'relatorio' && sessao.relatorio) {
    // ── Relatório ──
    const lines = sessao.relatorio.split('\n');
    for (const line of lines) {
      if (line.startsWith('### ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line.replace('### ', ''), bold: true, size: 24, font: 'Times New Roman', color: '1a4731' })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 120 },
        }));
      } else if (line.startsWith('**') && line.endsWith('**')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line.replace(/\*\*/g, ''), bold: true, size: 22, font: 'Times New Roman' })],
          spacing: { after: 80 },
        }));
      } else if (line.startsWith('- ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line.replace('- ', ''), size: 22, font: 'Times New Roman' })],
          bullet: { level: 0 },
          spacing: { after: 40 },
        }));
      } else if (line.trim() === '---') {
        children.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' } },
          spacing: { after: 120 },
        }));
      } else if (line.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 22, font: 'Times New Roman' })],
          spacing: { after: 80 },
        }));
      }
    }
  } else {
    // ── Transcrição com interlocutores ──
    const segments = sessao.transcricao?.segments || [];

    // Pontos-chave primeiro
    if (sessao.pontos_chave?.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'PONTOS-CHAVE', bold: true, size: 24, font: 'Times New Roman', color: '1a4731' })],
        spacing: { before: 100, after: 120 },
      }));
      for (const kp of sessao.pontos_chave) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `[${formatTime(kp.start)}] `, bold: true, size: 20, font: 'Times New Roman', color: '666666' }),
            new TextRun({ text: kp.title, bold: true, size: 20, font: 'Times New Roman' }),
            new TextRun({ text: kp.description ? ` — ${kp.description}` : '', size: 20, font: 'Times New Roman', color: '666666' }),
          ],
          bullet: { level: 0 },
          spacing: { after: 40 },
        }));
      }
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' } },
        spacing: { after: 200 },
      }));
    }

    children.push(new Paragraph({
      children: [new TextRun({ text: 'TRANSCRIÇÃO COMPLETA', bold: true, size: 24, font: 'Times New Roman', color: '1a4731' })],
      spacing: { before: 100, after: 120 },
    }));

    let lastSpeaker = '';
    for (const block of segments) {
      const speaker = block.speaker || 'Comunicador';
      const time = formatTime(block.start);
      const text = block.isUnclear ? '(trecho inaudível)' : (block.text || '');

      // Cabeçalho do interlocutor (só quando muda)
      if (speaker !== lastSpeaker) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${speaker}`, bold: true, size: 22, font: 'Times New Roman', color: '1c4076' }),
            new TextRun({ text: ` — ${time}`, size: 18, font: 'Times New Roman', color: '999999' }),
          ],
          spacing: { before: 200, after: 40 },
        }));
        lastSpeaker = speaker;
      }

      children.push(new Paragraph({
        children: [new TextRun({
          text,
          size: 22,
          font: 'Times New Roman',
          italics: block.isUnclear,
          color: block.isUnclear ? 'dc2626' : '374151',
        })],
        spacing: { after: 60 },
      }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1800, right: 1440 },
        },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const uint8 = new Uint8Array(buffer);
  const slug = (sessao.titulo || 'sessao').replace(/[^a-zA-Z0-9À-ÿ ]/g, '').replace(/\s+/g, '_').substring(0, 50);
  const filename = `${slug}_${tipo}.docx`;

  return new NextResponse(uint8, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
