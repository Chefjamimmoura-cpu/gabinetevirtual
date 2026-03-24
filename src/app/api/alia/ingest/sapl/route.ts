// POST /api/alia/ingest/sapl
// Indexa: matérias legislativas ativas + comissões + membros do SAPL Boa Vista.
// Validade de 365 dias para matérias (re-ingestar periodicamente).

import { NextRequest, NextResponse } from 'next/server';
import { upsertKnowledge, type KnowledgeChunk } from '@/lib/alia/rag';

const GABINETE_ID = process.env.GABINETE_ID!;
const SAPL_BASE   = 'https://sapl.boavista.rr.leg.br/api';
const SAPL_URL    = 'https://sapl.boavista.rr.leg.br';

const UM_ANO = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  .toISOString().slice(0, 10);

export async function POST(req: NextRequest) {
  const auth   = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const chunks: KnowledgeChunk[] = [];
  const erros: string[] = [];

  // ── 1. Matérias ativas ────────────────────────────────────────────────────
  try {
    // Busca páginas até esgotar (max 500 matérias para não travar)
    let url: string | null = `${SAPL_BASE}/materia/materialegislativa/?page_size=100`;
    let fetched = 0;
    while (url && fetched < 500) {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) break;
      const data = await res.json() as {
        next?: string | null;
        results?: Array<Record<string, unknown>>;
      };
      for (const m of data.results ?? []) {
        const sigla  = String(m.tipo_display ?? m.tipo ?? '');
        const numero = String(m.numero ?? '');
        const ano    = String(m.ano ?? '');
        const ementa = String(m.ementa ?? '').slice(0, 500);

        const partes = [
          `MATÉRIA: ${sigla} ${numero}/${ano}`,
          ementa           ? `EMENTA: ${ementa}` : '',
          m.indexacao      ? `INDEXAÇÃO: ${m.indexacao}` : '',
          m.regime_tramitacao_display
            ? `REGIME: ${m.regime_tramitacao_display}` : '',
          `URL: ${SAPL_URL}/materia/${m.id}`,
        ].filter(Boolean);

        chunks.push({
          dominio:    'sapl',
          source_ref: `materia:${sigla}:${numero}/${ano}`,
          chunk_text: partes.join('\n'),
          metadata:   {
            materia_id: m.id,
            tipo: m.tipo,
            numero: m.numero,
            ano: m.ano,
          },
          validade_em: UM_ANO,
        });
        fetched++;
      }
      url = data.next ?? null;
    }
  } catch (e) {
    erros.push(`matérias: ${String(e)}`);
  }

  // ── 2. Comissões ──────────────────────────────────────────────────────────
  try {
    const res = await fetch(`${SAPL_BASE}/comissoes/comissao/?page_size=50`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json() as {
        results?: Array<Record<string, unknown>>;
      };

      for (const c of data.results ?? []) {
        // Busca membros de cada comissão
        let membrosStr = '';
        try {
          const mr = await fetch(
            `${SAPL_BASE}/comissoes/composicaocomissao/?comissao=${c.id}&page_size=30`,
            { signal: AbortSignal.timeout(8000) },
          );
          if (mr.ok) {
            const md = await mr.json() as {
              results?: Array<Record<string, unknown>>;
            };
            membrosStr = (md.results ?? [])
              .map(m =>
                `${m.cargo_display ?? m.cargo}: ${m.parlamentar_nome ?? m.parlamentar}`
              )
              .join('; ');
          }
        } catch { /* silent — membro opcional */ }

        const partes = [
          `COMISSÃO: ${c.nome}`,
          c.sigla       ? `SIGLA: ${c.sigla}` : '',
          c.tipo_display? `TIPO: ${c.tipo_display}` : '',
          c.descricao   ? `DESCRIÇÃO: ${c.descricao}` : '',
          membrosStr    ? `MEMBROS: ${membrosStr}` : '',
          `URL: ${SAPL_URL}/comissoes/${c.id}`,
        ].filter(Boolean);

        chunks.push({
          dominio:    'sapl',
          source_ref: `comissao:${c.sigla ?? c.id}`,
          chunk_text: partes.join('\n'),
          metadata:   { comissao_id: c.id, sigla: c.sigla },
        });
      }
    }
  } catch (e) {
    erros.push(`comissões: ${String(e)}`);
  }

  // ── 3. Vereadores (parlamentares ativos) ─────────────────────────────────
  try {
    const res = await fetch(
      `${SAPL_BASE}/parlamentar/parlamentar/?ativo=True&page_size=50`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (res.ok) {
      const data = await res.json() as {
        results?: Array<Record<string, unknown>>;
      };
      for (const p of data.results ?? []) {
        chunks.push({
          dominio:    'sapl',
          source_ref: `parlamentar:${p.id}`,
          chunk_text: [
            `VEREADOR(A): ${p.nome_completo ?? p.nome_parlamentar}`,
            p.nome_parlamentar ? `Nome Parlamentar: ${p.nome_parlamentar}` : '',
            p.partido_sigla    ? `Partido: ${p.partido_sigla}` : '',
            p.email            ? `Email: ${p.email}` : '',
            `URL: ${SAPL_URL}/parlamentar/${p.id}`,
          ].filter(Boolean).join('\n'),
          metadata: { parlamentar_id: p.id, ativo: true },
        });
      }
    }
  } catch (e) {
    erros.push(`parlamentares: ${String(e)}`);
  }

  const result = await upsertKnowledge(chunks, GABINETE_ID);
  return NextResponse.json({
    total_chunks: chunks.length,
    erros: erros.length > 0 ? erros : undefined,
    ...result,
  });
}
