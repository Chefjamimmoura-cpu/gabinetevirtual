// POST /api/pls/redigir
// Agente Redatora — Etapa 4 do Wizard ALIA Legislativo
// Recebe: { tema, descricao, contexto_politico, parecer_juridico, similares }
// Retorna: { epigrafe, ementa, preambulo, artigos, clausula_vigencia, clausula_revogacao, justificativa }
// IMPORTANTE: Valida e BLOQUEIA cláusula de revogação genérica (RN-03)

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT_REDATORA = `Você é a ALIA, redatora legislativa especializada do Gabinete da Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Roraima.

SUA FUNÇÃO NESTA ETAPA:
Redigir um Projeto de Lei COMPLETO seguindo rigorosamente a Lei Complementar Federal nº 95/1998 e o Manual de Técnica Legislativa do Senado Federal.

ESTRUTURA OBRIGATÓRIA DO PL (LC 95/1998):

PARTE PRELIMINAR:
- EPÍGRAFE: "PROJETO DE LEI Nº ___, DE ___ DE [MÊS POR EXTENSO] DE [ANO]" — obrigatório em maiúsculas
- EMENTA: Resumo conciso do objeto em negrito — deve ser autoexplicativa
- PREÂMBULO: "A CÂMARA MUNICIPAL DE BOA VISTA, Estado de Roraima, aprova:" — exato

PARTE NORMATIVA:
- Art. 1º: objeto e âmbito de aplicação (nunca começar com "Este artigo...")
- Artigos seguintes: conteúdo substantivo
- Artigos 1º a 9º: numerados com ordinal por extenso (Art. 1º, Art. 2º... Art. 9º)
- A partir do Art. 10: numeração cardinal (Art. 10., Art. 11.)

PARTE FINAL:
- Cláusula de vigência: OBRIGATÓRIA — "Esta Lei entra em vigor na data de sua publicação" ou prazo específico
- Cláusula de revogação: APENAS se houver leis a revogar — SEMPRE específica, NUNCA genérica
- Justificativa: DOCUMENTO SEPARADO — não integra o texto da lei

REGRAS ABSOLUTAS (LC 95/1998):
- PROIBIDO: "revogam-se as disposições em contrário" — NUNCA use esta fórmula
- Cada lei trata de UM ÚNICO objeto (princípio da unicidade)
- Frases CURTAS e DIRETAS — oração na ordem direta
- Tempo verbal UNIFORME em todo o texto: presente ou futuro simples
- Artigos desdobram-se em parágrafos (§) ou incisos (I, II, III...)
- Capítulos, Títulos, Livros: maiúsculas + algarismos romanos
- Vacatio legis: prazo razoável se de grande repercussão

AUTORA: Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Estado de Roraima`;

// Validador server-side: detecta cláusula de revogação genérica (RN-03)
function validarClausulaRevogacao(texto: string): boolean {
  const proibido = /revogam.se as disposi[çc][oõ]es em contr[aá]rio/i;
  return !proibido.test(texto);
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  let body: {
    tema?: string;
    descricao?: string;
    contexto_politico?: string;
    parecer_juridico?: unknown;
    similares?: unknown[];
    instrucoes_revisao?: string; // para o loop de retrabalho
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { tema, descricao, contexto_politico, parecer_juridico, similares, instrucoes_revisao } = body;
  if (!tema) {
    return NextResponse.json({ error: 'Campo "tema" é obrigatório' }, { status: 400 });
  }

  const userPrompt = `DIRETRIZES DO PL:
Tema: ${tema}
${descricao ? `Descrição: ${descricao}` : ''}
${contexto_politico ? `Contexto político: ${contexto_politico}` : ''}
${parecer_juridico ? `Parecer jurídico (Etapa 2): ${JSON.stringify(parecer_juridico)}` : ''}
${similares?.length ? `Similares considerados (Etapa 1): ${JSON.stringify(similares)}` : ''}
${instrucoes_revisao ? `\nINSTRUÇÕES DE REVISÃO DA ASSESSORA: ${instrucoes_revisao}` : ''}

Autora: Vereadora Carol Dantas
Câmara Municipal de Boa Vista, Estado de Roraima

Retorne SOMENTE JSON válido:
{
  "epigrafe": "PROJETO DE LEI Nº ___, DE ___ DE [MÊS] DE [ANO]",
  "ementa": "string — resumo conciso do objeto",
  "preambulo": "A CÂMARA MUNICIPAL DE BOA VISTA, Estado de Roraima, aprova:",
  "artigos": [
    {
      "numero": 1,
      "texto": "string — texto completo do artigo",
      "paragrafos": ["string — §1º ...", "string — §2º ..."],
      "incisos": ["string — I - ...", "string — II - ..."]
    }
  ],
  "clausula_vigencia": "string — ex: Esta Lei entra em vigor na data de sua publicação.",
  "clausula_revogacao": "string | null — APENAS se houver leis a revogar. Deve ser ESPECÍFICA (ex: 'Revogam-se o art. 5º da Lei Municipal nº 123/2020'). NUNCA use 'revogam-se as disposições em contrário'.",
  "justificativa": "string — documento separado: contextualização, fundamentação, impacto social esperado"
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT_REDATORA,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(userPrompt);
    const rawText = result.response.text().trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
      if (match) {
        parsed = JSON.parse(match[1]);
      } else {
        throw new Error('Resposta da ALIA não é JSON válido');
      }
    }

    // Validação RN-03: bloqueia cláusula de revogação genérica
    const clausulaRevogacao = parsed.clausula_revogacao as string | null;
    if (clausulaRevogacao && !validarClausulaRevogacao(clausulaRevogacao)) {
      console.error('[pls/redigir] RN-03 violada: cláusula de revogação genérica detectada');
      // Remove a cláusula inválida e marca para correção
      parsed.clausula_revogacao = null;
      parsed._aviso_rn03 = 'Cláusula de revogação genérica removida automaticamente (violação da LC 95/1998). Se houver leis a revogar, especifique-as na revisão.';
    }

    // Verificação de artigos mínimos
    const artigos = parsed.artigos as unknown[];
    if (!artigos || artigos.length < 2) {
      return NextResponse.json(
        { error: 'PL gerado incompleto: mínimo de 2 artigos necessários (objeto + vigência)' },
        { status: 422 }
      );
    }

    return NextResponse.json({ ok: true, data: parsed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[pls/redigir] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
