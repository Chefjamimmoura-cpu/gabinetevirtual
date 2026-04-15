// POST /api/gabinete/sync-comissoes
// Descobre automaticamente as comissões de que o parlamentar faz parte no SAPL
// e salva em gabinetes.comissoes_descobertas (JSONB).
//
// Usa o campo sapl_parlamentar_id da tabela gabinetes.
// Endpoint SAPL consultado: /api/comissoes/participacao/?parlamentar={id}
//
// Response: { ok, comissoes: [{sigla, nome, sapl_comissao_id, cargo}], total }
//
// Também aceita ?parlamentar_id=N para override manual sem salvar no DB.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;
const SAPL_BASE   = 'https://sapl.boavista.rr.leg.br';
const SAPL_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
};

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface ParticipacaoComissao {
  id?: number;
  comissao?: number | { id: number; nome?: string; sigla?: string; __str__?: string };
  cargo?: string;
  data_designacao?: string;
  data_expiracao?: string | null;
  __str__?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const db = supabase();
  const { searchParams } = new URL(req.url);
  const overrideParlamentarId = searchParams.get('parlamentar_id');

  // Busca o parlamentar_id do gabinete (ou usa o override)
  let parlamentarId: number | null = overrideParlamentarId ? parseInt(overrideParlamentarId, 10) : null;

  if (!parlamentarId) {
    const { data: gabinete } = await db
      .from('gabinetes')
      .select('sapl_parlamentar_id')
      .eq('id', GABINETE_ID)
      .single();

    parlamentarId = gabinete?.sapl_parlamentar_id ?? null;
  }

  if (!parlamentarId) {
    return NextResponse.json(
      { error: 'sapl_parlamentar_id não configurado neste gabinete. Configure em /admin/configuracoes ou passe ?parlamentar_id=N.' },
      { status: 400 },
    );
  }

  try {
    // Busca participações ativas no SAPL
    const url = `${SAPL_BASE}/api/comissoes/participacao/?parlamentar=${parlamentarId}&format=json&page_size=100`;
    const res = await fetch(url, {
      headers: SAPL_HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `SAPL retornou HTTP ${res.status}` }, { status: 502 });
    }

    const json = await res.json() as { results?: ParticipacaoComissao[]; count?: number };
    const participacoes = json.results ?? [];

    // Filtra participações ativas (sem data_expiracao ou data futura)
    const hoje = new Date().toISOString().slice(0, 10);
    const ativas = participacoes.filter(p => {
      if (!p.data_expiracao) return true;
      return p.data_expiracao >= hoje;
    });

    // Para cada participação, busca dados completos da comissão se necessário
    const comissoes = await Promise.all(
      ativas.map(async (p) => {
        const comissaoRaw = p.comissao;
        let comissaoId: number | null = null;
        let comissaoNome = '';
        let comissaoSigla = '';

        if (typeof comissaoRaw === 'number') {
          comissaoId = comissaoRaw;
          // Busca detalhes da comissão pelo ID
          try {
            const cRes = await fetch(`${SAPL_BASE}/api/comissoes/comissao/${comissaoId}/?format=json`, {
              headers: SAPL_HEADERS,
              signal: AbortSignal.timeout(8000),
            });
            if (cRes.ok) {
              const c = await cRes.json() as { nome?: string; sigla?: string };
              comissaoNome  = c.nome  || '';
              comissaoSigla = c.sigla || '';
            }
          } catch {
            // fallback
          }
        } else if (comissaoRaw && typeof comissaoRaw === 'object') {
          comissaoId    = comissaoRaw.id;
          comissaoNome  = comissaoRaw.nome  || comissaoRaw.__str__ || '';
          comissaoSigla = comissaoRaw.sigla || '';
        }

        return {
          sigla:            comissaoSigla || `COM-${comissaoId}`,
          nome:             comissaoNome,
          sapl_comissao_id: comissaoId,
          cargo:            p.cargo || 'Membro',
          data_designacao:  p.data_designacao || null,
        };
      }),
    );

    // Salva em gabinetes.comissoes_descobertas (só se não for override manual)
    if (!overrideParlamentarId) {
      await db
        .from('gabinetes')
        .update({ comissoes_descobertas: comissoes })
        .eq('id', GABINETE_ID);
    }

    return NextResponse.json({ ok: true, comissoes, total: comissoes.length, parlamentar_id: parlamentarId });
  } catch (err) {
    console.error('[sync-comissoes] Erro:', err);
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
