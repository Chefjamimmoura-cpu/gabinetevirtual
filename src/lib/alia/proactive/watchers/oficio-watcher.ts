// src/lib/alia/proactive/watchers/oficio-watcher.ts
// Detecta ofícios enviados há mais de 15 dias sem resposta (toda segunda-feira).

import { createClient } from '@supabase/supabase-js';
import type { Watcher, ProactiveEvent } from '../watcher.interface';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface Oficio {
  id: string;
  numero: string | null;
  assunto: string;
  destinatario: string | null;
  enviado_em: string;
}

export const oficioWatcher: Watcher = {
  name: 'oficio',
  schedule: '0 8 * * 1',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const supabase = db();

      const quinzeDiasAtras = new Date();
      quinzeDiasAtras.setDate(quinzeDiasAtras.getDate() - 15);

      const { data, error } = await supabase
        .from('oficios')
        .select('id, numero, assunto, destinatario, enviado_em')
        .eq('gabinete_id', gabineteId)
        .eq('status', 'enviado')
        .is('respondido_em', null)
        .lt('enviado_em', quinzeDiasAtras.toISOString());

      if (error || !data) return events;

      for (const oficio of data as Oficio[]) {
        const enviado = new Date(oficio.enviado_em);
        const diasSemResposta = Math.floor((Date.now() - enviado.getTime()) / (1000 * 60 * 60 * 24));
        const numeroInfo = oficio.numero ? ` nº ${oficio.numero}` : '';
        const destinatarioInfo = oficio.destinatario ? ` para ${oficio.destinatario}` : '';

        events.push({
          id: crypto.randomUUID(),
          type: 'oficio_sem_resposta',
          urgency: 'media',
          title: `Ofício${numeroInfo} sem resposta há ${diasSemResposta} dias`,
          detail: `O ofício${numeroInfo}${destinatarioInfo} sobre "${oficio.assunto}" foi enviado em ${enviado.toLocaleDateString('pt-BR')} e ainda não recebeu resposta.`,
          module: 'oficios',
          action_url: `/oficios/${oficio.id}`,
          detected_at: new Date().toISOString(),
        });
      }
    } catch {
      // watcher nunca deve lançar erro
    }

    return events;
  },
};
