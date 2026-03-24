// POST /api/rag/ingest
// ──────────────────────────────────────────────────────────────
// Ingesta documentos (Súmulas, PDFs jurídicos) convertendo fragmentos
// em Embeddings Vetoriais (Gemini 2.0) e salvando no Supabase (pgvector).
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  const auth = req.headers.get('authorization') || '';
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const { source_type, source_ref, text_chunks, delete_existing } = await req.json();

    if (!source_type || !text_chunks || !Array.isArray(text_chunks)) {
      return NextResponse.json(
        { error: 'Body inválido. Esperado {source_type, source_ref, text_chunks[]}' },
        { status: 400 }
      );
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      throw new Error('GEMINI_API_KEY não configurada no servidor.');
    }
    const genAI = new GoogleGenerativeAI(API_KEY);

    // O modelo recomendado para embeddings robustos 768d é text-embedding-004.
    // O gemini-embedding-2-preview suporta 3072 dims mas podemos capar o output param
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Identificar o gabinete padrão (ou passar via payload futuramente)
    const { data: gabinetes, error: gabErr } = await supabase.from('gabinetes').select('id');
    if (gabErr || !gabinetes || gabinetes.length === 0) {
      throw new Error('Nenhum gabinete encontrado para associar o vetor.');
    }
    const defaultGabineteId = gabinetes[0].id;

    // Se solicitado, apagar referências antigas para não duplicar Súmulas/Leis
    if (delete_existing && source_ref) {
      await supabase
        .from('cadin_knowledge_vectors')
        .delete()
        .eq('gabinete_id', defaultGabineteId)
        .eq('source_type', source_type)
        .eq('source_ref', source_ref);
    }

    let successCount = 0;
    const errors = [];

    // Gerar embeddings e dar INSERT (lote pequeno para demo, em pró pode otimizar as promessas)
    for (const chunk of text_chunks) {
      try {
        const cleanText = chunk.trim();
        if (!cleanText) continue;

        const result = await embeddingModel.embedContent(cleanText);
        const embedding = result.embedding.values;

        // O Array do Google SDK precisa virar array nativo PG [x, y, z...]
        const formattedEmbedding = `[${embedding.join(',')}]`;

        const { error: insertErr } = await supabase
          .from('cadin_knowledge_vectors')
          .insert({
            gabinete_id: defaultGabineteId,
            source_type,
            source_ref,
            chunk_text: cleanText,
            embedding: formattedEmbedding
          });

        if (insertErr) throw insertErr;
        successCount++;
      } catch (err: any) {
        console.error('Erro no chunk:', err);
        errors.push(err.message);
      }
    }

    return NextResponse.json({
      message: 'Ingestão concluída',
      chunks_recebidos: text_chunks.length,
      chunks_inseridos: successCount,
      erros: errors.length > 0 ? errors : undefined
    });

  } catch (error: any) {
    console.error('[RAG INGEST ERROR]', error);
    return NextResponse.json(
      { error: 'Falha na ingestão vetorial', detalhe: error.message },
      { status: 500 }
    );
  }
}
