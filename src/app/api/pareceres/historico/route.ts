// GET /api/pareceres/historico
// Retorna os últimos 20 pareceres gerados, salvos em `pareceres_historico`.
// Responde { results: HistoricoItem[] } ou { results: [] } se a tabela não existir.
//
// DELETE /api/pareceres/historico?id=<uuid>
// Remove um parecer do histórico pelo id.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey);
}

export async function GET() {
  try {
    const supa = getSupabase();
    if (!supa) return NextResponse.json({ results: [] });

    const { data, error } = await supa
      .from('pareceres_historico')
      .select('id, sessao_str, data_sessao, total_materias, model_usado, materia_ids, parecer_md, gerado_em')
      .order('gerado_em', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ results: [] });
    }

    return NextResponse.json({ results: data || [] });
  } catch {
    return NextResponse.json({ results: [] });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supa = getSupabase();
    if (!supa) return NextResponse.json({ error: 'Config inválida' }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Parâmetro "id" é obrigatório' }, { status: 400 });

    const { error } = await supa
      .from('pareceres_historico')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[DELETE /api/pareceres/historico]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/pareceres/historico]', err);
    return NextResponse.json({ error: 'Falha ao deletar parecer' }, { status: 500 });
  }
}
