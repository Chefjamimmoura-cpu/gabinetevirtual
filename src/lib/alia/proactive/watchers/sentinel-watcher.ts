// src/lib/alia/proactive/watchers/sentinel-watcher.ts
// Detecta itens do CADIN pendentes de revisão/curadoria humana.

import { createClient } from '@supabase/supabase-js';
import type { Watcher, ProactiveEvent } from '../watcher.interface';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface CadinPendingUpdate {
  id: string;
  person_id: string | null;
  person_nome: string | null;
  tipo_atualizacao: string | null;
  fonte: string | null;
  created_at: string;
  descricao: string | null;
}

export const sentinelWatcher: Watcher = {
  name: 'sentinel',
  schedule: '30 6 * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const supabase = db();

      const { data, error } = await supabase
        .from('cadin_pending_updates')
        .select('id, person_id, person_nome, tipo_atualizacao, fonte, created_at, descricao')
        .eq('gabinete_id', gabineteId)
        .eq('status', 'pendente')
        .order('created_at', { ascending: true })
        .limit(50);

      if (error || !data) return events;

      const total = (data as CadinPendingUpdate[]).length;

      if (total === 0) return events;

      // Emite um evento agregado se houver poucos itens, ou um por item se houver muitos
      if (total <= 5) {
        for (const item of data as CadinPendingUpdate[]) {
          const nomePessoa = item.person_nome || 'pessoa desconhecida';
          const tipo = item.tipo_atualizacao || 'atualização';
          const fonteInfo = item.fonte ? ` (fonte: ${item.fonte})` : '';

          events.push({
            id: crypto.randomUUID(),
            type: 'cadin_curadoria',
            urgency: 'baixa',
            title: `CADIN: revisão pendente — ${tipo} de ${nomePessoa}`,
            detail: `${tipo.charAt(0).toUpperCase() + tipo.slice(1)} para ${nomePessoa}${fonteInfo} aguarda revisão no CADIN.${item.descricao ? ` ${item.descricao}` : ''}`,
            module: 'cadin',
            related_entities: item.person_id ? { person_ids: [item.person_id] } : undefined,
            action_url: item.person_id ? `/cadin/pessoas/${item.person_id}?tab=curadoria` : '/cadin/curadoria',
            detected_at: new Date().toISOString(),
          });
        }
      } else {
        // Evento agregado quando há muitos itens
        events.push({
          id: crypto.randomUUID(),
          type: 'cadin_curadoria',
          urgency: 'media',
          title: `CADIN: ${total} atualizações pendentes de revisão`,
          detail: `Há ${total} atualizações automáticas no CADIN aguardando curadoria humana. Acesse o painel de curadoria para revisar e aprovar os dados.`,
          module: 'cadin',
          action_url: '/cadin/curadoria',
          detected_at: new Date().toISOString(),
        });
      }
    } catch {
      // watcher nunca deve lançar erro
    }

    return events;
  },
};
