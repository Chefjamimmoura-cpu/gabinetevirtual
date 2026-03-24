// GET /api/pareceres/ordens-ativas
// Retorna sessões plenárias com upload_pauta publicado (= pauta/ordem do dia disponível).
//
// NOTA: A pauta pode ser publicada dias antes da sessão (ex: pauta de terça publicada
// na sexta anterior). O critério único e correto é: upload_pauta != null.
// NÃO usamos tramitações como fallback — elas identificam o que FOI votado,
// não o que ESTÁ na pauta futura.

import { NextResponse } from 'next/server';
import { fetchRecentSessions, type SaplSessao } from '@/lib/sapl/client';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Tentar puxar do Cache (Fase 1 V3)
    const { data: cached, error } = await supabase
      .from('sapl_sessoes_cache')
      .select('*')
      .not('upload_pauta', 'is', null) // Sessoes que tem pauta publicada
      .order('data_sessao', { ascending: false })
      .limit(10);

    if (!error && cached && cached.length > 0) {
      // Mapear cache database back to SAPL interface expectatives
      const ordensAtivas: SaplSessao[] = cached.map((c) => ({
        id: c.id,
        data_inicio: c.data_sessao,
        hora_inicio: c.hora_inicio,
        numero: c.numero,
        upload_pauta: c.upload_pauta,
        upload_ata: c.upload_ata,
        __str__: `Sessão Plenária ${c.numero || ''} (${c.data_sessao})`
      }));

      return NextResponse.json({
        count: ordensAtivas.length,
        next: null,
        results: ordensAtivas,
        fonte: 'cache'
      });
    }

    // 2. Fallback: Se o cache estiver vazio (Ex: migration rodou mas o cronjob não)
    console.log('[SAPL GET] Cache vazio. Acionando Fallback SAPL Real-time...');
    const sessoesData = await fetchRecentSessions(50);
    const sessoes = sessoesData.results || [];

    const ordensAtivas: SaplSessao[] = sessoes
      .filter(s => s.upload_pauta)
      .slice(0, 10);

    return NextResponse.json({
      count: ordensAtivas.length,
      next: null,
      results: ordensAtivas,
      fonte: 'sapl'
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar ordens ativas';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
