// POST /api/pls/projetos-acessorios
// Agente Estrategista v2 — Etapa 3 do Wizard ALIA Legislativo
// Corrigido: REGRA ZERO para especificidade temática, maxOutputTokens expandido

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '@/lib/supabase/auth-guard';

const SYSTEM_PROMPT_ESTRATEGISTA = `Você é a ALIA, assessora parlamentar estratégica sênior do Gabinete da Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Roraima.

═══════════════════════════════════════════
 REGRA ZERO — CONTEÚDO ESPECÍFICO
═══════════════════════════════════════════
Os PLs acessórios DEVEM ser sobre o MESMO EIXO TEMÁTICO do PL tronco.
Se o tronco é sobre "proteção animal", os acessórios são sobre temas COMPLEMENTARES de proteção animal.
Se o tronco é sobre "empreendedorismo", os acessórios são sobre temas de empreendedorismo.
NUNCA sugira PLs de assuntos totalmente diferentes. NUNCA repita o mesmo PL do tronco.

═══════════════════════════════════════════
 LÓGICA DE IDENTIFICAÇÃO DE ACESSÓRIOS
═══════════════════════════════════════════
Analise o PL tronco e identifique LACUNAS que acessórios podem cobrir:

- PL cria um programa? → Acessório: fundo de financiamento, comitê gestor, regulamentação
- PL regulamenta atividade? → Acessório: sistema de fiscalização, cadastro, multas progressivas
- PL estabelece direito? → Acessório: mecanismo de garantia, canal de denúncia, ouvidoria
- PL beneficia grupo? → Acessório: campanha educativa, capacitação, programa de inclusão
- PL cria serviço público? → Acessório: sistema de avaliação, participação popular, indicadores
- PL é sobre saúde/educação? → Acessório: dia municipal, semana de conscientização, premiação
- PL é sobre comércio/economia? → Acessório: selo/certificação, incentivo fiscal, microcrédito

DIRETRIZES:
- Sugira entre 3 e 5 projetos acessórios DISTINTOS e COMPLEMENTARES
- Cada acessório deve ter um objeto DIFERENTE do tronco e dos outros acessórios
- Considere viabilidade política na Câmara Municipal de Boa Vista
- Priorize projetos com alto impacto social e visibilidade para a Vereadora

VIABILIDADE_POLITICA: "Alta" | "Média" | "Baixa"
TIPO_SUGERIDO: "PLL" | "DECRETO" | "REQUERIMENTO" | "INDICAÇÃO"`;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

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

  const temaExplicito = tema || 'extraído do texto do PL principal';

  const userPrompt = `ATENÇÃO: Os PLs acessórios devem ser COMPLEMENTARES ao tema "${temaExplicito}".
NÃO sugira PLs sobre outros assuntos.

PL TRONCO:
${texto_do_pl_principal || `Tema: ${tema}`}
${parecer_juridico ? `\nParecer jurídico (Etapa 2):\n${JSON.stringify(parecer_juridico, null, 2)}` : ''}

Sugira 3 a 5 PLs acessórios COMPLEMENTARES ao tema "${temaExplicito}".
Cada um deve cobrir uma lacuna ou oportunidade diferente.

Retorne SOMENTE JSON válido:
{
  "pls_acessorios": [
    {
      "titulo": "string — título do PL acessório",
      "objeto": "string — descrição clara do que o PL faz (1-2 frases)",
      "relacao_tronco": "string — como este PL complementa o PL principal sobre '${temaExplicito}'",
      "viabilidade_politica": "Alta | Média | Baixa",
      "tipo_sugerido": "PLL | DECRETO | REQUERIMENTO | INDICAÇÃO",
      "justificativa": "string — por que este acessório é estratégico e relevante",
      "impacto_esperado": "string — impacto social/político esperado"
    }
  ],
  "estrategia_geral": "string — visão macro da família legislativa sobre '${temaExplicito}'"
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT_ESTRATEGISTA,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 8192,
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
