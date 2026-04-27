// POST /api/pareceres/export-docx
// Recebe o parecer em markdown e retorna um arquivo DOCX para download
//
// Body: { parecer: string, total_materias: number, data_sessao?: string }

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { generateDocxBuffer, generateRelatorDocxBuffer, generateParecerComissaoDocx, generateAtaDocx, ComissaoMembro } from '@/lib/parecer/generate-docx';
import { resolveDisclaimer, type DisclaimerContext } from '@/lib/docs';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: {
    parecer?: string;
    total_materias?: number;
    data_sessao?: string;
    tipo?: string;
    commission_nome?: string;
    commission_sigla?: string;
    gabinete_nome?: string;
    relator_nome?: string;
    titulo?: string;
    membros?: ComissaoMembro[];
    disclaimerContext?: DisclaimerContext;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const { parecer, total_materias = 0, data_sessao, tipo, commission_nome, commission_sigla, gabinete_nome, relator_nome, titulo, membros, disclaimerContext } = body;

  if (!parecer || typeof parecer !== 'string') {
    return NextResponse.json({ error: 'Campo "parecer" é obrigatório' }, { status: 400 });
  }

  // Resolve disclaimer server-side: cliente nunca lida com texto legal direto
  const disclaimer = disclaimerContext ? resolveDisclaimer(disclaimerContext) : undefined;

  // Relatoria: usa gerador específico com cabeçalho correto
  if (tipo === 'relatoria' && commission_nome && commission_sigla) {
    try {
      const buffer = await generateRelatorDocxBuffer(parecer, {
        commissionNome: commission_nome,
        commissionSigla: commission_sigla,
        gabineteNome: gabinete_nome,
        relatorNome: relator_nome || gabinete_nome,
      });
      const safe = (titulo || `Relatoria_${commission_sigla}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safe}.docx`;
      return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.byteLength),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao gerar DOCX de relatoria';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Parecer da Comissão
  if (tipo === 'comissao' && commission_nome && commission_sigla) {
    try {
      const buffer = await generateParecerComissaoDocx(parecer, {
        commissionNome: commission_nome,
        commissionSigla: commission_sigla,
        gabineteNome: gabinete_nome,
        membros,
        disclaimer,
      });
      const safe = (titulo || `Parecer_Comissao_${commission_sigla}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safe}.docx"`,
          'Content-Length': String(buffer.byteLength),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao gerar DOCX de parecer da comissão';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ATA da Reunião
  if (tipo === 'ata' && commission_nome && commission_sigla) {
    try {
      const buffer = await generateAtaDocx(parecer, {
        commissionNome: commission_nome,
        commissionSigla: commission_sigla,
        gabineteNome: gabinete_nome,
        membros,
        dataStr: data_sessao,
        disclaimer,
      });
      const safe = (titulo || `ATA_${commission_sigla}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safe}.docx"`,
          'Content-Length': String(buffer.byteLength),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao gerar DOCX de ATA';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const buffer = await generateDocxBuffer(parecer, total_materias, data_sessao);
    const dataStr = data_sessao
      ? new Date(data_sessao + 'T12:00:00').toLocaleDateString('pt-BR').replace(/\//g, '-')
      : new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    const filename = `Parecer_CMBV_${dataStr}.docx`;

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar DOCX';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
