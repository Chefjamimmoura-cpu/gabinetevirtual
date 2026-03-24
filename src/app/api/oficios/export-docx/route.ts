// POST /api/oficios/export-docx
// Recebe os dados JSON do ofício e retorna o blob DOCX com papel timbrado.
//
// Body: OficioData (numero, cidadeData, pronomeTratamento, destinatarioFinal,
//       cargoFinal, assuntoOficial, corpo, assinaturaNome, assinaturaCargo)

import { NextRequest, NextResponse } from 'next/server';
import { generateOficioDocxBuffer, type OficioData } from '@/lib/oficios/generate-docx';

export async function POST(req: NextRequest) {
  let body: OficioData;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const { numero, corpo } = body;

  if (!numero || !corpo) {
    return NextResponse.json(
      { error: 'Campos "numero" e "corpo" são obrigatórios' },
      { status: 400 }
    );
  }

  try {
    const buffer = await generateOficioDocxBuffer(body);
    const safeNumero = numero.replace(/\//g, '-');
    const filename = `Oficio_${safeNumero}_CMBV.docx`;

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar DOCX de ofício';
    console.error('[POST /api/oficios/export-docx]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
