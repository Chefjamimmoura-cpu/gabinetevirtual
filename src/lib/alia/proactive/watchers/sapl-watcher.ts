// src/lib/alia/proactive/watchers/sapl-watcher.ts
// Verifica o SAPL por novas matérias e publicação de Ordem do Dia.

import type { Watcher, ProactiveEvent } from '../watcher.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

interface SaplMateria {
  id: string;
  tipo: string;
  numero: string;
  ano: number;
  ementa: string;
}

interface SaplOrdemDia {
  id: string;
  sessao_data: string;
  sessao_tipo: string;
  publicado_em: string;
}

export const saplWatcher: Watcher = {
  name: 'sapl',
  schedule: '0 */2 * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      // Verifica novas matérias nas últimas 2 horas
      const materiasRes = await fetch(
        `${INTERNAL_BASE}/api/sapl/materias-recentes?gabineteId=${encodeURIComponent(gabineteId)}&horasAtras=2`,
        { headers: { 'x-internal-call': '1' } },
      );

      if (materiasRes.ok) {
        const materias: SaplMateria[] = await materiasRes.json();

        for (const m of materias) {
          events.push({
            id: crypto.randomUUID(),
            type: 'materia_nova',
            urgency: 'informativa',
            title: `Nova matéria no SAPL: ${m.tipo} ${m.numero}/${m.ano}`,
            detail: `Foi registrada nova matéria no SAPL — ${m.tipo} nº ${m.numero}/${m.ano}: ${m.ementa}`,
            module: 'sapl',
            related_entities: { materia_ids: [String(m.id)] },
            action_url: `/pareceres/materias/${m.id}`,
            detected_at: new Date().toISOString(),
          });
        }
      }

      // Verifica publicação de Ordem do Dia nas últimas 2 horas
      const ordemRes = await fetch(
        `${INTERNAL_BASE}/api/sapl/ordem-dia-recente?gabineteId=${encodeURIComponent(gabineteId)}&horasAtras=2`,
        { headers: { 'x-internal-call': '1' } },
      );

      if (ordemRes.ok) {
        const ordens: SaplOrdemDia[] = await ordemRes.json();

        for (const ordem of ordens) {
          const dataFormatada = new Date(ordem.sessao_data).toLocaleDateString('pt-BR');
          events.push({
            id: crypto.randomUUID(),
            type: 'ordem_dia_publicada',
            urgency: 'alta',
            title: `Ordem do Dia publicada — Sessão ${dataFormatada}`,
            detail: `A Ordem do Dia da ${ordem.sessao_tipo} de ${dataFormatada} foi publicada no SAPL.`,
            module: 'sapl',
            action_url: `/sessoes/${ordem.id}`,
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
