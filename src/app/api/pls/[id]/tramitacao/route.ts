// GET /api/pls/[id]/tramitacao
// Retorna histórico de tramitação de um PL específico
// Marca automáticamente como visualizado quando acessado

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth-guard';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = await createClient();

  if (!id) {
    return NextResponse.json({ error: 'ID do PL é obrigatório' }, { status: 400 });
  }

  try {
    // Busca o PL e seu histórico (RLS garante acesso apenas ao próprio gabinete)
    const { data: pl, error: plError } = await supabase
      .from('pl_proposicoes')
      .select(`
        id, numero_sapl, tipo, ementa, tema, status,
        data_protocolo, aprovado_por, aprovado_em, created_at, updated_at,
        pl_historico_tramitacao!pl_historico_tramitacao_pl_id_fkey(
          id, data_evento, status_novo, descricao, fonte, visualizado, created_at
        )
      `)
      .eq('id', id)
      .order('data_evento', {
        referencedTable: 'pl_historico_tramitacao',
        ascending: false,
      })
      .single();

    if (plError || !pl) {
      return NextResponse.json({ error: 'PL não encontrado' }, { status: 404 });
    }

    // Marca entradas não visualizadas como visualizadas (RN-07)
    const naoVisualizados = (pl.pl_historico_tramitacao as Array<{ id: string; visualizado: boolean }>)
      .filter(h => !h.visualizado)
      .map(h => h.id);

    if (naoVisualizados.length > 0) {
      await supabase
        .from('pl_historico_tramitacao')
        .update({ visualizado: true })
        .in('id', naoVisualizados);
    }

    return NextResponse.json({
      ok: true,
      pl,
      historico: pl.pl_historico_tramitacao,
      notificacoes_marcadas: naoVisualizados.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[pls/tramitacao] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
