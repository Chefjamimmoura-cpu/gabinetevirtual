// POST /api/indicacoes/gerar-documento
// ──────────────────────────────────────────────────────────────
// Gera o texto da indicação parlamentar no formato exato do
// SAPL da CMBV usando Gemini 2.5 Flash.
//
// Pode receber:
//   A) indicacao_id: uuid → busca dados no Supabase
//   B) Campos diretos: bairro, logradouro, setores, etc.
//
// Salva documento_gerado_md e documento_ementa no Supabase
// (se indicacao_id fornecido).
//
// Response: { ok, ementa, texto_completo_md, indicacao_id? }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GABINETE_ID = process.env.GABINETE_ID!;
const VEREADORA = 'Carol Dantas';
const MUNICIPIO = 'Boa Vista/RR';

// Prompt que respeita exatamente o formato SAPL da CMBV
const SYSTEM_PROMPT = `Você é redator parlamentar do gabinete da Vereadora ${VEREADORA}, da Câmara Municipal de ${MUNICIPIO}.

Sua função é redigir Indicações Parlamentares no formato exato exigido pelo sistema SAPL da Câmara Municipal de Boa Vista.

REGRAS OBRIGATÓRIAS:
1. EMENTA: máximo 2 linhas, maiúsculo, começa com "INDICA AO PODER EXECUTIVO MUNICIPAL QUE, POR INTERMÉDIO DA SECRETARIA COMPETENTE, PROCEDA COM [SERVIÇO(S)], [LOGRADOURO], BAIRRO [BAIRRO], BOA VISTA/RR."
2. TEXTO DA INDICAÇÃO: começa com "A VEREADORA ${VEREADORA.toUpperCase()}, no exercício do mandato e das atribuições que lhe são conferidas pela Lei Orgânica do Município de Boa Vista e pelo Regimento Interno desta Casa, vem, respeitosamente, INDICAR ao Poder Executivo Municipal que..."
3. JUSTIFICATIVA: parágrafo objetivo citando a necessidade da comunidade, o impacto na qualidade de vida e a responsabilidade do Poder Executivo. Máximo 3 parágrafos.
4. SALA DAS SESSÕES: termine com "Sala das Sessões, Boa Vista/RR, em [data por extenso]."
5. Não inclua cabeçalho, número da indicação, assinatura, data no início. Apenas ementa, texto e justificativa.
6. Tom: formal, técnico, parlamentar. Sem gírias ou linguagem coloquial.
7. Português brasileiro correto.

Retorne APENAS um JSON válido com exatamente estes campos:
{
  "ementa": "texto da ementa em maiúsculo",
  "texto_completo_md": "texto completo em markdown (ementa em negrito, seções separadas por \\n\\n)"
}`;

interface GerarDocumentoBody {
  indicacao_id?: string;
  // Campos diretos (quando não há indicacao_id)
  bairro?: string;
  logradouro?: string;
  setores?: string[];
  classificacao?: string;
  responsavel_nome?: string;
  observacoes?: string;
  fotos_urls?: string[];
}

interface IndicacaoData {
  id?: string;
  bairro: string;
  logradouro: string;
  setores: string[];
  classificacao?: string | null;
  responsavel_nome?: string | null;
  observacoes?: string | null;
  fotos_urls?: string[] | null;
  titulo?: string;
}

function buildUserPrompt(ind: IndicacaoData): string {
  const setoresStr = (ind.setores ?? []).join(', ') || 'serviços de infraestrutura';
  const urgencia = ind.classificacao === 'urgencia'
    ? ' (URGENTE — situação de risco ou impacto imediato)'
    : ind.classificacao === 'prioridade'
      ? ' (PRIORITÁRIO)'
      : '';

  return `Dados da indicação:
- Bairro: ${ind.bairro}
- Logradouro: ${ind.logradouro}
- Setores/Serviços necessários: ${setoresStr}${urgencia}
- Responsável pelo levantamento: ${ind.responsavel_nome ?? 'Equipe do Gabinete'}
${ind.observacoes ? `- Observações do campo: ${ind.observacoes}` : ''}
${ind.fotos_urls?.length ? `- ${ind.fotos_urls.length} foto(s) do local registradas` : ''}

Gere a indicação parlamentar completa no formato SAPL.`;
}

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 503 });
  }

  let body: GerarDocumentoBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let indicacaoData: IndicacaoData;

  // Caso A: buscar dados pelo ID
  if (body.indicacao_id) {
    const { data, error } = await supabase
      .from('indicacoes')
      .select('id, titulo, bairro, logradouro, setores, classificacao, responsavel_nome, observacoes, fotos_urls')
      .eq('id', body.indicacao_id)
      .eq('gabinete_id', GABINETE_ID)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Indicação não encontrada' }, { status: 404 });
    }
    indicacaoData = data as IndicacaoData;
  } else {
    // Caso B: campos diretos
    if (!body.bairro || !body.logradouro) {
      return NextResponse.json({ error: 'bairro e logradouro são obrigatórios quando indicacao_id não é fornecido' }, { status: 400 });
    }
    indicacaoData = {
      bairro: body.bairro,
      logradouro: body.logradouro,
      setores: body.setores ?? [],
      classificacao: body.classificacao,
      responsavel_nome: body.responsavel_nome,
      observacoes: body.observacoes,
      fotos_urls: body.fotos_urls,
    };
  }

  // Gerar com Gemini
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  });

  let ementa: string;
  let textoCompletoMd: string;

  try {
    const result = await model.generateContent(
      SYSTEM_PROMPT + '\n\n' + buildUserPrompt(indicacaoData)
    );
    const raw = result.response.text();
    const parsed = JSON.parse(raw) as { ementa: string; texto_completo_md: string };
    ementa = parsed.ementa?.trim() ?? '';
    textoCompletoMd = parsed.texto_completo_md?.trim() ?? '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro Gemini';
    console.error('[gerar-documento] Erro Gemini:', err);
    return NextResponse.json({ error: `Falha ao gerar documento: ${msg}` }, { status: 500 });
  }

  // Salvar no Supabase se veio pelo ID
  if (body.indicacao_id) {
    await supabase
      .from('indicacoes')
      .update({
        documento_gerado_md: textoCompletoMd,
        documento_ementa: ementa,
      })
      .eq('id', body.indicacao_id)
      .eq('gabinete_id', GABINETE_ID);
  }

  return NextResponse.json({
    ok: true,
    indicacao_id: body.indicacao_id ?? null,
    ementa,
    texto_completo_md: textoCompletoMd,
    instrucao: 'Use a ementa em POST /api/sapl/protocolar com { descricao: ementa, tipo_sigla: "IND" }',
  });
}
