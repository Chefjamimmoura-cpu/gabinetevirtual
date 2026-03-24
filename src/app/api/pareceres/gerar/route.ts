// POST /api/pareceres/gerar
// Recebe IDs de matérias selecionadas, faz enriquecimento completo e chama o Gemini.
//
// Body:
//   materia_ids: number[]            — IDs das matérias selecionadas (preferido)
//   materias?: SaplMateria[]         — matérias já enriquecidas (retrocompat)
//   data_sessao?: string             — data ISO da sessão (ex: "2026-03-10")
//   sessao_str?: string              — string descritiva da sessão
//   folha_votacao_url?: string|null  — URL do PDF de pauta/votação
//   model?: 'flash' | 'pro'         — modelo Gemini (padrão: flash)
//
// Response: { parecer: string, model_used: string, total_materias: number }

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { SYSTEM_PROMPT } from '@/lib/parecer/prompts';
import { buildMateriaContext, fetchCommissionDocContents } from '@/lib/parecer/build-context';
import { fetchMateria, enrichMateria, lightEnrichMateria, type SaplMateria } from '@/lib/sapl/client';
import fs from 'fs';
import path from 'path';

const ENRICH_BATCH_SIZE = 5; // enriquecimento completo: 5 em paralelo é seguro

// V3-F4: matérias de Expediente (IND/REQ/MOC) não precisam de enrichMateria completo.
// lightEnrichMateria (tipo + autor) é suficiente — economiza ~4 chamadas SAPL por matéria.
const SIGLAS_EXPEDIENTE = new Set(['IND', 'REQ', 'MOC', 'RIV', 'REI', 'MEM']);

const MODEL_MAP: Record<string, string> = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

// V3-F2: Busca semântica no pgvector (cadin_knowledge_vectors)
// Usa as ementas das matérias legislativas como query de embedding.
async function queryVectorRag(genAI: GoogleGenerativeAI, ementas: string[]): Promise<string> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return '';

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Concatena as ementas para gerar um único embedding representativo
    const queryText = ementas.slice(0, 5).join(' | ');
    const embModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const embResult = await embModel.embedContent(queryText);
    const embedding = embResult.embedding.values;
    const formattedEmbedding = `[${embedding.join(',')}]`;

    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: formattedEmbedding,
      match_threshold: 0.55,
      match_count: 10,
    });

    if (error || !data || data.length === 0) return '';

    const chunks = (data as { source_ref?: string; source_type?: string; chunk_text: string }[])
      .map(r => `[${r.source_ref || r.source_type || 'Jurídico'}] ${r.chunk_text}`)
      .join('\n\n');

    return chunks;
  } catch {
    return '';
  }
}

function loadRagBase(): string {
  try {
    const dirs = [path.join(process.cwd(), 'base_conhecimento'), path.join(process.cwd(), '..', 'cmbv-parecer', 'base_conhecimento')];
    const baseDir = dirs.find(d => fs.existsSync(d));
    if (!baseDir) return '';
    const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.md'));
    return files.map(f => fs.readFileSync(path.join(baseDir, f), 'utf-8')).join('\n\n---\n\n');
  } catch {
    return '';
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada no servidor' }, { status: 500 });
  }

  let body: {
    materia_ids?: number[];
    materias?: SaplMateria[];
    data_sessao?: string;
    sessao_str?: string;
    folha_votacao_url?: string | null;
    model?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const { materia_ids, materias: materiasPreEnriquecidas, data_sessao, sessao_str, folha_votacao_url, model = 'flash' } = body;

  const temIds = Array.isArray(materia_ids) && materia_ids.length > 0;
  const temMaterias = Array.isArray(materiasPreEnriquecidas) && materiasPreEnriquecidas.length > 0;

  if (!temIds && !temMaterias) {
    return NextResponse.json({ error: 'Forneça "materia_ids" (preferido) ou "materias"' }, { status: 400 });
  }

  let materias: SaplMateria[];

  if (temIds) {
    // V3-F4: enriquecimento seletivo por tipo de matéria.
    // Expediente (IND/REQ/MOC): lightEnrichMateria — só tipo + autor, economiza ~4 calls SAPL.
    // Legislativas (PLL/PDL/PLC...): enrichMateria completo — docs, tramitações, pareceres.
    const enriched: SaplMateria[] = [];
    for (let i = 0; i < materia_ids!.length; i += ENRICH_BATCH_SIZE) {
      const batch = materia_ids!.slice(i, i + ENRICH_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            const mat = await fetchMateria(id);
            // Resolve tipo_sigla para decidir a profundidade do enriquecimento
            const sigla = (
              mat.tipo_sigla ||
              (typeof mat.tipo === 'object' ? (mat.tipo as { sigla?: string })?.sigla : undefined) ||
              ''
            ).toUpperCase();
            const fn = SIGLAS_EXPEDIENTE.has(sigla) ? lightEnrichMateria : enrichMateria;
            return await fn(mat);
          } catch {
            return null;
          }
        })
      );
      enriched.push(...results.filter((m): m is SaplMateria => m !== null));
    }
    materias = enriched;
  } else {
    materias = materiasPreEnriquecidas!;
  }

  if (materias.length === 0) {
    return NextResponse.json({ error: 'Nenhuma matéria válida para análise' }, { status: 400 });
  }

  const modelId = MODEL_MAP[model] || MODEL_MAP.flash;
  const genAI = new GoogleGenerativeAI(apiKey);

  // RAG: arquivos MD locais (base jurídica estática)
  const ragBase = loadRagBase();

  // V3-F2: RAG vetorial (pgvector) — busca semântica por ementas das matérias legislativas
  const ementas = materias
    .filter(m => {
      const sigla = (m.tipo_sigla || '').toUpperCase();
      return !['IND', 'REQ', 'MOC', 'RIV', 'REI', 'MEM'].includes(sigla);
    })
    .map(m => m.ementa || '')
    .filter(Boolean);

  const vectorRag = ementas.length > 0 ? await queryVectorRag(genAI, ementas) : '';

  // Monta sistema com RAG combinado (arquivo + vetorial)
  let systemWithRag = SYSTEM_PROMPT;
  if (ragBase) systemWithRag += `\n\n---\n\n## BASE DE CONHECIMENTO JURÍDICO (LEIS APENSADAS)\n\n${ragBase}`;
  if (vectorRag) systemWithRag += `\n\n---\n\n## JURISPRUDÊNCIA E SÚMULAS RELEVANTES (BUSCA SEMÂNTICA)\n\n${vectorRag}`;

  // OCR/FlateDecode: pré-carrega texto dos PDFs de comissões e procuradoria
  // antes de construir o contexto — garante votos corretos sem alucinação
  const docVotes = await fetchCommissionDocContents(materias);

  const userContext = buildMateriaContext(materias, data_sessao, sessao_str, folha_votacao_url, docVotes);

  try {
    const gemini = genAI.getGenerativeModel({
      model: modelId,
      systemInstruction: systemWithRag,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 65536,
      },
    });

    const result = await gemini.generateContent(userContext);
    const parecer = result.response.text();

    // Salva no histórico — falha silenciosa se a tabela ainda não existir
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && supabaseKey) {
        const { createClient } = await import('@supabase/supabase-js');
        const supa = createClient(supabaseUrl, supabaseKey);
        await supa.from('pareceres_historico').insert({
          sessao_str: sessao_str || null,
          data_sessao: data_sessao || null,
          total_materias: materias.length,
          model_usado: modelId,
          materia_ids: materia_ids || [],
          parecer_md: parecer,
        });
      }
    } catch {
      // Histórico indisponível — não interrompe a resposta
    }

    return NextResponse.json({
      parecer,
      model_used: modelId,
      total_materias: materias.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao chamar o Gemini';
    const statusCode = (err as any)?.status || (err as any)?.httpStatusCode || 502;
    console.error('[POST /api/pareceres/gerar] Gemini error:', {
      message,
      statusCode,
      modelId,
      totalMaterias: materias.length,
      contextLength: userContext.length,
      errorName: (err as any)?.constructor?.name,
      fullError: JSON.stringify(err, Object.getOwnPropertyNames(err as object)).substring(0, 1000),
    });
    return NextResponse.json({ error: message, model: modelId, context_chars: userContext.length }, { status: statusCode });
  }
}
