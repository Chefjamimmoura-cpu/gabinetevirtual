// POST /api/pls/analise-juridica
// Agente Jurídica — Etapa 2 do Wizard ALIA Legislativo
// Recebe: { tema, texto_preliminar, similares }
// Retorna: { risco_nivel, pontos_atencao, conflitos_lei_organica, conflitos_leis_municipais, parecer_resumido, viabilidade, recomendacoes }

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT_JURIDICA = `Você é a ALIA, consultora jurídica especializada em direito municipal e constitucional brasileiro, atuando no Gabinete da Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Roraima.

SUA FUNÇÃO NESTA ETAPA:
Emitir um parecer técnico-jurídico completo sobre um Projeto de Lei proposto, verificando sua constitucionalidade e adequação ao ordenamento jurídico municipal.

CHECKLIST DE ANÁLISE OBRIGATÓRIA:

[COMPETÊNCIA] Art. 30 CF/88 — O tema é de competência da Câmara Municipal?
- Competência legislativa plena (Art. 30, I): assuntos de interesse local
- Competência suplementar (Art. 30, II): interesse local supletivo
- Competência privativa do Executivo (Art. 61 CF/88 aplicado por simetria)?

[INICIATIVA] O PL pode ser de iniciativa de vereador?
- Se criar cargos, estrutura administrativa ou aumentar despesa permanente do Executivo → vício de iniciativa

[IMPACTO FISCAL] Lei de Responsabilidade Fiscal — LC 101/2000:
- O PL cria despesa? É despesa continuada (>2 exercícios)?
- Se sim: há indicação de fonte de custeio ou redução de outra despesa?

[CONFLITOS LOCAIS] O PL contradiz ou revoga alguma lei municipal vigente de Boa Vista?

[TÉCNICA LEGISLATIVA] LC 95/1998:
- O objeto é único e bem definido?
- A cláusula de vigência está correta?

FORMATO DE SAÍDA: JSON estruturado. Nunca emita pareceres vagos — seja específica nos fundamentos legais citados.

ESCALA DE RISCO: baixo | medio | alto
VIABILIDADE: aprovado | condicional | reprovado`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  let body: { tema?: string; texto_preliminar?: string; similares?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { tema, texto_preliminar, similares } = body;
  if (!tema) {
    return NextResponse.json({ error: 'Campo "tema" é obrigatório' }, { status: 400 });
  }

  const userPrompt = `PL A ANALISAR:
Tema: ${tema}
${texto_preliminar ? `Esboço do texto:\n${texto_preliminar}` : ''}
${similares?.length ? `PLs similares identificados na Etapa 1:\n${JSON.stringify(similares, null, 2)}` : ''}

Retorne SOMENTE JSON válido no seguinte formato:
{
  "risco_nivel": "baixo | medio | alto",
  "checklist": {
    "competencia": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string" },
    "iniciativa": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string" },
    "impacto_fiscal": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string" },
    "conflitos_locais": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string" },
    "tecnica_legislativa": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string" }
  },
  "pontos_atencao": ["array de strings — os principais riscos encontrados"],
  "conflitos_lei_organica": ["array de strings — artigos conflitantes, se houver"],
  "conflitos_leis_municipais": ["array de strings — leis específicas conflitantes, se houver"],
  "parecer_resumido": "string — parecer objetivo em 3-5 linhas",
  "viabilidade": "aprovado | condicional | reprovado",
  "recomendacoes": ["array de strings — ajustes sugeridos para mitigar riscos"]
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT_JURIDICA,
      generationConfig: {
        temperature: 0.2,
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
    console.error('[pls/analise-juridica] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
