// GET /api/dashboard/summary
// Agrega em paralelo todos os dados necessários para o dashboard principal.
// Retorna métricas reais de todos os módulos em uma única chamada.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const db = supabase();

  const hoje = new Date();
  const hojeStr = hoje.toISOString().split('T')[0];
  const semanaAtras = new Date(hoje);
  semanaAtras.setDate(semanaAtras.getDate() - 7);

  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');

  const [
    pareceresRes,
    indicacoesPendRes,
    indicacoesWaRes,
    laiaAtivasRes,
    laiaHumanoRes,
    cadinPendRes,
    aniversariantesRes,
    eventosRes,
    sessoesRes,
  ] = await Promise.allSettled([
    // Pareceres gerados esta semana
    db.from('pareceres_historico')
      .select('sessao_str, data_sessao, gerado_em')
      .eq('gabinete_id', GABINETE_ID)
      .gte('gerado_em', semanaAtras.toISOString())
      .order('gerado_em', { ascending: false }),

    // Indicações pendentes de moderação
    db.from('indicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('status', 'pendente'),

    // Indicações recebidas via WhatsApp
    db.from('indicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('fonte', 'whatsapp'),

    // Sessões ALIA ativas
    db.from('laia_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('status', 'ativa'),

    // Sessões ALIA aguardando atendimento humano
    db.from('laia_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('status', 'humano'),

    // Atualizações CADIN pendentes de revisão
    db.from('cadin_pending_updates')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('status', 'pendente'),

    // Aniversariantes de hoje no CADIN
    db.from('cadin_persons')
      .select('full_name, notes, cadin_appointments(title, active)')
      .like('notes', `%Aniversário: ${mes}-${dia}%`),

    // Eventos de hoje na agenda
    db.from('eventos')
      .select('titulo, tipo, data_inicio')
      .eq('gabinete_id', GABINETE_ID)
      .gte('data_inicio', `${hojeStr}T00:00:00`)
      .lte('data_inicio', `${hojeStr}T23:59:59`)
      .order('data_inicio', { ascending: true }),

    // Sessões plenárias com pauta publicada (SAPL cache)
    db.from('sapl_sessoes_cache')
      .select('data_sessao, numero')
      .not('upload_pauta', 'is', null)
      .order('data_sessao', { ascending: false })
      .limit(5),
  ]);

  // Extrai valores com fallback silencioso em caso de erro
  const pareceres = pareceresRes.status === 'fulfilled' ? (pareceresRes.value.data ?? []) : [];
  const indicacoesPend = indicacoesPendRes.status === 'fulfilled' ? (indicacoesPendRes.value.count ?? 0) : 0;
  const indicacoesWa   = indicacoesWaRes.status   === 'fulfilled' ? (indicacoesWaRes.value.count   ?? 0) : 0;
  const laiaAtivas     = laiaAtivasRes.status      === 'fulfilled' ? (laiaAtivasRes.value.count      ?? 0) : 0;
  const laiaHumano     = laiaHumanoRes.status      === 'fulfilled' ? (laiaHumanoRes.value.count      ?? 0) : 0;
  const cadinPend      = cadinPendRes.status        === 'fulfilled' ? (cadinPendRes.value.count        ?? 0) : 0;
  const aniversariantes = aniversariantesRes.status === 'fulfilled' ? (aniversariantesRes.value.data ?? []) : [];
  const eventos         = eventosRes.status          === 'fulfilled' ? (eventosRes.value.data         ?? []) : [];
  const sessoes         = sessoesRes.status           === 'fulfilled' ? (sessoesRes.value.data          ?? []) : [];

  // Formata data da próxima sessão plenária
  let proximaSessao: string | null = null;
  if (sessoes.length > 0) {
    const s = sessoes[0] as { data_sessao: string; numero: number };
    const d = new Date(`${s.data_sessao}T12:00:00`);
    proximaSessao = `Sessão ${s.numero} — ${d.toLocaleDateString('pt-BR')}`;
  }

  return NextResponse.json({
    pareceres: {
      total_semana: pareceres.length,
      ultima_sessao: (pareceres[0] as { sessao_str?: string } | undefined)?.sessao_str ?? null,
      ultima_data:   (pareceres[0] as { data_sessao?: string } | undefined)?.data_sessao ?? null,
    },
    indicacoes: {
      pendentes: indicacoesPend,
      whatsapp:  indicacoesWa,
    },
    laia: {
      sessoes_ativas:    laiaAtivas,
      aguardando_humano: laiaHumano,
    },
    cadin: {
      updates_pendentes: cadinPend,
      aniversariantes_hoje: aniversariantes.slice(0, 5).map((p) => {
        const person = p as { full_name: string; cadin_appointments?: { title: string; active: boolean }[] };
        const appt = person.cadin_appointments?.find((a) => a.active);
        return { nome: person.full_name, cargo: appt?.title ?? null };
      }),
    },
    agenda: {
      eventos_hoje: eventos.map((e) => {
        const ev = e as { titulo: string; tipo: string; data_inicio: string };
        const hora = ev.data_inicio
          ? new Date(ev.data_inicio).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Boa_Vista',
            })
          : null;
        return { titulo: ev.titulo, tipo: ev.tipo, hora };
      }),
    },
    sessoes_sapl: {
      count:   sessoes.length,
      proxima: proximaSessao,
    },
  });
}
