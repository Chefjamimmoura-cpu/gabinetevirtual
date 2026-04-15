import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth-guard';

// Lista dos temas padronizados conforme PRD
export const TEMAS_DISPONIVEIS = [
  'Saúde',
  'Educação',
  'Segurança pública',
  'Infraestrutura urbana',
  'Direitos da mulher',
  'Juventude',
  'Cultura e sociedade',
  'Meio ambiente',
  'Assistência social',
  'Ordenamento urbano',
  'Habitação',
  'Esporte',
  'Tecnologia e inovação',
  'Outros',
] as const;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from('pl_proposicoes')
      .select('tema');

    if (error) {
      console.error('[pls/distribuicao-temas] Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Agrupa por tema
    const contagemPorTema: Record<string, number> = {};
    (data || []).forEach(row => {
      const tema = row.tema || 'Outros';
      contagemPorTema[tema] = (contagemPorTema[tema] || 0) + 1;
    });

    // Formata para o gráfico: ordena por contagem decrescente
    const distribuicao = Object.entries(contagemPorTema)
      .map(([tema, count]) => ({ tema, count }))
      .sort((a, b) => b.count - a.count);

    const total = distribuicao.reduce((acc, { count }) => acc + count, 0);

    return NextResponse.json({
      total,
      distribuicao,
      temas_disponiveis: TEMAS_DISPONIVEIS,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[pls/distribuicao-temas] Unexpected error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
