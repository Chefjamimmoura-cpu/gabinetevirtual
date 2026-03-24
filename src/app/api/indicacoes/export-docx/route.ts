import { NextRequest, NextResponse } from 'next/server';
import { generateIndicacaoDocxBuffer } from '@/lib/indicacao/generate-docx';

// POST /api/indicacoes/export-docx
// Recebe { ementa, texto_md, fotos_urls } e retorna o blob do docx.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ementa, texto_md, fotos_urls, incluir_marca_dagua } = body;

    if (!ementa && !texto_md) {
      return NextResponse.json({ error: 'Faltam ementa ou texto da Indicação' }, { status: 400 });
    }

    const inc_marca = typeof incluir_marca_dagua === 'boolean' ? incluir_marca_dagua : true;
    const buffer = await generateIndicacaoDocxBuffer(ementa || '', texto_md || '', fotos_urls || [], inc_marca);

    // Gera o timestamp formatado para o nome do arquivo
    const dataStr = new Date().toISOString().split('T')[0];
    const filename = `Indicacao_CMBV_${dataStr}.docx`;

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar DOCX';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
