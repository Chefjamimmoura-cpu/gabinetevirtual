// POST /api/pls/sincronizar-sapl
// Sprint 5 — Sincronização SAPL REST → banco local pl_proposicoes
//
// Fluxo:
//  1. Busca PLs internos com status TRAMITANDO, COMISSAO (têm numero_sapl)
//  2. Para cada PL: consulta /api/materia/tramitacao/?materia=<sapl_id>
//  3. Compara a tramitação mais recente com o histórico local
//  4. Se houver novidade: insere em pl_historico_tramitacao e atualiza status
//  5. Se status mudou: dispara notificação WhatsApp (via Evolution API)
//
// Este endpoint é chamado pelo cron job (SYNC_SECRET obrigatório no header)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  fetchTramitacoes,
  fetchMateria,
  SAPL_BASE,
  type SaplMateria,
} from '@/lib/sapl/client';

// Mapeamento de status SAPL → status interno
const SAPL_STATUS_MAP: Record<string, string> = {
  'Aprovado': 'APROVADO',
  'Aprovada': 'APROVADO',
  'Arquivada': 'ARQUIVADO',
  'Arquivado': 'ARQUIVADO',
  'Em Comissão': 'COMISSAO',
  'Na Comissão': 'COMISSAO',
  'Tramitando': 'TRAMITANDO',
  'Devolvida': 'ARCHIVADO',
};

function mapStatusSapl(descricao: string): string {
  for (const [key, val] of Object.entries(SAPL_STATUS_MAP)) {
    if (descricao.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return 'TRAMITANDO';
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function notificarWhatsApp(
  mensagem: string,
  telefone?: string,
): Promise<void> {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gabinete-carol';
  const dest = telefone || process.env.GABINETE_NOTIF_TELEFONE;

  if (!url || !key || !dest) return;

  try {
    await fetch(`${url}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ number: dest, text: mensagem, delay: 500 }),
    });
  } catch (err) {
    console.warn('[sincronizar-sapl] WhatsApp notification failed:', err);
  }
}

export async function POST(request: NextRequest) {
  // Autenticação do cron job
  const secret = request.headers.get('x-sync-secret');
  if (!secret || secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const supabase = getServiceClient();
  const iniciou = Date.now();
  const resultados: Array<{ pl_id: string; numero_sapl: string; status_anterior: string; status_novo: string; mudou: boolean }> = [];
  const erros: Array<{ pl_id: string; erro: string }> = [];

  try {
    // Busca PLs ativos com numero SAPL ou sapl_id conhecidos
    const { data: plsAtivos, error } = await supabase
      .from('pl_proposicoes')
      .select('id, numero_sapl, sapl_id, status, ementa, gabinete_id, notificado_em')
      .in('status', ['TRAMITANDO', 'COMISSAO'])
      .not('sapl_id', 'is', null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!plsAtivos || plsAtivos.length === 0) {
      return NextResponse.json({
        ok: true,
        sincronizados: 0,
        mensagem: 'Nenhum PL ativo com sapl_id para sincronizar.',
        tempo_ms: Date.now() - iniciou,
      });
    }

    // Processa cada PL (sequencial para respeitar rate limiting do SAPL)
    for (const pl of plsAtivos) {
      try {
        const materiaId = pl.sapl_id as number;

        // Busca tramitações do SAPL
        const tramitacoes = await fetchTramitacoes(materiaId);
        const tramitacoesOrdenadas = (tramitacoes.results || []).sort(
          (a, b) => (b.data_tramitacao || '').localeCompare(a.data_tramitacao || '')
        );

        if (tramitacoesOrdenadas.length === 0) continue;

        const ultimaTramit = tramitacoesOrdenadas[0];
        const statusDesc = typeof ultimaTramit.status === 'object'
          ? (ultimaTramit.status?.descricao || ultimaTramit.status?.sigla || 'Tramitando')
          : String(ultimaTramit.status || 'Tramitando');

        const novoStatus = mapStatusSapl(statusDesc);
        const dataEvento = ultimaTramit.data_tramitacao || new Date().toISOString().split('T')[0];

        // Verifica se já existe esta tramitação no histórico local
        const { data: existe } = await supabase
          .from('pl_historico_tramitacao')
          .select('id')
          .eq('pl_id', pl.id)
          .eq('data_evento', dataEvento)
          .eq('fonte', 'sapl')
          .eq('status_novo', statusDesc)
          .limit(1)
          .single();

        const mudouStatus = novoStatus !== pl.status;
        const novidadeHistorico = !existe;

        if (novidadeHistorico) {
          // Insere nova entrada no histórico
          await supabase.from('pl_historico_tramitacao').insert({
            pl_id: pl.id,
            gabinete_id: pl.gabinete_id,
            data_evento: dataEvento,
            status_novo: statusDesc,
            descricao: ultimaTramit.texto || `Tramitação via SAPL: ${statusDesc}`,
            fonte: 'sapl',
            visualizado: false,
          });

          // Atualiza status do PL se mudou
          if (mudouStatus) {
            await supabase
              .from('pl_proposicoes')
              .update({
                status: novoStatus,
                notificado_em: new Date().toISOString(),
              })
              .eq('id', pl.id);

            // Notifica via WhatsApp
            const mensagem =
              `📋 *Atualização de PL — ${pl.numero_sapl || `SAPL #${materiaId}`}*\n\n` +
              `Ementa: ${(pl.ementa || '').substring(0, 120)}...\n` +
              `Status: *${statusDesc}*\n` +
              `Data: ${new Date(dataEvento).toLocaleDateString('pt-BR')}\n\n` +
              `Ver detalhes em: ${SAPL_BASE}/materia/${materiaId}/\n\n` +
              `_ALIA — Gabinete Carol Dantas_`;

            await notificarWhatsApp(mensagem);
          }
        }

        resultados.push({
          pl_id: pl.id,
          numero_sapl: pl.numero_sapl || String(materiaId),
          status_anterior: pl.status,
          status_novo: novoStatus,
          mudou: mudouStatus && novidadeHistorico,
        });

        // Pausa entre requisições para respeitar rate limiting
        await new Promise(r => setTimeout(r, 500));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro desconhecido';
        console.error(`[sincronizar-sapl] Erro no PL ${pl.id}:`, msg);
        erros.push({ pl_id: pl.id, erro: msg });
      }
    }

    // Atualiza timestamp da última sincronização na config do gabinete
    try {
      const gabineteId = process.env.GABINETE_ID;
      if (gabineteId) {
        await supabase
          .from('gabinetes')
          .update({
            config_json: supabase.rpc('jsonb_merge', {
              target: supabase.from('gabinetes').select('config_json').eq('id', gabineteId),
              patch: { sapl_sync_em: new Date().toISOString() },
            }),
          })
          .eq('id', gabineteId);
      }
    } catch {
      // Não bloqueia em caso de falha no timestamp
    }

    return NextResponse.json({
      ok: true,
      sincronizados: resultados.length,
      mudancas: resultados.filter(r => r.mudou).length,
      erros: erros.length,
      detalhes: resultados,
      erros_detalhes: erros.length > 0 ? erros : undefined,
      tempo_ms: Date.now() - iniciou,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[sincronizar-sapl] Fatal error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: endpoint de debug — retorna status da última sincronização (requer SYNC_SECRET)
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-sync-secret');
  if (!secret || secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const supabase = getServiceClient();

  const { data: ultimosHistoricos } = await supabase
    .from('pl_historico_tramitacao')
    .select('pl_id, data_evento, fonte, created_at')
    .eq('fonte', 'sapl')
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    ok: true,
    ultima_sincronizacao: ultimosHistoricos?.[0]?.created_at ?? null,
    ultimas_entradas: ultimosHistoricos ?? [],
  });
}
