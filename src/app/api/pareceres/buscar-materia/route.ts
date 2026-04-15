// GET /api/pareceres/buscar-materia
// Busca matérias legislativas no SAPL por número/ano ou por texto (ementa).
//
// Parâmetros (exclusivos):
//   - tipo_sigla + numero + ano  → busca direta (ex: PLL 32/2026)
//   - q                          → busca textual na ementa
//
// Resposta normalizada: { materias: MateriaItem[] }
// Sem autenticação: endpoint interno chamado pelo agente ALIA.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';

const SAPL_BASE = 'https://sapl.boavista.rr.leg.br/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SaplAutor {
  nome?: string;
  autor_related?: { nome?: string; __str__?: string };
  __str__?: string;
}

interface SaplTramitacao {
  data_tramitacao?: string;
  unidade_tramitacao_destino?: { comissao?: { sigla?: string; nome?: string } };
  status?: { descricao?: string; indicador?: string };
}

interface SaplMateria {
  id: number;
  tipo?: { sigla?: string };
  numero?: number;
  ano?: number;
  ementa?: string;
  autores?: SaplAutor[];
  data_apresentacao?: string;
  tramitacao_set?: SaplTramitacao[];
}

interface SaplListResponse {
  count?: number;
  results?: SaplMateria[];
}

interface MateriaItem {
  id: number;
  tipo_sigla: string;
  numero: number;
  ano: number;
  ementa: string;
  autores: string[];
  data_apresentacao?: string;
  tramitacao?: Array<{
    data?: string;
    comissao?: string;
    descricao?: string;
    situacao?: string;
  }>;
  url_sapl: string;
}

// ── Normalização ──────────────────────────────────────────────────────────────

function extrairNomeAutor(autor: SaplAutor): string {
  return (
    autor?.autor_related?.nome ||
    autor?.autor_related?.__str__ ||
    autor?.nome ||
    autor?.__str__ ||
    'Desconhecido'
  );
}

function normalizarTramitacao(trams: SaplTramitacao[] | undefined): MateriaItem['tramitacao'] {
  if (!trams || trams.length === 0) return [];

  return trams.slice(0, 10).map((t) => {
    const comissao =
      t.unidade_tramitacao_destino?.comissao?.sigla ||
      t.unidade_tramitacao_destino?.comissao?.nome;

    const descricao = t.status?.descricao;
    const situacao = t.status?.indicador === 'F'
      ? 'Favorável'
      : t.status?.indicador === 'C'
        ? 'Contrário'
        : t.status?.descricao;

    return {
      data: t.data_tramitacao,
      comissao,
      descricao,
      situacao,
    };
  });
}

function normalizarMateria(m: SaplMateria): MateriaItem {
  const tipoSigla = m.tipo?.sigla ?? 'N/I';
  const numero = m.numero ?? 0;
  const ano = m.ano ?? 0;

  return {
    id: m.id,
    tipo_sigla: tipoSigla,
    numero,
    ano,
    ementa: m.ementa ?? '',
    autores: (m.autores ?? []).map(extrairNomeAutor),
    data_apresentacao: m.data_apresentacao,
    tramitacao: normalizarTramitacao(m.tramitacao_set),
    url_sapl: `https://sapl.boavista.rr.leg.br/materia/${m.id}`,
  };
}

// ── Busca no SAPL ─────────────────────────────────────────────────────────────

async function buscarSapl(saplUrl: string): Promise<SaplMateria[]> {
  const res = await fetch(saplUrl, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`SAPL respondeu com status ${res.status}`);
  }

  const json = await res.json() as SaplListResponse;
  return json.results ?? [];
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);

    const tipoSigla = searchParams.get('tipo_sigla');
    const numero = searchParams.get('numero');
    const ano = searchParams.get('ano');
    const q = searchParams.get('q');

    let saplUrl: string;

    if (numero && ano) {
      // Busca direta por número e ano
      const params = new URLSearchParams({
        format: 'json',
        numero,
        ano,
      });
      if (tipoSigla) params.set('tipo__sigla', tipoSigla);

      saplUrl = `${SAPL_BASE}/materia/materialegislativa/?${params.toString()}`;
    } else if (q) {
      // Busca textual na ementa
      const params = new URLSearchParams({
        format: 'json',
        ementa__icontains: q,
        ordering: '-data_apresentacao',
        page_size: '5',
      });

      saplUrl = `${SAPL_BASE}/materia/materialegislativa/?${params.toString()}`;
    } else {
      return NextResponse.json(
        { error: 'Informe numero+ano ou q para busca textual.' },
        { status: 400 }
      );
    }

    const resultados = await buscarSapl(saplUrl);
    const materias: MateriaItem[] = resultados.map(normalizarMateria);

    return NextResponse.json({ materias });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar SAPL';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
