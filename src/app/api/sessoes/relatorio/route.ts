// POST /api/sessoes/relatorio
// Gera relatório estruturado a partir da transcrição (via Gemini)
// Body: { sessao_id: string }
// Response: { ok, relatorio: string }

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '@/lib/supabase/auth-guard';

export const maxDuration = 120;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const SYSTEM_PROMPT = `Você é uma assessora parlamentar da Câmara Municipal de Boa Vista/RR, responsável por elaborar relatórios de sessões plenárias.

REGRAS ABSOLUTAS:
1. USE EXCLUSIVAMENTE o conteúdo da transcrição fornecida. NÃO invente informações, nomes, números, projetos ou votações que não constem no texto.
2. Se algum trecho está marcado como [INAUDÍVEL] ou ###, sinalize no relatório como "(trecho inaudível)".
3. Se um orador está como "Comunicador N", mantenha assim — não invente nomes.
4. Organize o relatório nas seções abaixo.
5. Tom formal, impessoal, em português.

ESTRUTURA DO RELATÓRIO:

**RELATÓRIO DA SESSÃO PLENÁRIA**
**Câmara Municipal de Boa Vista — RR**

**Data:** [data da sessão]
**Duração:** [duração]

---

### 1. ABERTURA E EXPEDIENTE
Resumo da abertura da sessão, verificação de quórum, leitura da ata anterior.

### 2. MATÉRIAS EM DISCUSSÃO
Para cada matéria/projeto mencionado:
- Tipo e número (se citado)
- Autor (se citado)
- Resumo do que foi discutido
- Posicionamentos dos vereadores que se manifestaram

### 3. VOTAÇÕES E DELIBERAÇÕES
Resultados de votações mencionadas (aprovado/rejeitado/adiado).

### 4. PRONUNCIAMENTOS NA TRIBUNA
Resumo dos discursos na tribuna livre, indicando o orador e o tema.
IMPORTANTE: Resuma cada pronunciamento em no máximo 2-3 frases. Não transcreva discursos inteiros.

### 5. ENCERRAMENTO
Como foi encerrada a sessão.

REGRA CRÍTICA: O relatório deve ser COMPLETO — SEMPRE termine com a seção 5. ENCERRAMENTO. Se necessário, seja mais conciso nas seções anteriores para garantir que o relatório caiba por inteiro.

---

Se alguma seção não tiver conteúdo na transcrição, escreva: "Não foram identificados registros sobre este item na transcrição."`;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });

  let body: { sessao_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }); }

  const { sessao_id } = body;
  if (!sessao_id) return NextResponse.json({ error: 'sessao_id obrigatório' }, { status: 400 });

  const supabase = getSupabase();
  const { data: sessao, error } = await supabase
    .from('sessoes_transcritas')
    .select('titulo, data_sessao, duracao_segundos, transcricao, pontos_chave')
    .eq('id', sessao_id)
    .single();

  if (error || !sessao) return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 });
  if (!sessao.transcricao?.segments?.length) return NextResponse.json({ error: 'Transcrição vazia' }, { status: 422 });

  // Montar contexto da transcrição para o Gemini
  const segments = sessao.transcricao.segments as { speaker: string; start: number; text: string; isUnclear: boolean }[];
  const transcricaoTexto = segments.map(s => {
    const time = `${String(Math.floor(s.start / 60)).padStart(2, '0')}:${String(Math.floor(s.start % 60)).padStart(2, '0')}`;
    const texto = s.isUnclear ? '[INAUDÍVEL]' : s.text;
    return `[${time}] ${s.speaker}: ${texto}`;
  }).join('\n');

  const durFmt = sessao.duracao_segundos
    ? `${Math.floor(sessao.duracao_segundos / 3600)}h${String(Math.floor((sessao.duracao_segundos % 3600) / 60)).padStart(2, '0')}m`
    : 'Não informada';

  const userPrompt = `Elabore o relatório da seguinte sessão plenária.

TÍTULO: ${sessao.titulo}
DATA: ${sessao.data_sessao || 'Não informada'}
DURAÇÃO: ${durFmt}

TRANSCRIÇÃO COMPLETA (${segments.length} blocos):

${transcricaoTexto}

${sessao.pontos_chave?.length ? `\nPONTOS-CHAVE DETECTADOS:\n${(sessao.pontos_chave as { title: string; start: number }[]).map(kp => `- [${String(Math.floor(kp.start / 60)).padStart(2, '0')}:${String(Math.floor(kp.start % 60)).padStart(2, '0')}] ${kp.title}`).join('\n')}` : ''}

Gere o relatório seguindo RIGOROSAMENTE a estrutura definida. Use APENAS informações presentes na transcrição.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
    });

    const result = await model.generateContent(userPrompt);
    const relatorio = result.response.text();

    // Salvar no banco
    await supabase.from('sessoes_transcritas').update({
      relatorio,
      updated_at: new Date().toISOString(),
    }).eq('id', sessao_id);

    return NextResponse.json({ ok: true, relatorio });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao gerar relatório';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
