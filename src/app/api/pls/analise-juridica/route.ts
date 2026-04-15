// POST /api/pls/analise-juridica
// Agente Jurídica v2 — Etapa 2 do Wizard ALIA Legislativo
// Corrigido: maxOutputTokens expandido, prompt que exige análise ESPECÍFICA ao tema

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '@/lib/supabase/auth-guard';

const SYSTEM_PROMPT_JURIDICA = `Você é a ALIA, consultora jurídica especializada em direito municipal e constitucional brasileiro, do Gabinete da Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Roraima.

═══════════════════════════════════════════
 REGRA ZERO — ANÁLISE ESPECÍFICA
═══════════════════════════════════════════
Você DEVE analisar EXCLUSIVAMENTE o tema informado pelo usuário.
NÃO reutilize análises de outros temas.
Se o tema é "pets no transporte público", analise ISSO — não analise inclusão de autistas.
CADA análise é ÚNICA para o tema solicitado.

═══════════════════════════════════════════
 CHECKLIST DE ANÁLISE OBRIGATÓRIA
═══════════════════════════════════════════

[COMPETÊNCIA] Art. 30 CF/88 — O tema é de competência da Câmara Municipal?
- Competência legislativa local (Art. 30, I): assuntos de interesse local
- Competência suplementar (Art. 30, II): interesse local supletivo
- Risco de invadir competência privativa da União (Art. 22 CF/88)?
- Risco de invadir competência do Executivo (Art. 61, §1º CF/88)?

[INICIATIVA] O PL pode ser de iniciativa de vereador?
- Se criar cargos, servidores ou alterar remuneração → vício de iniciativa
- Se reorganizar órgãos da administração → competência privativa do Prefeito
- Se ampliar benefícios funcionais → vício de iniciativa

[IMPACTO FISCAL] Lei de Responsabilidade Fiscal — LC 101/2000:
- O PL cria despesa? É despesa continuada (>2 exercícios)?
- Necessita estimativa de impacto orçamentário?
- Há indicação de fonte de custeio?
- Lei de Diretrizes Orçamentárias deve ser observada?

[CONFLITOS LOCAIS] Lei Orgânica Municipal de Boa Vista:
- Verificar se há artigos específicos da LOM que conflitem
- Verificar leis municipais vigentes sobre o MESMO tema

[TÉCNICA LEGISLATIVA] LC 95/1998:
- O objeto é único e bem definido?
- A cláusula de vigência está correta?
- Há princípio de proporcionalidade nas obrigações/penalidades?

[CONSTITUCIONALIDADE MATERIAL]
- O PL respeita direitos fundamentais (Art. 5º CF/88)?
- Não viola livre iniciativa (Art. 170 CF/88)?
- Não viola princípio da igualdade?

FORMATO: JSON estruturado com fundamentos legais ESPECÍFICOS — nunca pareceres vagos.
ESCALA DE RISCO: baixo | medio | alto
VIABILIDADE: aprovado | condicional | reprovado`;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

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

  const userPrompt = `ATENÇÃO: Analise EXCLUSIVAMENTE o tema abaixo. Não substitua por outro assunto.

TEMA DO PL A ANALISAR: ${tema}
${texto_preliminar ? `\nDESCRIÇÃO / ESBOÇO DO TEXTO:\n${texto_preliminar}` : ''}
${similares?.length ? `\nPLs SIMILARES IDENTIFICADOS (Etapa 1):\n${JSON.stringify(similares, null, 2)}` : ''}

Faça uma análise jurídica COMPLETA e ESPECÍFICA para "${tema}".
Cite artigos da CF/88, da LOM de Boa Vista e leis municipais quando relevante.

Retorne SOMENTE JSON válido:
{
  "risco_nivel": "baixo | medio | alto",
  "checklist": {
    "competencia": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string — análise detalhada com fundamento legal", "fundamento": "string — artigos citados" },
    "iniciativa": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string", "fundamento": "string" },
    "impacto_fiscal": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string", "fundamento": "string" },
    "conflitos_locais": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string", "fundamento": "string" },
    "tecnica_legislativa": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string", "fundamento": "string" },
    "constitucionalidade": { "status": "OK | ATENÇÃO | PROBLEMA", "analise": "string", "fundamento": "string" }
  },
  "pontos_atencao": ["string — riscos encontrados, específicos para ${tema}"],
  "conflitos_lei_organica": ["string — artigos da LOM conflitantes, se houver"],
  "conflitos_leis_municipais": ["string — leis específicas de Boa Vista conflitantes"],
  "parecer_resumido": "string — parecer objetivo em 3-5 linhas, ESPECÍFICO sobre ${tema}",
  "viabilidade": "aprovado | condicional | reprovado",
  "recomendacoes": ["string — ajustes concretos para mitigar riscos"]
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT_JURIDICA,
      generationConfig: {
        temperature: 0.4,
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
    console.error('[pls/analise-juridica] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
