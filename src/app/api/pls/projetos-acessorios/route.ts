// POST /api/pls/projetos-acessorios
// Agente Estrategista — Etapa 3 do Wizard ALIA Legislativo
// Recebe: { texto_do_pl_principal, tema, parecer_juridico }
// Retorna: [{ titulo, objeto, relacao_tronco, viabilidade_politica, tipo_sugerido }]

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT_ESTRATEGISTA = `Você é a ALIA, assessora parlamentar estratégica sênior do Gabinete da Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Roraima.

SUA FUNÇÃO NESTA ETAPA:
Com base no PL principal (tronco), identificar oportunidades de projetos de lei complementares (acessórios) que ampliem o impacto político e legislativo da proposta original.

LÓGICA DE IDENTIFICAÇÃO DE ACESSÓRIOS:
- PL cria um programa? → Acessório pode criar o fundo de financiamento ou regulamentar o programa
- PL regulamenta atividade? → Acessório pode criar fiscalização ou sistema de multas
- PL estabelece direito? → Acessório pode criar o mecanismo de garantia ou acesso
- PL beneficia grupo? → Acessório pode ampliar para grupos relacionados ou complementares
- PL cria serviço público? → Acessório pode criar o sistema de avaliação ou participação popular

DIRETRIZES:
- Pense como um consultor legislativo experiente com visão política estratégica
- Sugira entre 2 e 5 projetos acessórios viáveis e realistas
- Priorize projetos que ampliem benefícios para a base eleitoral da Vereadora Carol Dantas
- Evite projetos que entrem em conflito com o tronco ou criem sobreposição
- Considere a viabilidade política no contexto da Câmara Municipal de Boa Vista

VIABILIDADE_POLITICA: "Alta" | "Média" | "Baixa"
TIPO_SUGERIDO: "PLL" | "DECRETO" | "REQUERIMENTO"`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  let body: { texto_do_pl_principal?: string; tema?: string; parecer_juridico?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { texto_do_pl_principal, tema, parecer_juridico } = body;
  if (!texto_do_pl_principal && !tema) {
    return NextResponse.json({ error: 'Campo "texto_do_pl_principal" ou "tema" é obrigatório' }, { status: 400 });
  }

  const userPrompt = `PL TRONCO:
${texto_do_pl_principal || `Tema: ${tema}`}
${parecer_juridico ? `\nParece jurídico (Etapa 2):\n${JSON.stringify(parecer_juridico, null, 2)}` : ''}

Sugira PLs acessórios. Retorne SOMENTE JSON válido:
{
  "pls_acessorios": [
    {
      "titulo": "string — título do PL acessório",
      "objeto": "string — descrição em 1 frase do que o PL faz",
      "relacao_tronco": "string — como este PL complementa o PL principal",
      "viabilidade_politica": "Alta | Média | Baixa",
      "tipo_sugerido": "PLL | DECRETO | REQUERIMENTO",
      "justificativa": "string — por que este acessório é estratégico"
    }
  ],
  "estrategia_geral": "string — visão macro da família legislativa formada pelo tronco e acessórios"
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT_ESTRATEGISTA,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(userPrompt);
    const rawText = result.response.text().trim();

    let parsed: unknown;
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

    return NextResponse.json({ ok: true, data: parsed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[pls/projetos-acessorios] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
