// src/lib/alia/proactive/watchers/agenda-watcher.ts
// Detecta eventos agendados para amanhã (D-1) ou nas próximas 2 horas (H-2).

import { createClient } from '@supabase/supabase-js';
import type { Watcher, ProactiveEvent, Urgency } from '../watcher.interface';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface AgendaEvento {
  id: string;
  titulo: string;
  descricao: string | null;
  inicio: string;
  local: string | null;
  tipo: string | null;
}

export const agendaWatcher: Watcher = {
  name: 'agenda',
  schedule: '0 * * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const supabase = db();
      const agora = new Date();

      // Janela H-2: próximas 2 horas
      const em2h = new Date(agora.getTime() + 2 * 60 * 60 * 1000);

      // Janela D-1: amanhã (00:00 → 23:59)
      const amanha = new Date(agora);
      amanha.setDate(agora.getDate() + 1);
      amanha.setHours(0, 0, 0, 0);
      const amanhaFim = new Date(amanha);
      amanhaFim.setHours(23, 59, 59, 999);

      // Busca eventos nas próximas 2 horas
      const { data: urgentes, error: errUrgentes } = await supabase
        .from('agenda_eventos')
        .select('id, titulo, descricao, inicio, local, tipo')
        .eq('gabinete_id', gabineteId)
        .gte('inicio', agora.toISOString())
        .lte('inicio', em2h.toISOString())
        .order('inicio', { ascending: true });

      if (!errUrgentes && urgentes) {
        for (const ev of urgentes as AgendaEvento[]) {
          const inicio = new Date(ev.inicio);
          const minutos = Math.round((inicio.getTime() - agora.getTime()) / 60000);
          const localInfo = ev.local ? ` em ${ev.local}` : '';

          events.push({
            id: crypto.randomUUID(),
            type: 'sessao_amanha',
            urgency: 'alta' as Urgency,
            title: `Evento em ${minutos} min: ${ev.titulo}`,
            detail: `"${ev.titulo}"${ev.tipo ? ` (${ev.tipo})` : ''}${localInfo} começa em aproximadamente ${minutos} minuto(s).${ev.descricao ? ` ${ev.descricao}` : ''}`,
            module: 'agenda',
            action_url: `/agenda/${ev.id}`,
            detected_at: new Date().toISOString(),
          });
        }
      }

      // Busca eventos para amanhã
      const { data: amanhEvs, error: errAmanha } = await supabase
        .from('agenda_eventos')
        .select('id, titulo, descricao, inicio, local, tipo')
        .eq('gabinete_id', gabineteId)
        .gte('inicio', amanha.toISOString())
        .lte('inicio', amanhaFim.toISOString())
        .order('inicio', { ascending: true });

      if (!errAmanha && amanhEvs) {
        for (const ev of amanhEvs as AgendaEvento[]) {
          const inicio = new Date(ev.inicio);
          const horaFormatada = inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const localInfo = ev.local ? ` em ${ev.local}` : '';

          events.push({
            id: crypto.randomUUID(),
            type: 'sessao_amanha',
            urgency: 'media' as Urgency,
            title: `Evento amanhã às ${horaFormatada}: ${ev.titulo}`,
            detail: `"${ev.titulo}"${ev.tipo ? ` (${ev.tipo})` : ''}${localInfo} está agendado para amanhã às ${horaFormatada}.${ev.descricao ? ` ${ev.descricao}` : ''}`,
            module: 'agenda',
            action_url: `/agenda/${ev.id}`,
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
