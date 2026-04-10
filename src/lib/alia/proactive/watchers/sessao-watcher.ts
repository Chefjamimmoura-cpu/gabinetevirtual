// src/lib/alia/proactive/watchers/sessao-watcher.ts
// Verifica se há sessão plenária agendada no SAPL para amanhã.

import type { Watcher, ProactiveEvent } from '../watcher.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

interface SaplSessao {
  id: string;
  tipo: string;
  data: string;
  hora_inicio: string | null;
  local: string | null;
}

export const sessaoWatcher: Watcher = {
  name: 'sessao',
  schedule: '0 18 * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const dataStr = amanha.toISOString().split('T')[0]; // YYYY-MM-DD

      const res = await fetch(
        `${INTERNAL_BASE}/api/sapl/sessoes?gabineteId=${encodeURIComponent(gabineteId)}&data=${dataStr}`,
        { headers: { 'x-internal-call': '1' } },
      );

      if (!res.ok) return events;

      const sessoes: SaplSessao[] = await res.json();

      for (const sessao of sessoes) {
        const dataFormatada = new Date(sessao.data).toLocaleDateString('pt-BR');
        const horaInfo = sessao.hora_inicio ? ` às ${sessao.hora_inicio}` : '';
        const localInfo = sessao.local ? ` em ${sessao.local}` : '';

        events.push({
          id: crypto.randomUUID(),
          type: 'sessao_amanha',
          urgency: 'alta',
          title: `${sessao.tipo} amanhã — ${dataFormatada}`,
          detail: `Há uma ${sessao.tipo} agendada para amanhã (${dataFormatada})${horaInfo}${localInfo}. Verifique a Ordem do Dia e prepare os materiais.`,
          module: 'sessoes',
          action_url: `/sessoes/${sessao.id}`,
          detected_at: new Date().toISOString(),
        });
      }
    } catch {
      // watcher nunca deve lançar erro
    }

    return events;
  },
};
