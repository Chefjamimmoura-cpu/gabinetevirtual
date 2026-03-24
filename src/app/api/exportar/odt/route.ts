// POST /api/exportar/odt
// Gera um documento .odt preenchendo um template com variáveis {{key}} via
// substituição direta no content.xml (PizZip). Compatível com SAPL 3.1.
//
// Body:
//   tipo:   'relatoria' | 'comissao' | 'ata'
//   titulo: string           — nome do arquivo de download
//   dados:  Record<string, unknown>   — variáveis planas ou aninhadas (usa dot notation)
//
// Variáveis suportadas em todos os templates:
//   {{titulo}}, {{data_extenso}}, {{municipio}},
//   {{parlamentar.nome_completo}}, {{comissao.nome}}, {{cargo_relator}},
//   {{materia.tipo_sigla}}, {{materia.numero}}, {{materia.ano}}, {{materia.ementa}},
//   {{voto}}, {{texto_relatorio}}, {{texto_voto_fundamentado}}

import { NextResponse } from 'next/server';
import PizZip from 'pizzip';
import * as fs from 'fs';
import * as path from 'path';

const TEMPLATE_DIR = path.resolve(process.cwd(), 'public', 'templates');

const TEMPLATE_MAP: Record<string, string> = {
  relatoria: 'parecer_relator.odt',
  comissao: 'parecer_comissao.odt',
  ata: 'ata_comissao.odt',
};

/**
 * Achata um objeto aninhado para dot notation.
 * Ex: { parlamentar: { nome_completo: 'X' } } → { 'parlamentar.nome_completo': 'X' }
 */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flatten(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = String(value ?? '');
    }
  }
  return result;
}

/**
 * Substitui {{chave}} no XML por valor, escapando caracteres XML.
 * Lida com casos onde o Zipzipper quebra {{chave}} em vários nós XML.
 */
function renderOdtXml(xml: string, vars: Record<string, string>): string {
  // Primeiro remove encoding fragments que ODT às vezes insere dentro de {{ }}
  // (ex: {{parlamentar.<tag xml>nome_completo}}) — limpa tags XML dentro dos delimitadores
  let result = xml.replace(/\{\{([^}]+)\}\}/g, (match, inner) => {
    // Remove quaisquer tags XML que possam ter sido inseridas dentro do placeholder
    const cleanKey = inner.replace(/<[^>]+>/g, '').trim();
    const val = vars[cleanKey] ?? match;
    // Escapa o valor para XML
    return val
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  });

  return result;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      tipo?: string;
      titulo?: string;
      dados?: Record<string, unknown>;
    };

    const { tipo = 'relatoria', titulo = 'documento', dados = {} } = body;

    const templateFile = TEMPLATE_MAP[tipo] ?? TEMPLATE_MAP.relatoria;
    const templatePath = path.join(TEMPLATE_DIR, templateFile);

    if (!fs.existsSync(templatePath)) {
      return NextResponse.json(
        {
          error: `Template ODT não encontrado: ${templateFile}`,
          detalhe: `Certifique-se de que o arquivo existe em /public/templates/${templateFile}. Execute: node scripts/create-odt-templates.js`,
        },
        { status: 404 },
      );
    }

    // Carrega o ODT (ZIP)
    const fileContent = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(fileContent);

    // Aplana as variáveis aninhadas
    const vars = flatten(dados as Record<string, unknown>);

    // Substitui no content.xml
    const contentXmlFile = zip.file('content.xml');
    if (!contentXmlFile) {
      return NextResponse.json({ error: 'Template ODT corrompido (content.xml ausente)' }, { status: 500 });
    }

    const originalXml = contentXmlFile.asText();
    const renderedXml = renderOdtXml(originalXml, vars);
    zip.file('content.xml', renderedXml);

    // Gera buffer de saída
    const outputBuffer: Uint8Array = zip.generate({
      type: 'uint8array',
      compression: 'DEFLATE',
    });

    const safeName = (titulo as string).replace(/[^a-zA-Z0-9À-ÿ_\-]/g, '_');

    return new Response(outputBuffer.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.oasis.opendocument.text',
        'Content-Disposition': `attachment; filename="${safeName}.odt"`,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[POST /api/exportar/odt]', error);
    return NextResponse.json({ error: 'Erro ao gerar ODT', detalhe: msg }, { status: 500 });
  }
}
