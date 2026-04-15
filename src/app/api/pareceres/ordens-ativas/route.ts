// GET /api/pareceres/ordens-ativas
// Retorna sessões plenárias com upload_pauta publicado (= pauta/ordem do dia disponível).
//
// NOTA: A pauta pode ser publicada dias antes da sessão (ex: pauta de terça publicada
// na sexta anterior). O critério único e correto é: upload_pauta != null.
// NÃO usamos tramitações como fallback — elas identificam o que FOI votado,
// não o que ESTÁ na pauta futura.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { fetchRecentSessions, type SaplSessao } from '@/lib/sapl/client';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().slice(0, 10);
    const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1. Sessões com pauta publicada (upload_pauta != null) — últimas 10
    const { data: comPauta, error: err1 } = await supabase
      .from('sapl_sessoes_cache')
      .select('*')
      .not('upload_pauta', 'is', null)
      .order('data_sessao', { ascending: false })
      .limit(10);

    // 2. Sessões FUTURAS (próximos 7 dias) mesmo sem pauta — para avisar que a sessão existe
    const { data: futuras, error: err2 } = await supabase
      .from('sapl_sessoes_cache')
      .select('*')
      .gte('data_sessao', today)
      .lte('data_sessao', in7days)
      .is('upload_pauta', null)
      .order('data_sessao', { ascending: true });

    if ((!err1 && comPauta && comPauta.length > 0) || (!err2 && futuras && futuras.length > 0)) {
      // Junta futuras + com pauta, sem duplicatas, ordenado por data desc
      const all = [...(futuras || []), ...(comPauta || [])];
      const seen = new Set<number>();
      const deduped = all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
      deduped.sort((a, b) => (b.data_sessao || '').localeCompare(a.data_sessao || ''));

      const ordensAtivas: SaplSessao[] = deduped.slice(0, 10).map((c) => ({
        id: c.id,
        data_inicio: c.data_sessao,
        hora_inicio: c.hora_inicio,
        numero: c.numero,
        upload_pauta: c.upload_pauta,
        upload_ata: c.upload_ata,
        __str__: c.str_repr || `Sessão Plenária ${c.numero || ''} (${c.data_sessao})`
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

    // Inclui sessões com pauta E sessões futuras sem pauta
    const ordensAtivas: SaplSessao[] = sessoes
      .filter(s => s.upload_pauta || (s.data_inicio && s.data_inicio >= today && s.data_inicio <= in7days))
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
