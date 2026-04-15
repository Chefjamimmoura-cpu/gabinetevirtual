// GET /api/pareceres/minhas-comissoes
// ──────────────────────────────────────────────────────────────
// Retorna apenas as comissões onde o vereador do gabinete é membro ativo.
// Cruza as tabelas comissoes + comissao_membros + gabinetes.comissoes_config
// para retornar dados completos (sigla, keywords, area, etc.) + cargo do vereador.
//
// Se as tabelas estiverem vazias, dispara o sync automaticamente antes de retornar.
//
// Response: { comissoes: CommissionWithRole[], source }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { COMISSOES_CMBV } from '@/lib/parecer/prompts-relator';

const GABINETE_ID = process.env.GABINETE_ID!;

interface CommissionWithRole {
  sigla: string;
  nome: string;
  area: string;
  criterios: string;
  keywords: string[];
  sapl_unit_id: number | null;
  artigoRegimento?: string;
  link_lei?: string;
  meu_cargo: string; // presidente, vice-presidente, membro
  comissao_uuid: string; // UUID interno
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Mapa SAPL sigla → comissão config (do gabinetes.comissoes_config ou fallback estático) */
function buildConfigMap(config: Record<string, unknown>[] | null): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!config || !Array.isArray(config)) return map;
  for (const c of config) {
    const sigla = (c.sigla as string) || '';
    if (sigla) map.set(sigla.toUpperCase(), c);
  }
  return map;
}

/** Tenta encontrar a sigla da comissão no config por match com nome do SAPL */
function findSiglaByName(name: string, configMap: Map<string, Record<string, unknown>>): string | null {
  const nameLower = name.toLowerCase();
  for (const [sigla, cfg] of configMap.entries()) {
    const cfgNome = ((cfg.nome as string) || '').toLowerCase();
    if (cfgNome && (nameLower.includes(cfgNome.substring(0, 20)) || cfgNome.includes(nameLower.substring(0, 20)))) {
      return sigla;
    }
  }
  return null;
}

/** Fallback estático para usar quando o config map não tem uma sigla */
function getStaticConfig(sigla: string): { area: string; criterios: string; keywords: string[]; sapl_unit_id: number | null } {
  const found = COMISSOES_CMBV.find(c => c.sigla.toUpperCase() === sigla.toUpperCase());
  return {
    area: found?.areaExpertise || found?.area || '',
    criterios: found?.criteriosAnalise || found?.criterios || '',
    keywords: found?.saplKeywords || found?.keywords || [],
    sapl_unit_id: found?.sapl_unit_id ?? null,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const db = supabase();

  try {
    // 1. Busca profile do admin do gabinete
    const { data: profiles } = await db
      .from('profiles')
      .select('id')
      .eq('gabinete_id', GABINETE_ID)
      .in('role', ['admin', 'vereador']);

    const adminProfileId = profiles?.[0]?.id;
    if (!adminProfileId) {
      return NextResponse.json({ comissoes: [], source: 'no_profile' });
    }

    // 2. Busca comissões onde o vereador é membro ativo
    const { data: memberships } = await db
      .from('comissao_membros')
      .select('comissao_id, cargo')
      .eq('profile_id', adminProfileId)
      .eq('ativo', true);

    // 3. Se não encontrou memberships, dispara sync automático
    if (!memberships || memberships.length === 0) {
      // Tenta sync automático
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
        const syncRes = await fetch(`${baseUrl}/api/comissoes/sync-membros`, { method: 'POST' });
        if (syncRes.ok) {
          // Retry após sync
          const { data: retryMemberships } = await db
            .from('comissao_membros')
            .select('comissao_id, cargo')
            .eq('profile_id', adminProfileId)
            .eq('ativo', true);

          if (!retryMemberships || retryMemberships.length === 0) {
            // Sync OK mas vereador não é membro de nenhuma comissão
            // Fallback: retorna todas as comissões com cargo 'acesso_geral' para não bloquear
            return returnAllCommissions(db);
          }
          return buildResponse(db, retryMemberships);
        }
      } catch {
        // Sync falhou — usa fallback
      }
      return returnAllCommissions(db);
    }

    return buildResponse(db, memberships);
  } catch (err) {
    console.error('[GET /api/pareceres/minhas-comissoes]', err);
    // Em caso de erro, retorna todas as comissões (fallback seguro)
    return returnAllCommissions(supabase());
  }
}

async function buildResponse(
  db: ReturnType<typeof supabase>,
  memberships: Array<{ comissao_id: string; cargo: string }>,
) {
  const comissaoIds = memberships.map(m => m.comissao_id);
  const cargoMap = new Map(memberships.map(m => [m.comissao_id, m.cargo]));

  // Busca dados das comissões
  const { data: comissoes } = await db
    .from('comissoes')
    .select('id, name, sapl_id')
    .in('id', comissaoIds);

  // Busca config do gabinete para enriquecer com keywords/area
  const { data: gabData } = await db
    .from('gabinetes')
    .select('comissoes_config')
    .eq('id', GABINETE_ID)
    .single();

  const configMap = buildConfigMap(gabData?.comissoes_config as Record<string, unknown>[] | null);

  // Monta resposta
  const result: CommissionWithRole[] = (comissoes || []).map(c => {
    const cargo = cargoMap.get(c.id) || 'membro';
    const saplId = c.sapl_id;

    // Tenta encontrar config pelo sapl_id ou nome
    let configData: Record<string, unknown> | undefined;
    let sigla = '';

    // Busca por sapl_unit_id no configMap
    for (const [s, cfg] of configMap.entries()) {
      if (cfg.sapl_unit_id === saplId) {
        configData = cfg;
        sigla = s;
        break;
      }
    }

    // Fallback: busca por nome
    if (!configData) {
      const foundSigla = findSiglaByName(c.name, configMap);
      if (foundSigla) {
        configData = configMap.get(foundSigla.toUpperCase());
        sigla = foundSigla;
      }
    }

    // Fallback: busca na lista estática
    if (!sigla) {
      const staticMatch = COMISSOES_CMBV.find(sc =>
        sc.sapl_unit_id === saplId ||
        c.name.toLowerCase().includes(sc.nome.toLowerCase().substring(0, 15)),
      );
      if (staticMatch) sigla = staticMatch.sigla;
    }

    const staticCfg = sigla ? getStaticConfig(sigla) : { area: '', criterios: '', keywords: [], sapl_unit_id: saplId };

    return {
      sigla: sigla || `COM_${saplId || 'UNK'}`,
      nome: c.name,
      area: (configData?.area as string) || staticCfg.area,
      criterios: (configData?.criterios as string) || staticCfg.criterios,
      keywords: (configData?.keywords as string[]) || staticCfg.keywords,
      // Prioriza sapl_unit_id da config estática (unidade de tramitação real, ex: CASP=93)
      // O saplId da tabela comissoes é o id da comissão (ex: 12), não a unidade de tramitação
      sapl_unit_id: staticCfg.sapl_unit_id ?? saplId,
      artigoRegimento: (configData?.artigoRegimento as string) || undefined,
      link_lei: (configData?.link_lei as string) || undefined,
      meu_cargo: cargo,
      comissao_uuid: c.id,
    };
  });

  // Ordena: presidente primeiro, depois vice, depois membro
  const cargoOrder: Record<string, number> = { presidente: 0, 'vice-presidente': 1, secretario: 2, membro: 3 };
  result.sort((a, b) => (cargoOrder[a.meu_cargo] ?? 9) - (cargoOrder[b.meu_cargo] ?? 9));

  return NextResponse.json({ comissoes: result, source: 'membership' });
}

/** Fallback: retorna todas as comissões da configuração do gabinete */
async function returnAllCommissions(db: ReturnType<typeof supabase>) {
  try {
    const { data } = await db
      .from('gabinetes')
      .select('comissoes_config')
      .eq('id', GABINETE_ID)
      .single();

    const config = data?.comissoes_config as Record<string, unknown>[] | null;
    if (config && Array.isArray(config) && config.length > 0) {
      const result = config.map(c => ({
        ...c,
        meu_cargo: 'acesso_geral',
        comissao_uuid: null,
      }));
      return NextResponse.json({ comissoes: result, source: 'fallback_config' });
    }
  } catch {
    // silencioso
  }

  // Fallback final: lista estática
  const result = COMISSOES_CMBV.map(c => ({
    sigla: c.sigla,
    nome: c.nome,
    area: c.areaExpertise || c.area || '',
    criterios: c.criteriosAnalise || c.criterios || '',
    keywords: c.saplKeywords || c.keywords || [],
    sapl_unit_id: c.sapl_unit_id ?? null,
    artigoRegimento: c.artigoRegimento,
    link_lei: c.link_lei,
    meu_cargo: 'acesso_geral',
    comissao_uuid: null,
  }));
  return NextResponse.json({ comissoes: result, source: 'static_fallback' });
}
