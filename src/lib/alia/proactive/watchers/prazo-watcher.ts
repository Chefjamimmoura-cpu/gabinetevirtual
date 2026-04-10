// src/lib/alia/proactive/watchers/prazo-watcher.ts
// Detecta prazos de comissão aproximando-se (D-7, D-3, D-1, D-0).

import type { Watcher, ProactiveEvent, Urgency } from '../watcher.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

interface OrdensAtivasItem {
  id: string;
  titulo: string;
  prazo_comissao?: string | null;
  numero?: string;
}

function urgencyFromDays(days: number): Urgency | null {
  if (days < 0) return null;
  if (days === 0) return 'critica';
  if (days === 1) return 'alta';
  if (days <= 3) return 'media';
  if (days <= 7) return 'baixa';
  return null;
}

function labelFromDays(days: number): string {
  if (days === 0) return 'vence HOJE';
  if (days === 1) return 'vence amanhã (D-1)';
  return `vence em ${days} dias (D-${days})`;
}

export const prazoWatcher: Watcher = {
  name: 'prazo',
  schedule: '0 */6 * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const res = await fetch(
        `${INTERNAL_BASE}/api/pareceres/ordens-ativas?gabineteId=${encodeURIComponent(gabineteId)}`,
        { headers: { 'x-internal-call': '1' } },
      );

      if (!res.ok) return events;

      const data: OrdensAtivasItem[] = await res.json();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const item of data) {
        if (!item.prazo_comissao) continue;

        const prazo = new Date(item.prazo_comissao);
        prazo.setHours(0, 0, 0, 0);
        const diffMs = prazo.getTime() - today.getTime();
        const days = Math.round(diffMs / (1000 * 60 * 60 * 24));

        const urgency = urgencyFromDays(days);
        if (!urgency) continue;

        events.push({
          id: crypto.randomUUID(),
          type: 'prazo_vencendo',
          urgency,
          title: `Prazo de comissão ${labelFromDays(days)}`,
          detail: `Matéria "${item.titulo}"${item.numero ? ` (${item.numero})` : ''} tem prazo de comissão que ${labelFromDays(days)}.`,
          module: 'pareceres',
          related_entities: { materia_ids: [item.id] },
          action_url: `/pareceres/materias/${item.id}`,
          detected_at: new Date().toISOString(),
        });
      }
    } catch {
      // watcher nunca deve lançar erro
    }

    return events;
  },
};
