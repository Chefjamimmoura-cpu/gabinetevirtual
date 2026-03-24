// POST /api/agenda/sync-sapl
// Importa sessões plenárias do cache SAPL para a tabela `eventos`.
// Upsert por sapl_sessao_id — não duplica sessões já importadas.
// Retorna { criados, atualizados, total }

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST() {
  const db = supabase();

  // Buscar todas as sessões do cache SAPL (últimos 6 meses + próximos 3 meses)
  const hoje = new Date();
  const inicioJanela = new Date(hoje);
  inicioJanela.setMonth(inicioJanela.getMonth() - 6);
  const fimJanela = new Date(hoje);
  fimJanela.setMonth(fimJanela.getMonth() + 3);

  const { data: sessoes, error: sessErr } = await db
    .from('sapl_sessoes_cache')
    .select('id, tipo_sessao, data_sessao, upload_pauta')
    .eq('gabinete_id', GABINETE_ID)
    .gte('data_sessao', inicioJanela.toISOString().split('T')[0])
    .lte('data_sessao', fimJanela.toISOString().split('T')[0])
    .order('data_sessao', { ascending: true });

  if (sessErr) {
    console.error('[agenda/sync-sapl]', sessErr);
    return NextResponse.json({ error: sessErr.message }, { status: 500 });
  }

  if (!sessoes?.length) {
    return NextResponse.json({ ok: true, criados: 0, atualizados: 0, total: 0, mensagem: 'Nenhuma sessão no cache SAPL.' });
  }

  // Buscar eventos já existentes com sapl_sessao_id para evitar duplicatas
  const { data: existentes } = await db
    .from('eventos')
    .select('id, sapl_sessao_id')
    .eq('gabinete_id', GABINETE_ID)
    .in('sapl_sessao_id', sessoes.map(s => s.id));

  const existentesMap = new Map((existentes ?? []).map(e => [e.sapl_sessao_id, e.id]));

  let criados = 0;
  let atualizados = 0;

  for (const sessao of sessoes) {
    const tipo_label = sessao.tipo_sessao ?? 'Ordinária';
    const titulo = `Sessão ${tipo_label} — CMBV`;
    // Horário padrão das sessões da CMBV: 09:00
    const data_inicio = `${sessao.data_sessao}T09:00:00-04:00`; // BRT = UTC-4

    if (existentesMap.has(sessao.id)) {
      // Atualizar dados (título/data podem mudar se o SAPL foi corrigido)
      await db
        .from('eventos')
        .update({ titulo, data_inicio, tipo: 'sessao_plenaria', cor: '#312e81' })
        .eq('id', existentesMap.get(sessao.id));
      atualizados++;
    } else {
      // Criar novo evento
      const { error: insErr } = await db
        .from('eventos')
        .insert({
          gabinete_id: GABINETE_ID,
          titulo,
          data_inicio,
          tipo: 'sessao_plenaria',
          local: 'Plenário Principal — CMBV',
          cor: '#312e81',
          sapl_sessao_id: sessao.id,
        });

      if (!insErr) criados++;
      else console.warn('[agenda/sync-sapl] insert error:', insErr.message);
    }
  }

  return NextResponse.json({
    ok: true,
    criados,
    atualizados,
    total: sessoes.length,
    mensagem: `${criados} sessões criadas, ${atualizados} atualizadas na agenda.`,
  });
}
