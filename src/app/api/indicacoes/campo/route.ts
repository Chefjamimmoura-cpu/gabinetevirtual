// GET /api/indicacoes/campo
// ──────────────────────────────────────────────────────────────
// Lista indicações coletadas em campo (tabela `indicacoes`).
// Usada pelo CampoKanban e pelo Mapa.
//
// Params:
//   q              → busca textual (titulo, bairro, logradouro)
//   status         → pendente | em_andamento | atendida | arquivada | all (padrão: all exceto arquivada)
//   classificacao  → necessidade | prioridade | urgencia
//   responsavel    → nome do responsável (ilike)
//   bairro         → bairro (ilike)
//   fonte          → manual | whatsapp | fala_cidadao | all (padrão: all)
//   com_geo        → true → só com geo_lat/geo_lng (para mapa)
//   page           → número da página (padrão: 1)
//   page_size      → itens por página (padrão: 100)
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

export async function GET(req: NextRequest) {
  // Auth obrigatória — expõe PII de cidadãos (nome, bairro, GPS, fotos)
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { searchParams } = req.nextUrl;

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? 'all';
  const classificacao = searchParams.get('classificacao') ?? '';
  const responsavel = searchParams.get('responsavel') ?? '';
  const bairro = searchParams.get('bairro') ?? '';
  const fonte = searchParams.get('fonte') ?? 'all';
  const comGeo = searchParams.get('com_geo') === 'true';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(200, parseInt(searchParams.get('page_size') ?? '100', 10));

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let query = supabase
    .from('indicacoes')
    .select(`
      id, titulo, bairro, logradouro, setores, classificacao,
      responsavel_nome, status, fonte, documento_ementa,
      documento_gerado_md, protocolado_em, sapl_numero,
      fotos_urls, geo_lat, geo_lng, created_at, observacoes
    `, { count: 'exact' })
    .eq('gabinete_id', GABINETE_ID);

  // Filtros
  if (status !== 'all') {
    query = query.eq('status', status);
  } else {
    // Por padrão, exclui arquivadas
    query = query.neq('status', 'arquivada');
  }

  if (classificacao) query = query.eq('classificacao', classificacao);
  if (responsavel) query = query.ilike('responsavel_nome', `%${responsavel}%`);
  if (bairro) query = query.ilike('bairro', `%${bairro}%`);
  if (fonte !== 'all') query = query.eq('fonte', fonte);
  if (comGeo) {
    query = query.not('geo_lat', 'is', null);
    query = query.not('geo_lng', 'is', null);
  }

  if (q) {
    query = query.or(`titulo.ilike.%${q}%,bairro.ilike.%${q}%,logradouro.ilike.%${q}%`);
  }

  // Paginação
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Ordenação: urgência primeiro, depois por data
  query = query
    .order('created_at', { ascending: false })
    .range(from, to);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return NextResponse.json({
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    results: data ?? [],
  });
}
