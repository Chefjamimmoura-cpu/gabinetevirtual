// src/lib/alia/proactive/watchers/aniversario-watcher.ts
// Detecta aniversários de contatos do CADIN nos próximos 3 dias.

import { createClient } from '@supabase/supabase-js';
import type { Watcher, ProactiveEvent } from '../watcher.interface';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export const aniversarioWatcher: Watcher = {
  name: 'aniversario',
  schedule: '0 6 * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const today = new Date();
      const targets: { monthDay: string; label: string; daysAhead: number }[] = [];

      for (let d = 0; d <= 3; d++) {
        const date = new Date(today);
        date.setDate(today.getDate() + d);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        targets.push({ monthDay: `${mm}-${dd}`, label: d === 0 ? 'hoje' : `em ${d} dia(s)`, daysAhead: d });
      }

      const supabase = db();

      for (const target of targets) {
        const { data, error } = await supabase
          .from('cadin_persons')
          .select('id, nome, cargo, orgao, data_nascimento')
          .eq('gabinete_id', gabineteId)
          .filter('data_nascimento', 'like', `%-${target.monthDay}`);

        if (error || !data) continue;

        for (const person of data) {
          events.push({
            id: crypto.randomUUID(),
            type: 'aniversario',
            urgency: 'media',
            title: `Aniversário ${target.label}: ${person.nome}`,
            detail: `${person.nome}${person.cargo ? ` — ${person.cargo}` : ''}${person.orgao ? ` (${person.orgao})` : ''} faz aniversário ${target.label}.`,
            module: 'cadin',
            related_entities: { person_ids: [person.id] },
            action_url: `/cadin/pessoas/${person.id}`,
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
