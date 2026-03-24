// GET /api/pareceres/relatoria/materia/[id]
// Retorna o contexto completo de uma matéria para uso na aba Relatoria:
//   - Dados básicos (tipo, número, ementa, autores)
//   - Voto da Procuradoria (extraído das tramitações)
//   - Pareceres de outras comissões já emitidos
//   - Tramitações recentes (últimas 8)
//   - Rascunho já gerado neste gabinete (se existir)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchMateria, enrichMateria } from '@/lib/sapl/client';
import { resolveAuthorName } from '@/lib/parecer/build-context';

const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';
const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Tenta inferir voto a partir do texto da tramitação/parecer */
function inferirVoto(texto: string): string | null {
  const t = texto.toLowerCase();
  if (t.includes('favorável') || t.includes('favoravel') || t.includes('aprovado')) return 'FAVORÁVEL';
  if (t.includes('contrário') || t.includes('contrario') || t.includes('reprovado') || t.includes('desfavorável')) return 'CONTRÁRIO';
  if (t.includes('cautela') || t.includes('prejudicado') || t.includes('retirado')) return 'CAUTELA';
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const materiaId = parseInt(idStr);
  if (isNaN(materiaId) || materiaId <= 0) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  try {
    // 1. Busca e enriquece a matéria no SAPL (live — dados frescos)
    const raw = await fetchMateria(materiaId);
    const materia = await enrichMateria(raw);

    const tipoSigla = materia.tipo_sigla ||
      (typeof materia.tipo === 'object' ? (materia.tipo as { sigla?: string })?.sigla : '') || '';
    const tipoDesc = materia.tipo_descricao ||
      (typeof materia.tipo === 'object' ? (materia.tipo as { descricao?: string })?.descricao : '') || '';
    const autorNome = resolveAuthorName(materia);

    // 2. Procuradoria — última tramitação que mencione procuradoria no __str__
    const tramits = materia._tramits || [];
    const procTramit = [...tramits].reverse().find(t => {
      const txt = (t.__str__ || t.texto || '').toLowerCase();
      return txt.includes('procuradoria') || txt.includes('parecer jurídico') || txt.includes('assessoria jurídica');
    });
    const procuradoria = procTramit
      ? {
          voto: inferirVoto(procTramit.__str__ || procTramit.texto || ''),
          texto: procTramit.__str__ || procTramit.texto || null,
        }
      : { voto: null, texto: null };

    // 3. Pareceres de outras comissões
    const outras_comissoes = (materia._pareceres || []).map(p => {
      const comissaoNome = (
        p.comissao_nome ||
        (typeof p.comissao === 'object' ? p.comissao?.nome : '') ||
        'Comissão'
      ).trim();
      return {
        comissao: comissaoNome,
        voto: p.parecer || p.tipo_resultado_votacao?.nome || 'Não identificado',
      };
    });

    // 4. Tramitações recentes (últimas 8)
    const tramitacoes = tramits
      .slice(-8)
      .reverse()
      .map(t => ({
        data: t.data_tramitacao || '',
        texto: t.__str__ || t.texto || '',
      }));

    // 5. Rascunho já gerado neste gabinete para esta matéria
    const db = supabase();
    const { data: rascunhos } = await db
      .from('pareceres_relator')
      .select('id, commission_sigla, voto, created_at')
      .eq('gabinete_id', GABINETE_ID)
      .eq('materia_id', materiaId)
      .order('created_at', { ascending: false })
      .limit(3);

    return NextResponse.json({
      materia: {
        id: materia.id,
        tipo_sigla: tipoSigla,
        tipo_descricao: tipoDesc,
        numero: materia.numero,
        ano: materia.ano,
        ementa: materia.ementa || '',
        autores: autorNome,
        regime: materia.regime_tramitacao?.descricao || 'Ordinário',
        sapl_url: `${SAPL_BASE}/materia/${materia.id}`,
      },
      procuradoria,
      outras_comissoes,
      tramitacoes,
      rascunhos: rascunhos ?? [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Matéria não encontrada';
    console.error(`[GET /api/pareceres/relatoria/materia/${materiaId}]`, err);
    return NextResponse.json({ error: `Falha ao buscar matéria ${materiaId}: ${msg}` }, { status: 502 });
  }
}
