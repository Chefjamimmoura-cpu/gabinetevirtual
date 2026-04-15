// POST /api/pls/redigir
// Agente Redatora v2 — Etapa 4 do Wizard ALIA Legislativo
// Corrigido: maxOutputTokens expandido, prompt imperativo sobre conteúdo específico ao tema,
// mínimo de 5 artigos e justificativa robusta

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const SYSTEM_PROMPT_REDATORA = `Você é a ALIA, redatora legislativa especializada do Gabinete da Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Roraima.

═══════════════════════════════════════════
 REGRA ZERO — CONTEÚDO ESPECÍFICO
═══════════════════════════════════════════
Você DEVE redigir um PL 100% SOBRE O TEMA INFORMADO PELO USUÁRIO.
NÃO reutilize textos de outros PLs. NÃO copie exemplos do seu treinamento.
Se o tema é "pets", redija sobre pets. Se é "transporte", redija sobre transporte.
CADA PL DEVE SER ÚNICO e inteiramente dedicado ao tema solicitado.

═══════════════════════════════════════════
 ESTRUTURA OBRIGATÓRIA (LC 95/1998)
═══════════════════════════════════════════

PARTE PRELIMINAR:
- EPÍGRAFE: "PROJETO DE LEI Nº ___, DE ___ DE [MÊS POR EXTENSO] DE [ANO]" — maiúsculas
- EMENTA: Resumo conciso e autoexplicativo do objeto
- PREÂMBULO: "A CÂMARA MUNICIPAL DE BOA VISTA, Estado de Roraima, aprova:" — exato

PARTE NORMATIVA — MÍNIMO 5 ARTIGOS, idealmente 8-15:
- Art. 1º: objeto e âmbito de aplicação
- Art. 2º: definições e conceitos-chave (se aplicável)
- Art. 3º-Nº: conteúdo substantivo — regulamentação detalhada
  - Obrigações, direitos, vedações, procedimentos
  - Penalidades por descumprimento (quando cabível)
  - Responsabilidades dos órgãos executores
  - Prazos de implementação
- Penúltimo artigo: fonte de custeio (se criar despesa)
- Último artigo: cláusula de vigência

Artigos 1º a 9º: ordinal (Art. 1º, Art. 2º... Art. 9º)
A partir do Art. 10: cardinal (Art. 10., Art. 11.)

CADA ARTIGO pode conter:
- Parágrafos (§ 1º, § 2º...) — para exceções, condições ou requisitos
- Incisos (I, II, III...) — para enumerações
- Alíneas (a, b, c...) — para sub-enumerações

PARTE FINAL:
- Cláusula de vigência: OBRIGATÓRIA
- Cláusula de revogação: APENAS se houver leis ESPECÍFICAS a revogar — NUNCA genérica
  PROIBIDO: "revogam-se as disposições em contrário" — esta fórmula é VEDADA pela LC 95/1998

JUSTIFICATIVA — documento SEPARADO, deve conter:
- Contexto social e relevância para Boa Vista/RR (cite dados, se conhecer)
- Fundamentação constitucional e legal
- Experiências em outras cidades/estados que inspiraram o PL
- Impacto social e econômico esperado
- Alinhamento com políticas públicas existentes
- MÍNIMO 3 parágrafos substanciais

AUTORA: Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Estado de Roraima

═══════════════════════════════════════════
 QUALIDADE — O PL vai ser LIDO pela vereadora, assessores e pela Mesa Diretora.
 Não aceite texto superficial. Cada artigo deve ter SUBSTÂNCIA REAL.
═══════════════════════════════════════════`;

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
    instrucoes_revisao?: string;
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

  const userPrompt = `ATENÇÃO: O tema a seguir é ESPECÍFICO. Redigir sobre EXATAMENTE este assunto. Não substitua por outro tema.

TEMA DO PROJETO DE LEI: ${tema}
${descricao ? `\nDESCRIÇÃO DETALHADA:\n${descricao}` : ''}
${contexto_politico ? `\nCONTEXTO POLÍTICO:\n${contexto_politico}` : ''}
${parecer_juridico ? `\nPARECER JURÍDICO (Etapa 2) — respeitar restrições aqui indicadas:\n${JSON.stringify(parecer_juridico, null, 2)}` : ''}
${similares?.length ? `\nPLs SIMILARES IDENTIFICADOS (Etapa 1) — evitar duplicidade:\n${JSON.stringify(similares, null, 2)}` : ''}
${instrucoes_revisao ? `\nINSTRUÇÕES DE REVISÃO DA ASSESSORA (prioridade máxima):\n${instrucoes_revisao}` : ''}

IMPORTANTE:
1. Gere PELO MENOS 5 artigos substantivos (não apenas Art. 1 e vigência)
2. Inclua definições, obrigações, penalidades, prazos e vigência
3. A justificativa deve ter NO MÍNIMO 3 parágrafos com fundamentação real
4. TUDO deve ser 100% sobre "${tema}" — nada sobre outros assuntos

Retorne SOMENTE JSON válido no seguinte formato:
{
  "epigrafe": "PROJETO DE LEI Nº ___, DE ___ DE MARÇO DE 2026",
  "ementa": "string — resumo conciso do objeto da lei",
  "preambulo": "A CÂMARA MUNICIPAL DE BOA VISTA, Estado de Roraima, aprova:",
  "artigos": [
    {
      "numero": 1,
      "texto": "string — texto completo do artigo",
      "paragrafos": ["string — § 1º texto...", "string — § 2º texto..."],
      "incisos": ["string — I - texto...", "string — II - texto..."]
    }
  ],
  "clausula_vigencia": "string",
  "clausula_revogacao": "string | null",
  "justificativa": "string — documento extenso com 3+ parágrafos"
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT_REDATORA,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 16384,
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
      parsed.clausula_revogacao = null;
      parsed._aviso_rn03 = 'Cláusula de revogação genérica removida (LC 95/1998). Se houver leis a revogar, especifique na revisão.';
    }

    // Verificação de artigos mínimos
    const artigos = parsed.artigos as unknown[];
    if (!artigos || artigos.length < 2) {
      return NextResponse.json(
        { error: 'PL gerado incompleto: mínimo de 2 artigos. Tente novamente ou forneça mais detalhes sobre o tema.' },
        { status: 422 }
      );
    }

    // ── Salvar rascunho no banco e retornar pl_id ──
    let pl_id: string | null = null;
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && supabaseKey) {
        const supa = createClient(supabaseUrl, supabaseKey);
        const ementa = (parsed.ementa as string) || tema;
        const textoCompleto = JSON.stringify(parsed);
        const justificativa = (parsed.justificativa as string) || '';

        const { data: row, error: insertErr } = await supa
          .from('pl_proposicoes')
          .insert({
            tipo: 'PLL',
            ementa,
            tema,
            status: 'RASCUNHO',
            texto_pl: textoCompleto,
            justificativa,
            gabinete_id: process.env.GABINETE_ID || null,
          })
          .select('id')
          .single();

        if (!insertErr && row) {
          pl_id = row.id;
        } else if (insertErr) {
          console.error('[pls/redigir] DB insert error:', insertErr.message);
        }
      }
    } catch (dbErr) {
      console.error('[pls/redigir] DB error:', dbErr);
    }

    return NextResponse.json({ ok: true, data: { ...parsed, _pl_id: pl_id } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[pls/redigir] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
