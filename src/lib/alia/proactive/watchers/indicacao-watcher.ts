// src/lib/alia/proactive/watchers/indicacao-watcher.ts
// Detecta indicações paradas há mais de 7 dias e indicações prontas para protocolo.

import { createClient } from '@supabase/supabase-js';
import type { Watcher, ProactiveEvent } from '../watcher.interface';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface Indicacao {
  id: string;
  titulo: string;
  created_at: string;
  status: string;
  orgao_destino: string | null;
}

export const indicacaoWatcher: Watcher = {
  name: 'indicacao',
  schedule: '0 */4 * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const supabase = db();

      // Indicações pendentes há mais de 7 dias
      const seteDiasAtras = new Date();
      seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);

      const { data: paradas, error: errorParadas } = await supabase
        .from('indicacoes')
        .select('id, titulo, created_at, status, orgao_destino')
        .eq('gabinete_id', gabineteId)
        .eq('status', 'pendente')
        .lt('created_at', seteDiasAtras.toISOString());

      if (!errorParadas && paradas) {
        for (const ind of paradas as Indicacao[]) {
          const criada = new Date(ind.created_at);
          const diasParada = Math.floor((Date.now() - criada.getTime()) / (1000 * 60 * 60 * 24));
          events.push({
            id: crypto.randomUUID(),
            type: 'indicacao_parada',
            urgency: 'media',
            title: `Indicação parada há ${diasParada} dias: ${ind.titulo}`,
            detail: `A indicação "${ind.titulo}"${ind.orgao_destino ? ` (destino: ${ind.orgao_destino})` : ''} está com status pendente há ${diasParada} dias sem movimentação.`,
            module: 'indicacoes',
            related_entities: { indicacao_ids: [ind.id] },
            action_url: `/indicacoes/${ind.id}`,
            detected_at: new Date().toISOString(),
          });
        }
      }

      // Indicações prontas para protocolo
      const { data: prontas, error: errorProntas } = await supabase
        .from('indicacoes')
        .select('id, titulo, created_at, status, orgao_destino')
        .eq('gabinete_id', gabineteId)
        .eq('status', 'pronta_protocolo');

      if (!errorProntas && prontas) {
        for (const ind of prontas as Indicacao[]) {
          events.push({
            id: crypto.randomUUID(),
            type: 'indicacao_protocolar',
            urgency: 'alta',
            title: `Indicação pronta para protocolo: ${ind.titulo}`,
            detail: `A indicação "${ind.titulo}"${ind.orgao_destino ? ` para ${ind.orgao_destino}` : ''} está pronta e aguarda protocolo.`,
            module: 'indicacoes',
            related_entities: { indicacao_ids: [ind.id] },
            action_url: `/indicacoes/${ind.id}`,
            detected_at: new Date().toISOString(),
          });
        }
      }
    } catch {
      // watcher nunca deve lançar erro
    }

    return events;
  },
};
