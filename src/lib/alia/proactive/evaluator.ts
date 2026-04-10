// src/lib/alia/proactive/evaluator.ts
// Evaluates raw ProactiveEvents and decides which ones should be dispatched,
// enriching them with channel targets and recipient lists.

import type { ProactiveEvent, Urgency } from './watcher.interface';

// ── EvaluatedAlert ────────────────────────────────────────────────────────────

export type Channel = 'whatsapp' | 'dashboard' | 'email';

export interface EvaluatedAlert {
  event: ProactiveEvent;
  channels: Channel[];
  /** Phone numbers or profile_ids depending on the channel */
  recipients: string[];
  urgency: Urgency;
  gabinete_id: string;
}

// ── evaluate ──────────────────────────────────────────────────────────────────

/**
 * Converts a list of raw proactive events into evaluated alerts,
 * applying anti-spam rules and channel routing logic.
 *
 * Full implementation: Task 5 (ALIA Phase 4).
 */
export async function evaluate(
  events: ProactiveEvent[],
  gabineteId: string,
): Promise<EvaluatedAlert[]> {
  return events.map((event) => ({
    event,
    channels: resolveChannels(event.urgency),
    recipients: [],
    urgency: event.urgency,
    gabinete_id: gabineteId,
  }));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function resolveChannels(urgency: Urgency): Channel[] {
  switch (urgency) {
    case 'critica':
    case 'alta':
      return ['whatsapp', 'dashboard'];
    case 'media':
      return ['dashboard', 'whatsapp'];
    case 'baixa':
    case 'informativa':
      return ['dashboard'];
  }
}
