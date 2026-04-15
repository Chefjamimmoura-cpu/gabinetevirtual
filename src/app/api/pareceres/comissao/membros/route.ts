// GET /api/pareceres/comissao/membros?comissao_id=12
// Busca os membros ativos de uma comissão no SAPL.
//
// Fluxo:
//   1. GET /api/comissoes/composicao/?comissao={comissao_id} → pega composição ativa (primeiro resultado)
//   2. GET /api/comissoes/participacao/?composicao={periodo_id} → filtra data_desligamento === null
//   3. Extrai nome de __str__: "Presidente : Carol Dantas" → split(' : ')[1]
//   4. Mapeia cargo: 1→presidente, 2→vice-presidente, 4→membro, 5→suplente
//
// Response: { membros: Array<{ nome: string, cargo: string }> }

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';

const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';
const SAPL_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const CARGO_MAP: Record<number, string> = {
  1: 'presidente',
  2: 'vice-presidente',
  4: 'membro',
  5: 'suplente',
};

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const comissao_id = searchParams.get('comissao_id');

  if (!comissao_id) {
    return NextResponse.json({ error: '"comissao_id" é obrigatório' }, { status: 400 });
  }

  // 1. Busca composições da comissão (período ativo = primeiro resultado)
  let periodoId: number;
  try {
    const res = await fetch(`${SAPL_BASE}/api/comissoes/composicao/?comissao=${comissao_id}`, {
      headers: SAPL_HEADERS,
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`SAPL composicao HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results?.length) {
      return NextResponse.json({ membros: [] });
    }
    periodoId = data.results[0].id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao buscar composição';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // 2. Busca participações do período ativo
  try {
    const res = await fetch(`${SAPL_BASE}/api/comissoes/participacao/?composicao=${periodoId}`, {
      headers: SAPL_HEADERS,
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`SAPL participacao HTTP ${res.status}`);
    const data = await res.json();

    const membros = (data.results ?? [])
      .filter((p: { data_desligamento: string | null }) => !p.data_desligamento)
      .map((p: { __str__: string; cargo: number }) => {
        // __str__: "Presidente : Carol Dantas"
        const parts = (p.__str__ || '').split(' : ');
        const nome = parts.length >= 2 ? parts[parts.length - 1].trim() : p.__str__ || '';
        const cargo = CARGO_MAP[p.cargo] ?? 'membro';
        return { nome, cargo };
      });

    return NextResponse.json({ membros });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao buscar participações';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
