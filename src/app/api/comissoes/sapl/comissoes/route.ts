// GET /api/comissoes/sapl/comissoes
// Lista as comissões permanentes do SAPL com seus membros.
// Usado para identificar em quais comissões a vereadora Carol atua.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { SAPL_BASE } from '@/lib/sapl/client';

const DEFAULT_TIMEOUT = 15000;

async function saplFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, SAPL_BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'CMBV-Gabinete/2.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`SAPL HTTP ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

interface SaplComissao {
  id: number;
  nome: string;
  sigla?: string;
  tipo?: { nome?: string };
  ativa?: boolean;
  __str__?: string;
}

interface SaplMembro {
  id: number;
  composicao?: { comissao?: number };
  participacao?: { nome?: string };
  cargo?: { nome?: string };
  parlamentar?: { nome_parlamentar?: string; __str__?: string };
  __str__?: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    // 1. Buscar comissões permanentes ativas
    const comissoesData = await saplFetch<{ results: SaplComissao[] }>(
      '/api/materia/comissao/',
      { page_size: '50', ativa: 'True' }
    );
    const comissoes = comissoesData.results || [];

    // 2. Para cada comissão, buscar membros da composição atual
    const enriched = await Promise.all(
      comissoes.map(async (c) => {
        try {
          // Buscar composição mais recente (maior periodo)
          const compData = await saplFetch<{ results: { id: number; periodo?: { data_inicio?: string } }[] }>(
            '/api/materia/composicaocomissao/',
            { comissao: String(c.id), page_size: '5' }
          );
          const comps = compData.results || [];
          if (comps.length === 0) return { ...c, membros: [] };

          // Usar a composição mais recente
          const latestComp = comps.sort((a, b) =>
            (b.periodo?.data_inicio || '').localeCompare(a.periodo?.data_inicio || '')
          )[0];

          const membrosData = await saplFetch<{ results: SaplMembro[] }>(
            '/api/materia/participacaocomissao/',
            { composicao: String(latestComp.id), page_size: '20' }
          );

          const membros = (membrosData.results || []).map(m => ({
            nome: m.parlamentar?.nome_parlamentar || m.__str__ || '—',
            cargo: m.cargo?.nome || m.participacao?.nome || '—',
          }));

          return { ...c, membros };
        } catch {
          return { ...c, membros: [] };
        }
      })
    );

    return NextResponse.json({ results: enriched, total: enriched.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar comissões';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
