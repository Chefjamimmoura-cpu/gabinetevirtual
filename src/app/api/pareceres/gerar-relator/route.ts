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
import { requireAuth } from '@/lib/supabase/auth-guard';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { fetchMateria, enrichMateria } from '@/lib/sapl/client';
import { buildRelatorSystemPrompt, getCommissionBySigla, type ModoGeracao } from '@/lib/parecer/prompts-relator';
import { resolveAuthorName, isProcuradoriaDoc, buildDocUrl, fetchCommissionDocContents } from '@/lib/parecer/build-context';

const MODEL_MAP: Record<string, string> = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

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
    modo?: ModoGeracao;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const { materia_id, commission_sigla, relator_nome, model = 'flash', gabinete_id, modo = 'autonomo' } = body;

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

  // Pareceres já existentes de outras comissões — fonte 1: endpoint /api/materia/parecer/
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

  // ── DOCUMENTOS ACESSÓRIOS — fonte 2: _docs (procuradoria + comissões) ──
  // Crítico: muitos pareceres existem APENAS em documentos acessórios,
  // não no endpoint /api/materia/parecer/. Sem estes dados a IA afirma falsamente "Sem parecer".
  const allDocs = materia._docs || [];
  const TIPO_PARECER_RELATOR  = 1;
  const TIPO_PARECER_COMISSAO = 16;

  const procuradoriaDocs = allDocs.filter(isProcuradoriaDoc);
  const comissaoDocs = allDocs.filter(d => {
    if (isProcuradoriaDoc(d)) return false;
    const tipo = typeof d.tipo === 'number' ? d.tipo : d.tipo?.id;
    if (tipo === TIPO_PARECER_RELATOR || tipo === TIPO_PARECER_COMISSAO) return true;
    const nome = (d.nome || '').toLowerCase();
    const str  = (d.__str__ || '').toLowerCase();
    return (nome.includes('parecer') || str.includes('parecer')) &&
           (nome.includes('comiss') || str.includes('comiss') || nome.includes('relator') || str.includes('relator'));
  });

  // ── OCR: extrai texto dos PDFs antes de montar o contexto ──
  // Sem isso, pareceres digitalizados chegam à IA sem conteúdo.
  let docContentMap: Map<number, string> = new Map();
  try {
    docContentMap = await fetchCommissionDocContents([materia]);
  } catch { /* silencioso — continua sem OCR */ }

  // Injeta _texto nos docs encontrados pelo OCR
  for (const d of [...procuradoriaDocs, ...comissaoDocs]) {
    if (d.id && docContentMap.has(d.id)) {
      (d as { _texto?: string })._texto = docContentMap.get(d.id);
    }
  }

  // ── RAG metadata — para o painel de controle no frontend ──
  interface RagDocInfo {
    id?: number;
    nome: string;
    url: string;
    data?: string;
    texto_extraido: boolean;
    trecho?: string;
  }

  const ragProcuradoria: RagDocInfo[] = procuradoriaDocs.map(d => {
    const texto = (d as { _texto?: string })._texto?.trim();
    return {
      id: d.id,
      nome: d.nome || 'Parecer da Procuradoria',
      url: buildDocUrl(d.arquivo),
      data: d.data,
      texto_extraido: !!(texto && texto.length > 50),
      trecho: texto && texto.length > 50 ? texto.slice(0, 300) : undefined,
    };
  });

  const ragComissoes: RagDocInfo[] = comissaoDocs.map(d => {
    const texto = (d as { _texto?: string })._texto?.trim();
    return {
      id: d.id,
      nome: `${d.autor || 'Comissão'} — ${d.nome || d.__str__ || 'Parecer'}`,
      url: buildDocUrl(d.arquivo),
      data: d.data,
      texto_extraido: !!(texto && texto.length > 50),
      trecho: texto && texto.length > 50 ? texto.slice(0, 300) : undefined,
    };
  });

  const cljrfEncontrado = ragComissoes.some(d =>
    d.nome.toUpperCase().includes('CLJRF') ||
    d.nome.toUpperCase().includes('LEGISLAÇÃO') ||
    d.nome.toUpperCase().includes('REDAÇÃO') ||
    d.nome.toUpperCase().includes('JUSTIÇA')
  );

  const procuradoriaEncontrada = ragProcuradoria.length > 0;

  const procuradoriaTexto = procuradoriaDocs.length > 0
    ? procuradoriaDocs.map(d => {
        const nomeDoc = d.nome || 'Parecer da Procuradoria';
        const texto   = (d as { _texto?: string })._texto?.trim();
        let linha = `  • ${nomeDoc.toUpperCase()}`;
        if (d.data) linha += ` | DATA: ${d.data}`;
        if (texto && texto.length > 50) linha += `\n    CONTEÚDO: "${texto.slice(0, 2000)}"`;
        else        linha += `\n    NOTA: Documento existe mas conteúdo não extraído. NÃO assuma ausência de parecer.`;
        return linha;
      }).join('\n')
    : '  Sem documento da Procuradoria nos documentos acessórios da matéria.';

  // Comissões com pareceres em documentos acessórios (pode incluir CLJRF, COF, etc.)
  const comissaoDocsTexto = comissaoDocs.length > 0
    ? comissaoDocs.map(d => {
        const autor  = d.autor || 'Comissão não identificada';
        const nome   = d.nome  || d.__str__ || 'Parecer de comissão';
        const texto  = (d as { _texto?: string })._texto?.trim();
        let linha = `  • ${autor} | ${nome}`;
        if (d.data) linha += ` | DATA: ${d.data}`;
        if (texto && texto.length > 50) linha += `\n    CONTEÚDO: "${texto.slice(0, 2000)}"`;
        else        linha += `\n    NOTA: Documento existe mas conteúdo não extraído. NÃO assuma ausência de parecer.`;
        return linha;
      }).join('\n')
    : '  Sem documentos de comissão nos documentos acessórios.';

  const materiaContext = `
CONTEXTO DA MATÉRIA PARA ELABORAÇÃO DO PARECER DE RELATOR

Data de elaboração: ${hoje}
Relator: ${relator_nome}
Comissão: ${commission.nome} (${commission.sigla})

DADOS DA MATÉRIA
Tipo: ${tipoSigla} — ${tipoDesc}
Número/Ano: ${materia.numero}/${materia.ano}
Ementa Oficial: ${materia.ementa || 'Sem ementa disponível'}
Autor(es): ${autorNome}
Regime de Tramitação: ${materia.regime_tramitacao?.descricao || 'Ordinário'}

TRAMITAÇÕES RECENTES:
${tramitacoesTexto}

PARECERES JÁ REGISTRADOS:
${pareceresExistentes}

PARECER DA PROCURADORIA (PROGE):
⚠️ Se um documento está listado abaixo, ele EXISTE. NÃO afirme "Sem Parecer da Procuradoria".
${procuradoriaTexto}

PARECERES DE COMISSÕES (documentos acessórios):
⚠️ Se documentos estão listados abaixo, os pareceres EXISTEM. NÃO afirme ausência.
⚠️ ALERTA DE OCR: O conteúdo abaixo foi extraído automaticamente de PDFs e PODE CONTER ERROS de digitação (letras trocadas, palavras ilegíveis). NUNCA copie texto com erros. Interprete o sentido e reescreva com suas próprias palavras.
${comissaoDocsTexto}

INSTRUÇÃO: Elabore o Parecer de Relator da ${commission.sigla} com EXATAMENTE 3 seções (I — RELATÓRIO, II — ANÁLISE, III — CONCLUSÃO). Sem links, sem citações OCR, sem seção de referências.
`.trim();

  const systemPrompt = buildRelatorSystemPrompt(commission, relator_nome.trim(), modo);
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
      voto: modo === 'autonomo' ? 'ANÁLISE_IA' : modo === 'forcar_favoravel' ? 'FAVORÁVEL (direcionado)' : 'CONTRÁRIO (direcionado)',
      modo,
      rag_docs: {
        procuradoria: ragProcuradoria,
        comissoes: ragComissoes,
        procuradoria_encontrada: procuradoriaEncontrada,
        cljrf_encontrado: cljrfEncontrado,
        total_docs_analisados: ragProcuradoria.length + ragComissoes.length,
        total_texto_extraido: ragProcuradoria.filter(d => d.texto_extraido).length + ragComissoes.filter(d => d.texto_extraido).length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao chamar o Gemini';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
