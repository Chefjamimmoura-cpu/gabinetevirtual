import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth-guard';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const supabase = await createClient();
  const { searchParams } = new URL(request.url);

  const status = searchParams.get('status'); // RASCUNHO | TRAMITANDO | COMISSAO | APROVADO | ARQUIVADO
  const tipo = searchParams.get('tipo');     // PLL | PDL | PRE | REQ | OUTROS
  const tema = searchParams.get('tema');
  const ano = searchParams.get('ano');
  const q = searchParams.get('q');           // busca textual na ementa
  const page = parseInt(searchParams.get('page') || '1', 10);
  const perPage = parseInt(searchParams.get('per_page') || '20', 10);
  const offset = (page - 1) * perPage;

  try {
    let query = supabase
      .from('pl_proposicoes')
      .select(`
        id, numero_sapl, tipo, ementa, tema, status,
        data_protocolo, aprovado_por, aprovado_em,
        pl_tronco_id, notificado_em, created_at, updated_at,
        pl_historico_tramitacao!pl_historico_tramitacao_pl_id_fkey(
          id, data_evento, status_novo, descricao, fonte, visualizado
        )
      `, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    if (status) query = query.eq('status', status);
    if (tipo) query = query.eq('tipo', tipo);
    if (tema) query = query.eq('tema', tema);
    if (ano) {
      query = query
        .gte('data_protocolo', `${ano}-01-01`)
        .lte('data_protocolo', `${ano}-12-31`);
    }
    if (q) query = query.ilike('ementa', `%${q}%`);

    const { data, error, count } = await query;

    if (error) {
      console.error('[pls/listar] Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Calcula resumo por status
    const { data: resumo } = await supabase
      .from('pl_proposicoes')
      .select('status')
      .then(({ data: rows }) => {
        const counts: Record<string, number> = {};
        (rows || []).forEach(r => {
          counts[r.status] = (counts[r.status] || 0) + 1;
        });
        return { data: counts };
      });

    // Resumo por tipo
    const { data: resumoPorTipo } = await supabase
      .from('pl_proposicoes')
      .select('tipo')
      .then(({ data: rows }) => {
        const counts: Record<string, number> = {};
        (rows || []).forEach(r => {
          counts[r.tipo] = (counts[r.tipo] || 0) + 1;
        });
        return { data: counts };
      });

    return NextResponse.json({
      total: count || 0,
      total_pages: Math.ceil((count || 0) / perPage),
      page,
      per_page: perPage,
      resumo_por_status: resumo,
      resumo_por_tipo: resumoPorTipo,
      results: data || [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[pls/listar] Unexpected error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
