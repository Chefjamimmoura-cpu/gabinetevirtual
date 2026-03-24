// POST /api/comissoes/sync-membros
// ──────────────────────────────────────────────────────────────
// Sincroniza composição de comissões do SAPL → Supabase.
//
// Fluxo:
//   1. Busca comissões ativas do SAPL: /api/comissoes/comissao/?ativa=True
//   2. Para cada comissão, busca composição mais recente + membros ativos
//   3. Upsert na tabela `comissoes` (match por sapl_id)
//   4. Upsert na tabela `comissao_membros` (vincula ao profile do vereador)
//   5. Identifica membership do vereador do gabinete (fuzzy name match)
//
// Response: { synced_commissions, vereador_memberships, total_members }
// ──────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';
const GABINETE_ID = process.env.GABINETE_ID!;
const TIMEOUT_MS = 12000;

const CARGO_MAP: Record<number, string> = {
  1: 'presidente',
  2: 'vice-presidente',
  3: 'secretario',
  4: 'membro',
  5: 'suplente',
};

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Normaliza nome para comparação fuzzy: lowercase, remove acentos */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function saplFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, SAPL_BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json', 'User-Agent': 'CMBV-Gabinete/2.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`SAPL HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface SaplComissao {
  id: number;
  nome: string;
  sigla: string;
  ativa: boolean;
  tipo: number;
}

interface SaplComposicao {
  id: number;
  comissao: number;
  periodo: number;
  __str__: string;
}

interface SaplParticipacao {
  id: number;
  __str__: string;
  titular: boolean;
  data_designacao: string;
  data_desligamento: string | null;
  composicao: number;
  parlamentar: number;
  cargo: number;
}

export async function POST() {
  const db = supabase();

  // 1. Busca nome do vereador do gabinete para match
  const { data: gabinete } = await db
    .from('gabinetes')
    .select('vereador_name')
    .eq('id', GABINETE_ID)
    .single();

  const vereadorName = gabinete?.vereador_name || '';
  const vereadorNorm = normalizeName(vereadorName);

  // 2. Busca profile do admin do gabinete (para vincular como membro)
  const { data: profiles } = await db
    .from('profiles')
    .select('id, full_name, role')
    .eq('gabinete_id', GABINETE_ID)
    .in('role', ['admin', 'vereador']);

  const adminProfileId = profiles?.[0]?.id || null;

  // 3. Busca comissões ativas do SAPL
  let saplComissoes: SaplComissao[];
  try {
    const data = await saplFetch<{ results: SaplComissao[] }>(
      '/api/comissoes/comissao/',
      { page_size: '50' },
    );
    // Filtra apenas comissões ativas e permanentes (tipo 1)
    saplComissoes = (data.results || []).filter(c => c.ativa);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao buscar comissões do SAPL';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const syncedCommissions: Array<{ sigla: string; nome: string; membros: number; vereador_cargo: string | null }> = [];
  const errors: string[] = [];

  for (const comissao of saplComissoes) {
    try {
      // 4. Upsert comissão no Supabase
      const { data: existingComissao } = await db
        .from('comissoes')
        .select('id')
        .eq('gabinete_id', GABINETE_ID)
        .eq('sapl_id', comissao.id)
        .maybeSingle();

      let comissaoUuid: string;

      if (existingComissao) {
        comissaoUuid = existingComissao.id;
        await db
          .from('comissoes')
          .update({ name: comissao.nome })
          .eq('id', comissaoUuid);
      } else {
        const tipo = comissao.tipo === 1 ? 'permanente' : comissao.tipo === 2 ? 'cpi' : 'especial';
        const { data: inserted } = await db
          .from('comissoes')
          .insert({
            gabinete_id: GABINETE_ID,
            name: comissao.nome,
            sapl_id: comissao.id,
            tipo,
          })
          .select('id')
          .single();

        if (!inserted) {
          errors.push(`Falha ao inserir comissão ${comissao.sigla}`);
          continue;
        }
        comissaoUuid = inserted.id;
      }

      // 5. Busca composição mais recente
      const compData = await saplFetch<{ results: SaplComposicao[] }>(
        '/api/comissoes/composicao/',
        { comissao: String(comissao.id), page_size: '5' },
      );
      const composicoes = compData.results || [];
      if (composicoes.length === 0) {
        syncedCommissions.push({ sigla: comissao.sigla, nome: comissao.nome, membros: 0, vereador_cargo: null });
        continue;
      }

      // A composição mais recente é a de maior id (mais recente)
      const latestComp = composicoes.sort((a, b) => b.id - a.id)[0];

      // 6. Busca membros ativos da composição
      const partData = await saplFetch<{ results: SaplParticipacao[] }>(
        '/api/comissoes/participacao/',
        { composicao: String(latestComp.id), page_size: '30' },
      );

      const membrosAtivos = (partData.results || []).filter(p => !p.data_desligamento);

      // 7. Remove membros antigos desta comissão e insere novos
      await db
        .from('comissao_membros')
        .delete()
        .eq('comissao_id', comissaoUuid);

      let vereadorCargo: string | null = null;

      for (const membro of membrosAtivos) {
        // Extrai nome: "__str__": "Presidente : Carol Dantas"
        const parts = (membro.__str__ || '').split(' : ');
        const nomeMembro = parts.length >= 2 ? parts[parts.length - 1].trim() : membro.__str__ || '';
        const cargo = CARGO_MAP[membro.cargo] || 'membro';

        // Verifica se é o vereador do gabinete
        const membroNorm = normalizeName(nomeMembro);
        const isVereador = vereadorNorm && (
          membroNorm.includes(vereadorNorm) || vereadorNorm.includes(membroNorm)
        );

        if (isVereador && adminProfileId) {
          vereadorCargo = cargo;
          // Vincula ao profile do admin
          await db
            .from('comissao_membros')
            .insert({
              comissao_id: comissaoUuid,
              profile_id: adminProfileId,
              cargo,
              ativo: true,
            });

          // Atualiza presidente_id se for presidente
          if (cargo === 'presidente') {
            await db
              .from('comissoes')
              .update({ presidente_id: adminProfileId })
              .eq('id', comissaoUuid);
          }
        }
        // Nota: outros membros não têm profile no sistema, então não inserimos
        // Apenas o vereador do gabinete é vinculado para controle de acesso
      }

      syncedCommissions.push({
        sigla: comissao.sigla,
        nome: comissao.nome,
        membros: membrosAtivos.length,
        vereador_cargo: vereadorCargo,
      });

      // Rate limit: pequena pausa entre comissões
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      errors.push(`${comissao.sigla}: ${msg}`);
    }
  }

  const vereadorMemberships = syncedCommissions.filter(c => c.vereador_cargo !== null);

  return NextResponse.json({
    ok: true,
    synced_commissions: syncedCommissions.length,
    vereador_memberships: vereadorMemberships.map(c => ({
      sigla: c.sigla,
      nome: c.nome,
      cargo: c.vereador_cargo,
    })),
    total_members_synced: syncedCommissions.reduce((acc, c) => acc + c.membros, 0),
    details: syncedCommissions,
    errors: errors.length > 0 ? errors : undefined,
  });
}
