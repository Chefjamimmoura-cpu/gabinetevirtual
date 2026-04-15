// POST /api/pls/pesquisar-similares
// Agente Pesquisadora — Etapa 1 do Wizard ALIA Legislativo
//
// MELHORIA v2: retorna fontes reais consultadas (nacionais e internacionais)
// com links, excertos e grau de relevância para cada ideia capturada

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@/lib/supabase/server';

const SYSTEM_PROMPT_PESQUISADORA = `Você é a ALIA (Assessora Legislativa de Inteligência Autônoma), agente especializada em Pesquisa Legislativa e Direito Comparado do Gabinete da Vereadora Carol Dantas, Câmara Municipal de Boa Vista, Roraima.

SUA FUNÇÃO NESTA ETAPA:
1. Identificar PLs similares existentes na Câmara Municipal de Boa Vista (SAPL)
2. Pesquisar legislações similares em outras câmaras e assembleias do Brasil
3. Mapear boas práticas e experiências comparadas internacionais
4. Extrair as melhores ideias e estratégias de cada referência encontrada
5. Emitir parecer de viabilidade com base em toda a pesquisa

FONTES QUE VOCÊ DEVE CITAR QUANDO RELEVANTES:

BRASIL — LEGISLAÇÃO LOCAL:
- Câmara Municipal de Boa Vista: https://sapl.boavista.rr.leg.br/materia/ (SAPL)
- Portal da Câmara dos Deputados: https://www.camara.leg.br/busca-portal/legislacao/
- Senado Federal — LegisWeb: https://legis.senado.leg.br/norma/

BRASIL — CÂMARAS MUNICIPAIS DE REFERÊNCIA:
- Câmara Municipal de São Paulo (CMSP): https://www.saopaulo.sp.leg.br/
- Câmara Municipal do Rio de Janeiro: https://cmrj.siafe.net.br/
- Câmara Municipal de Curitiba: https://www.cmc.pr.gov.br/
- Câmara Municipal de Fortaleza: https://www.cmfor.ce.gov.br/

BRASIL — DIREITO ESTADUAL DE RORAIMA:
- Assembleia Legislativa de Roraima (ALERRR): https://sapl.al.rr.leg.br/
- Prefeitura de Boa Vista: https://www.boavista.rr.gov.br/

BRASÍLIA — LEGISLATIVO FEDERAL:
- Portal LexML: https://www.lexml.gov.br/
- Repositório de Leis do Planalto: https://www.planalto.gov.br/ccivil_03/

ORGANIZAÇÕES E OBSERVATÓRIOS:
- IBAM (Instituto Brasileiro de Administração Municipal): https://www.ibam.org.br/
- CNM (Confederação Nacional dos Municípios): https://www.cnm.org.br/

INTERNACIONAL:
- Inter-Parliamentary Union (IPU): https://www.ipu.org/
- OCDE – Boas práticas legislativas: https://www.oecd.org/
- Argentina: https://www.hcdn.gob.ar/ (Câmara de Deputados)
- Portugal: https://www.parlamento.pt/
- Espanha: https://www.congreso.es/

INSTRUÇÕES OBRIGATÓRIAS:
1. Para similares locais (SAPL BV): classifique como IDÊNTICO / SIMILAR / RELACIONADO
2. Para referências nacionais: cite o nome da câmara/órgão, número da lei/PL e URL estimada
3. Para referências internacionais: cite o país, instituição e o núcleo da ideia aproveitável
4. Para cada referência: extraia as "MELHORES IDEIAS" que podem enriquecer o novo PL
5. Parecer de viabilidade: VERDE / AMARELO / VERMELHO com justificativa
6. Campo "ideias_aproveitadas": síntese das melhores práticas encontradas para incorporar ao PL

REGRAS:
- Se não tiver dados específicos sobre Boa Vista, indique "Busca local não disponível nesta consulta — verificar SAPL"
- Seja específica com nomes de leis quando conhecer; se não conhecer, indique a tipologia sem inventar número
- O campo "recomendacao" deve ser: "prosseguir" | "ajustar" | "arquivar"`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  let body: { tema?: string; descricao?: string; contexto_politico?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { tema, descricao, contexto_politico } = body;
  if (!tema) {
    return NextResponse.json({ error: 'Campo "tema" é obrigatório' }, { status: 400 });
  }

  // Busca PLs similares no banco local para enriquecer o contexto
  let contextoLocal = '';
  try {
    const supabase = await createClient();
    const { data: plsLocais } = await supabase
      .from('pl_proposicoes')
      .select('numero_sapl, ementa, tema, status')
      .ilike('ementa', `%${tema.split(' ').slice(0, 3).join('%')}%`)
      .limit(5);

    if (plsLocais?.length) {
      contextoLocal = `\n\nPLs no banco interno do Gabinete Virtual relacionados ao tema:\n` +
        plsLocais.map(p => `- ${p.numero_sapl || 'Rascunho ALIA'}: ${p.ementa} (${p.status})`).join('\n');
    }
  } catch {
    // Continua mesmo sem dados locais
  }

  const userPrompt = `TEMA DO NOVO PL: ${tema}
${descricao ? `DESCRIÇÃO: ${descricao}` : ''}
${contexto_politico ? `CONTEXTO POLÍTICO: ${contexto_politico}` : ''}
${contextoLocal}

Faça uma pesquisa legislativa COMPLETA. Retorne SOMENTE JSON válido no seguinte formato:

{
  "similares_locais": [
    {
      "numero": "PLL 00/0000 ou 'Busca local não disponível'",
      "ementa": "string",
      "status": "string",
      "grau_similaridade": "IDÊNTICO | SIMILAR | RELACIONADO",
      "diferencial": "string — o que o novo PL traz de diferente",
      "url": "https://sapl.boavista.rr.leg.br/materia/NUMERO/ ou null"
    }
  ],
  "referencias_nacionais": [
    {
      "origem": "Nome da câmara/órgão/estado",
      "titulo": "Nome da lei, PL ou resolução (sem inventar número — use null se não souber)",
      "numero": "string | null",
      "ano": "string | null",
      "url": "URL estimada ou null",
      "nucleo": "string — qual a parte mais relevante para inspirar o nosso PL",
      "melhores_ideias": ["string — ideia 1 aproveitável", "string — ideia 2 aproveitável"]
    }
  ],
  "referencias_internacionais": [
    {
      "pais": "string",
      "instituicao": "string",
      "descricao": "string — o que esse país/cidade faz diferente e bem",
      "url": "URL ou null",
      "melhores_ideias": ["string — o que pode ser adaptado para Boa Vista"]
    }
  ],
  "ideias_aproveitadas": {
    "resumo": "string — síntese das melhores práticas encontradas em todas as fontes",
    "sugestoes_para_incorporar": [
      "string — sugestão específica baseada nas referências"
    ]
  },
  "recomendacao": "prosseguir | ajustar | arquivar",
  "justificativa": "string — por que este PL pode / não pode prosseguir",
  "parecer_viabilidade": "VERDE | AMARELO | VERMELHO",
  "pontos_diferenciadores": ["string — o que torna este PL único e relevante para Boa Vista/RR"]
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT_PESQUISADORA,
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
    console.error('[pls/pesquisar-similares] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
