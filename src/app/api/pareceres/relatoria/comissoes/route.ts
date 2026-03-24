// GET  /api/pareceres/relatoria/comissoes
//   Retorna as comissões configuradas para o gabinete (de gabinetes.comissoes_config).
//   Fallback: se não houver config no DB, retorna as comissões estáticas de COMISSOES_CMBV
//   (compatibilidade retroativa).
//
// POST /api/pareceres/relatoria/comissoes
//   Salva a lista de comissões no gabinete (upsert completo do array).
//   Body: { comissoes: CommissionDynamic[] }

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { COMISSOES_CMBV } from '@/lib/parecer/prompts-relator';

export interface CommissionDynamic {
  sigla: string;
  nome: string;
  area: string;
  criterios: string;
  keywords: string[];
  sapl_unit_id: number | null;
  artigoRegimento?: string;
  link_lei?: string;
}

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Converte o array estático COMISSOES_CMBV para o formato CommissionDynamic */
function staticFallback(): CommissionDynamic[] {
  return COMISSOES_CMBV.map(c => ({
    sigla: c.sigla,
    nome: c.nome,
    area: c.areaExpertise ?? c.area ?? '',
    criterios: c.criteriosAnalise ?? c.criterios ?? '',
    keywords: c.saplKeywords ?? c.keywords ?? [],
    sapl_unit_id: c.sapl_unit_id ?? null,
    artigoRegimento: c.artigoRegimento,
    link_lei: c.link_lei,
  }));
}

export async function GET() {
  try {
    const db = supabase();
    const { data, error } = await db
      .from('gabinetes')
      .select('comissoes_config')
      .eq('id', GABINETE_ID)
      .single();

    if (error) throw error;

    const config = data?.comissoes_config as CommissionDynamic[] | null;
    if (!config || !Array.isArray(config) || config.length === 0) {
      // Fallback para lista estática (CMBV)
      return NextResponse.json({ comissoes: staticFallback(), source: 'static_fallback' });
    }

    return NextResponse.json({ comissoes: config, source: 'database' });
  } catch (err) {
    console.error('[GET /api/pareceres/relatoria/comissoes]', err);
    // Em caso de erro, retorna fallback estático para não quebrar a UI
    return NextResponse.json({ comissoes: staticFallback(), source: 'static_fallback' });
  }
}

export async function POST(req: NextRequest) {
  let body: { comissoes: CommissionDynamic[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  if (!Array.isArray(body.comissoes)) {
    return NextResponse.json({ error: '"comissoes" deve ser um array' }, { status: 400 });
  }

  // Valida schema mínimo de cada item
  for (const c of body.comissoes) {
    if (!c.sigla || !c.nome) {
      return NextResponse.json({ error: 'Cada comissão precisa de "sigla" e "nome"' }, { status: 400 });
    }
  }

  try {
    const db = supabase();
    const { error } = await db
      .from('gabinetes')
      .update({ comissoes_config: body.comissoes })
      .eq('id', GABINETE_ID);

    if (error) throw error;
    return NextResponse.json({ success: true, total: body.comissoes.length });
  } catch (err) {
    console.error('[POST /api/pareceres/relatoria/comissoes]', err);
    return NextResponse.json({ error: 'Falha ao salvar comissões' }, { status: 500 });
  }
}
