// src/lib/alia/proactive/watchers/comissao-watcher.ts
// Detecta comissões com pareceres atrasados ou em aberto.

import { createClient } from '@supabase/supabase-js';
import type { Watcher, ProactiveEvent } from '../watcher.interface';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface ComissaoPendencia {
  id: string;
  nome: string;
  materia_id: string;
  materia_titulo: string | null;
  materia_numero: string | null;
  prazo_parecer: string | null;
  relator: string | null;
}

export const comissaoWatcher: Watcher = {
  name: 'comissao',
  schedule: '0 */6 * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const supabase = db();
      const agora = new Date().toISOString();

      // Busca pareceres de comissão vencidos ainda não emitidos
      const { data, error } = await supabase
        .from('comissao_pareceres')
        .select(`
          id,
          nome:comissoes(nome),
          materia_id,
          materia_titulo,
          materia_numero,
          prazo_parecer,
          relator
        `)
        .eq('gabinete_id', gabineteId)
        .eq('status', 'pendente')
        .lt('prazo_parecer', agora)
        .order('prazo_parecer', { ascending: true })
        .limit(30);

      if (error || !data) return events;

      for (const row of data as unknown as ComissaoPendencia[]) {
        const prazo = row.prazo_parecer ? new Date(row.prazo_parecer) : null;
        const diasAtraso = prazo
          ? Math.floor((Date.now() - prazo.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        const materiaInfo = row.materia_numero
          ? ` — Matéria ${row.materia_numero}`
          : row.materia_titulo
            ? ` — ${row.materia_titulo}`
            : '';
        const relatorInfo = row.relator ? ` Relator: ${row.relator}.` : '';

        events.push({
          id: crypto.randomUUID(),
          type: 'comissao_pendencia',
          urgency: diasAtraso > 7 ? 'alta' : 'media',
          title: `Parecer atrasado: ${row.nome}${materiaInfo}`,
          detail: `A comissão "${row.nome}" está com parecer em aberto há ${diasAtraso} dia(s) de atraso.${relatorInfo}`,
          module: 'pareceres',
          related_entities: { materia_ids: [row.materia_id] },
          action_url: `/pareceres/comissoes/${row.id}`,
          detected_at: new Date().toISOString(),
        });
      }
    } catch {
      // watcher nunca deve lançar erro
    }

    return events;
  },
};
