// POST /api/pareceres/gerar-relator
// Gera o parecer de relator de uma comissão para uma matéria específica.
// White-label: funciona para qualquer vereador/relator e qualquer comissão da CMBV.
//
// Body:
//   materia_id: number           — ID da matéria no SAPL
//   commission_sigla: string     — Sigla da comissão (ex: "CASP", "CLJRF")
//   relator_nome: string         — Nome completo do relator
//   voto: 'FAVORÁVEL' | 'CONTRÁRIO' | 'CAUTELA'
//   model?: 'flash' | 'pro'     — Modelo Gemini (padrão: flash)
//
// Response: { parecer_relator: string, model_used: string, materia_tipo: string }

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { fetchMateria, enrichMateria } from '@/lib/sapl/client';
import { buildRelatorSystemPrompt, getCommissionBySigla } from '@/lib/parecer/prompts-relator';
import { resolveAuthorName } from '@/lib/parecer/build-context';

const MODEL_MAP: Record<string, string> = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  let body: {
    materia_id?: number;
    commission_sigla?: string;
    relator_nome?: string;
    voto?: string;
    model?: string;
    gabinete_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const { materia_id, commission_sigla, relator_nome, model = 'flash', gabinete_id } = body;

  if (!materia_id) return NextResponse.json({ error: '"materia_id" é obrigatório' }, { status: 400 });
  if (!commission_sigla) return NextResponse.json({ error: '"commission_sigla" é obrigatório' }, { status: 400 });
  if (!relator_nome?.trim()) return NextResponse.json({ error: '"relator_nome" é obrigatório' }, { status: 400 });

  const commission = getCommissionBySigla(commission_sigla);
  if (!commission) {
    return NextResponse.json({ error: `Comissão "${commission_sigla}" não encontrada. Use: CLJRF, COF, COUTH, CECEJ, CSASM, CDCDHAISU, CEDP, CASP, CPMAIPD, CAG` }, { status: 400 });
  }

  // Busca e enriquece a matéria no SAPL
  let materia;
  try {
    const raw = await fetchMateria(materia_id);
    materia = await enrichMateria(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Matéria não encontrada';
    return NextResponse.json({ error: `Falha ao buscar matéria ${materia_id}: ${msg}` }, { status: 502 });
  }

  // Monta o contexto da matéria para o parecer de relator
  const tipoSigla = materia.tipo_sigla || (typeof materia.tipo === 'object' ? (materia.tipo as { sigla?: string })?.sigla : '') || 'PLL';
  const tipoDesc = materia.tipo_descricao || (typeof materia.tipo === 'object' ? (materia.tipo as { descricao?: string })?.descricao : '') || '';
  const autorNome = resolveAuthorName(materia);
  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  // Tramitações recentes para contexto
  const tramitacoesTexto = (materia._tramits || [])
    .slice(-8)
    .map(t => `  • [${t.data_tramitacao || ''}] ${t.__str__ || t.texto || ''}`)
    .join('\n') || '  Sem tramitações registradas.';

  // Pareceres já existentes de outras comissões (CLJRF em destaque)
  const pareceresList = (materia._pareceres || []);
  const cljrfParecer = pareceresList.find(p => {
    const n = (p.comissao_nome || (typeof p.comissao === 'object' ? p.comissao?.nome : '') || '').toUpperCase();
    return n.includes('LEGISLAÇÃO') || n.includes('CLJRF') || n.includes('JUSTIÇA');
  });
  const outrosPaReceres = pareceresList.filter(p => p !== cljrfParecer);
  const pareceresExistentes = [
    cljrfParecer ? `  ⭐ CLJRF (MAIS IMPORTANTE — citar na análise): ${cljrfParecer.parecer || 'Não identificado'}` : null,
    ...outrosPaReceres.map(p => {
      const comissaoNome = (p.comissao_nome || (typeof p.comissao === 'object' ? p.comissao?.nome : '') || 'Comissão').trim();
      const resultado = p.parecer || 'Não identificado';
      return `  • ${comissaoNome}: ${resultado}`;
    }),
  ].filter(Boolean).join('\n') || '  Nenhum parecer registrado ainda.';

  const materiaContext = `
CONTEXTO DA MATÉRIA PARA ELABORAÇÃO DO PARECER DE RELATOR

Data de elaboração: ${hoje}
Relator: ${relator_nome}
Comissão: ${commission.nome} (${commission.sigla})
Instrução de Voto: Determinar com base na análise técnica da ${commission.sigla}

---

DADOS DA MATÉRIA
Tipo: ${tipoSigla} — ${tipoDesc}
Número/Ano: ${materia.numero}/${materia.ano}
ID no SAPL: ${materia.id}
Link no SAPL: https://sapl.boavista.rr.leg.br/materia/${materia.id}
Ementa Oficial: ${materia.ementa || 'Sem ementa disponível'}
Autor(es): ${autorNome}
Regime de Tramitação: ${materia.regime_tramitacao?.descricao || 'Ordinário'}

---

TRAMITAÇÕES RECENTES (8 mais recentes):
${tramitacoesTexto}

---

PARECERES DE OUTRAS COMISSÕES JÁ REGISTRADOS:
${pareceresExistentes}

---

INSTRUÇÃO: Com base nos dados acima, elabore o Parecer de Relator da ${commission.sigla} seguindo rigorosamente a estrutura definida. Determine o voto com base na análise técnico-jurídica da área de competência da comissão.
`.trim();

  const systemPrompt = buildRelatorSystemPrompt(commission, relator_nome.trim());
  const modelId = MODEL_MAP[model] || MODEL_MAP.flash;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const gemini = genAI.getGenerativeModel({
      model: modelId,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });

    const result = await gemini.generateContent(materiaContext);
    const parecerRelator = result.response.text();

    // Salva no histórico de pareceres de relator
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && supabaseKey) {
        const { createClient } = await import('@supabase/supabase-js');
        const supa = createClient(supabaseUrl, supabaseKey);
        await supa.from('pareceres_relator').insert({
          gabinete_id: gabinete_id || process.env.GABINETE_ID,
          materia_id: materia.id,
          materia_tipo: `${tipoSigla} ${materia.numero}/${materia.ano}`,
          commission_sigla: commission.sigla,
          relator_nome: relator_nome.trim(),
          voto: 'ANÁLISE_IA',
          texto_gerado: parecerRelator,
          model_used: modelId,
        });
      }
    } catch {
      // Ignora erro de inserção no histórico para não quebrar a requisição
    }

    return NextResponse.json({
      parecer_relator: parecerRelator,
      model_used: modelId,
      materia_tipo: `${tipoSigla} ${materia.numero}/${materia.ano}`,
      commission: commission.sigla,
      relator: relator_nome,
      voto: 'ANÁLISE_IA',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao chamar o Gemini';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
