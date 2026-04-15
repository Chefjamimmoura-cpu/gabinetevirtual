// GET /api/pareceres/alertas
// Consolida 3 tipos de alerta do módulo de pareceres:
//   1. materias_novas  — matérias recentes em filas de comissão sem rascunho
//   2. ordem_do_dia    — próxima sessão com pauta publicada (hoje ou futuro)
//   3. pendencias      — pareceres em workflow incompleto + matérias sem parecer
//
// Padrão: service role key server-side, sem auth middleware.
// Usado pelo dashboard (fetchSummary) e módulo pareceres (useEffect).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { COMISSOES_CMBV } from '@/lib/parecer/prompts-relator';

const GABINETE_ID = process.env.GABINETE_ID!;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParecerAlertas {
  materias_novas: {
    total: number;
    por_comissao: { sigla: string; nome: string; count: number }[];
    desde: string; // ISO date of cutoff (7 days ago)
  };
  ordem_do_dia: {
    sessao_id: number;
    numero: string;
    data: string;
    total_materias: number;
  } | null;
  pendencias: {
    total: number;
    em_rascunho: number;
    aguardando_assinatura: number;
    sem_parecer: number;
    criticos: number; // more than 7 days without action
    mais_antigo_dias: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CommissionDynamic {
  sigla: string;
  nome: string;
  keywords: string[];
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Carrega comissões do DB; fallback estático se vazio */
async function loadCommissions(db: ReturnType<typeof supabase>): Promise<CommissionDynamic[]> {
  try {
    const { data } = await db
      .from('gabinetes')
      .select('comissoes_config')
      .eq('id', GABINETE_ID)
      .single();

    const cfg = data?.comissoes_config as CommissionDynamic[] | null;
    if (cfg && Array.isArray(cfg) && cfg.length > 0) {
      return cfg.map(c => ({
        sigla: c.sigla,
        nome: c.nome,
        keywords: c.keywords ?? [],
      }));
    }
  } catch {
    // Fallback
  }
  return COMISSOES_CMBV.map((c: { sigla: string; nome: string; saplKeywords?: string[]; keywords?: string[] }) => ({
    sigla: c.sigla,
    nome: c.nome,
    keywords: c.saplKeywords ?? c.keywords ?? [],
  }));
}

// ── GET handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const db = supabase();

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoffISO = sevenDaysAgo.toISOString();
    const todayStr = now.toISOString().slice(0, 10);

    // Carrega comissões primeiro (necessário para materias_novas)
    const commissions = await loadCommissions(db);

    // ── Queries paralelas ────────────────────────────────────────────────────
    const [materiasResult, rascunhosResult, sessaoResult, pendenciasResult] =
      await Promise.allSettled([
        // 1. Matérias recentes no cache (últimos 7 dias)
        db
          .from('sapl_materias_cache')
          .select('id, tramitacoes_json')
          .eq('gabinete_id', GABINETE_ID)
          .gte('last_synced_at', cutoffISO),

        // 2. Matérias que já têm rascunho de relator
        db
          .from('pareceres_relator')
          .select('materia_id')
          .eq('gabinete_id', GABINETE_ID),

        // 3. Próxima sessão com pauta publicada (hoje ou futuro)
        db
          .from('sapl_sessoes_cache')
          .select('id, numero, data_sessao')
          .not('upload_pauta', 'is', null)
          .gte('data_sessao', todayStr)
          .order('data_sessao', { ascending: true })
          .limit(1),

        // 4. Pareceres com workflow incompleto
        db
          .from('comissao_pareceres')
          .select('id, workflow_status, created_at, updated_at')
          .eq('gabinete_id', GABINETE_ID)
          .not('workflow_status', 'in', '("assinado","publicado")'),
      ]);

    // ── 1. Matérias novas por comissão ───────────────────────────────────────
    type CachedMateria = { id: number; tramitacoes_json: unknown };
    const materias: CachedMateria[] =
      materiasResult.status === 'fulfilled'
        ? (materiasResult.value.data ?? [])
        : [];

    const draftsSet = new Set<number>();
    if (rascunhosResult.status === 'fulfilled' && rascunhosResult.value.data) {
      for (const r of rascunhosResult.value.data) {
        draftsSet.add(r.materia_id);
      }
    }

    // Filtra matérias sem rascunho
    const materiaSemRascunho = materias.filter(m => !draftsSet.has(m.id));

    // Conta por comissão (match via keywords no tramitacoes_json)
    const porComissao: { sigla: string; nome: string; count: number }[] = [];

    // Matérias já contabilizadas (evita dupla contagem entre comissões)
    const contabilizadas = new Set<number>();

    for (const comm of commissions) {
      if (comm.keywords.length === 0) continue;
      const kwLower = comm.keywords.map(k => k.toLowerCase());
      let count = 0;

      for (const m of materiaSemRascunho) {
        if (contabilizadas.has(m.id)) continue;
        const tramJson = Array.isArray(m.tramitacoes_json)
          ? JSON.stringify(m.tramitacoes_json).toLowerCase()
          : typeof m.tramitacoes_json === 'string'
            ? (m.tramitacoes_json as string).toLowerCase()
            : '';

        if (kwLower.some(kw => tramJson.includes(kw))) {
          count++;
          contabilizadas.add(m.id);
        }
      }

      if (count > 0) {
        porComissao.push({ sigla: comm.sigla, nome: comm.nome, count });
      }
    }

    const totalNovas = porComissao.reduce((acc, c) => acc + c.count, 0);

    // ── 2. Ordem do dia ──────────────────────────────────────────────────────
    let ordemDoDia: ParecerAlertas['ordem_do_dia'] = null;

    if (sessaoResult.status === 'fulfilled' && sessaoResult.value.data?.length) {
      const sessao = sessaoResult.value.data[0];

      // Conta matérias vinculadas à sessão via cache
      let totalMaterias = 0;
      try {
        const { count } = await db
          .from('sapl_materias_cache')
          .select('id', { count: 'exact', head: true })
          .eq('gabinete_id', GABINETE_ID)
          .eq('sessao_id', sessao.id);
        totalMaterias = count ?? 0;
      } catch {
        // Ignora — totalMaterias fica 0
      }

      ordemDoDia = {
        sessao_id: sessao.id,
        numero: sessao.numero ?? '',
        data: sessao.data_sessao ?? '',
        total_materias: totalMaterias,
      };
    }

    // ── 3. Pendencias ────────────────────────────────────────────────────────
    type PendenciaRow = {
      id: string;
      workflow_status: string;
      created_at: string;
      updated_at: string;
    };

    const pendentes: PendenciaRow[] =
      pendenciasResult.status === 'fulfilled'
        ? (pendenciasResult.value.data ?? [])
        : [];

    let emRascunho = 0;
    let aguardandoAssinatura = 0;
    let criticos = 0;
    let maisAntigoDias = 0;

    for (const p of pendentes) {
      // Conta por status
      if (p.workflow_status === 'rascunho') {
        emRascunho++;
      } else if (p.workflow_status.startsWith('aguardando_')) {
        aguardandoAssinatura++;
      }
      // rejeitado entra no total mas não num bucket específico

      // Calcula dias sem ação
      const lastAction = p.updated_at || p.created_at;
      if (lastAction) {
        const dias = Math.floor(
          (now.getTime() - new Date(lastAction).getTime()) / (1000 * 60 * 60 * 24),
        );
        if (dias > 7) criticos++;
        if (dias > maisAntigoDias) maisAntigoDias = dias;
      }
    }

    const semParecer = totalNovas; // matérias novas sem rascunho
    const totalPendencias = pendentes.length + semParecer;

    // ── Response ─────────────────────────────────────────────────────────────
    const response: ParecerAlertas = {
      materias_novas: {
        total: totalNovas,
        por_comissao: porComissao,
        desde: sevenDaysAgo.toISOString().slice(0, 10),
      },
      ordem_do_dia: ordemDoDia,
      pendencias: {
        total: totalPendencias,
        em_rascunho: emRascunho,
        aguardando_assinatura: aguardandoAssinatura,
        sem_parecer: semParecer,
        criticos,
        mais_antigo_dias: maisAntigoDias,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/pareceres/alertas]', error);
    return NextResponse.json(
      { error: 'Falha ao calcular alertas de pareceres' },
      { status: 500 },
    );
  }
}
