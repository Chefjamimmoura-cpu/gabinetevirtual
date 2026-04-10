// src/lib/alia/proactive/scheduler.ts
import type { Watcher, ProactiveEvent } from './watcher.interface';
import { evaluate } from './evaluator';
import { dispatch } from './dispatcher';

// Import all 10 watchers
import { aniversarioWatcher } from './watchers/aniversario-watcher';
import { prazoWatcher } from './watchers/prazo-watcher';
import { saplWatcher } from './watchers/sapl-watcher';
import { emailWatcher } from './watchers/email-watcher';
import { indicacaoWatcher } from './watchers/indicacao-watcher';
import { sessaoWatcher } from './watchers/sessao-watcher';
import { oficioWatcher } from './watchers/oficio-watcher';
import { comissaoWatcher } from './watchers/comissao-watcher';
import { agendaWatcher } from './watchers/agenda-watcher';
import { sentinelWatcher } from './watchers/sentinel-watcher';

const ALL_WATCHERS: Watcher[] = [
  aniversarioWatcher, prazoWatcher, saplWatcher, emailWatcher,
  indicacaoWatcher, sessaoWatcher, oficioWatcher, comissaoWatcher,
  agendaWatcher, sentinelWatcher,
];

export async function runWatchers(
  gabineteId: string,
  watcherNames?: string[], // if provided, only run these; otherwise run all
): Promise<{ events: number; alerts: number; sent: number; failed: number }> {
  // 1. Select watchers to run
  const watchers = watcherNames
    ? ALL_WATCHERS.filter(w => watcherNames.includes(w.name))
    : ALL_WATCHERS;

  // 2. Run all selected watchers in parallel
  const results = await Promise.allSettled(
    watchers.map(w => w.check(gabineteId))
  );

  // 3. Collect all events (skip failed watchers)
  const allEvents: ProactiveEvent[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    }
  }

  if (allEvents.length === 0) {
    return { events: 0, alerts: 0, sent: 0, failed: 0 };
  }

  // 4. Evaluate (dedupe, cooldown, consolidate, route)
  const alerts = await evaluate(allEvents, gabineteId);

  if (alerts.length === 0) {
    return { events: allEvents.length, alerts: 0, sent: 0, failed: 0 };
  }

  // 5. Dispatch alerts
  const { sent, failed } = await dispatch(alerts, gabineteId);

  return { events: allEvents.length, alerts: alerts.length, sent, failed };
}

export function getWatchersBySchedule(cronExpression: string): string[] {
  return ALL_WATCHERS
    .filter(w => w.schedule === cronExpression)
    .map(w => w.name);
}

export function getAllSchedules(): Array<{ name: string; schedule: string }> {
  return ALL_WATCHERS.map(w => ({ name: w.name, schedule: w.schedule }));
}
