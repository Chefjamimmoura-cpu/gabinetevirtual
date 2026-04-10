// src/lib/alia/proactive/evaluator.ts
// Decision engine: receives raw ProactiveEvents and decides should we alert,
// who gets it, via which channels, and when.
// Delivery is handled by dispatcher.ts — this module only evaluates.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProactiveEvent, Urgency, EventType } from './watcher.interface';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EvaluatedAlert {
  events: ProactiveEvent[];       // May consolidate multiple events
  urgency: Urgency;
  recipients: string[];           // phone numbers or profile_ids
  channels: Array<'whatsapp' | 'dashboard' | 'email'>;
  scheduled_at: string;           // When to send (ISO)
  consolidation?: string;         // e.g. "3 prazos vencendo esta semana"
}

// ---------------------------------------------------------------------------
// Internal types (Supabase row shapes — kept minimal)
// ---------------------------------------------------------------------------

interface ProactiveLogRow {
  event_type: EventType;
  event_ref: string;
  channel: string;
  sent_at: string;
}

interface NotificationPrefsRow {
  gabinete_id: string;
  recipients: string[];           // phone numbers / profile_ids
  quiet_start: string | null;     // "HH:MM"
  quiet_end: string | null;       // "HH:MM"
  digest_time: string | null;     // "HH:MM"
  max_daily: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const URGENCY_ORDER: Record<Urgency, number> = {
  critica: 0,
  alta: 1,
  media: 2,
  baixa: 3,
  informativa: 4,
};

function higherUrgency(a: Urgency, b: Urgency): Urgency {
  return URGENCY_ORDER[a] <= URGENCY_ORDER[b] ? a : b;
}

/** Returns today's ISO date string (YYYY-MM-DD) in UTC. */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns current time as "HH:MM" in local time. */
function currentHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Returns the next ISO datetime string for a given "HH:MM" time today
 * (or tomorrow if that time has already passed today).
 */
function nextOccurrenceISO(hhMM: string): string {
  const [h, m] = hhMM.split(':').map(Number);
  const candidate = new Date();
  candidate.setHours(h, m, 0, 0);
  if (candidate <= new Date()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

/** True if timeHHMM falls inside the [quietStart, quietEnd) window. */
function isDuringQuietHours(
  timeHHMM: string,
  quietStart: string,
  quietEnd: string,
): boolean {
  // Handle overnight windows (e.g. 22:00 → 07:00)
  if (quietStart <= quietEnd) {
    return timeHHMM >= quietStart && timeHHMM < quietEnd;
  }
  // Overnight: quiet if after start OR before end
  return timeHHMM >= quietStart || timeHHMM < quietEnd;
}

/** Stable key used to deduplicate and check cooldown. */
function eventKey(e: ProactiveEvent): string {
  return `${e.type}::${e.id}`;
}

// ---------------------------------------------------------------------------
// Step 1 — Deduplicate
// ---------------------------------------------------------------------------

/**
 * Groups events by (type + id/ref). Within each group keeps the single event
 * with the highest urgency.
 */
function deduplicate(events: ProactiveEvent[]): ProactiveEvent[] {
  const map = new Map<string, ProactiveEvent>();

  for (const ev of events) {
    const key = eventKey(ev);
    const existing = map.get(key);
    if (!existing || URGENCY_ORDER[ev.urgency] < URGENCY_ORDER[existing.urgency]) {
      map.set(key, ev);
    }
  }

  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Step 2 — Cooldown check (24 h)
// ---------------------------------------------------------------------------

async function filterByCooldown(
  events: ProactiveEvent[],
  supabase: AnySupabaseClient,
): Promise<ProactiveEvent[]> {
  if (events.length === 0) return [];

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const refs = events.map((e) => e.id);

  const { data: logs } = await supabase
    .from('alia_proactive_log')
    .select('event_type, event_ref, channel, sent_at')
    .gte('sent_at', cutoff)
    .in('event_ref', refs)
    .returns<ProactiveLogRow[]>();

  const sentKeys = new Set<string>(
    (logs ?? []).map((r) => `${r.event_type}::${r.event_ref}`),
  );

  return events.filter((ev) => !sentKeys.has(eventKey(ev)));
}

// ---------------------------------------------------------------------------
// Step 3 — Consolidate
// ---------------------------------------------------------------------------

interface ConsolidationGroup {
  events: ProactiveEvent[];
  urgency: Urgency;
  consolidation?: string;
}

function consolidate(events: ProactiveEvent[]): ConsolidationGroup[] {
  const byType = new Map<EventType, ProactiveEvent[]>();
  for (const ev of events) {
    const bucket = byType.get(ev.type) ?? [];
    bucket.push(ev);
    byType.set(ev.type, bucket);
  }

  const groups: ConsolidationGroup[] = [];

  // --- aniversario: N aniversariantes today → 1 combined alert
  const aniversarios = byType.get('aniversario') ?? [];
  if (aniversarios.length > 1) {
    const urgency = aniversarios.reduce<Urgency>(
      (best, e) => higherUrgency(best, e.urgency),
      'informativa',
    );
    const names = aniversarios.map((e) => e.title).join(', ');
    groups.push({
      events: aniversarios,
      urgency,
      consolidation: `🎂 ${aniversarios.length} aniversariantes hoje: ${names}`,
    });
  } else if (aniversarios.length === 1) {
    groups.push({ events: aniversarios, urgency: aniversarios[0].urgency });
  }

  // --- prazo_vencendo: N prazos this week → 1 combined alert
  const prazos = byType.get('prazo_vencendo') ?? [];
  if (prazos.length > 1) {
    const urgency = prazos.reduce<Urgency>(
      (best, e) => higherUrgency(best, e.urgency),
      'informativa',
    );
    groups.push({
      events: prazos,
      urgency,
      consolidation: `⏰ ${prazos.length} prazos vencendo esta semana`,
    });
  } else if (prazos.length === 1) {
    groups.push({ events: prazos, urgency: prazos[0].urgency });
  }

  // --- sessao_amanha + ordem_dia_publicada → 1 combined alert
  const sessaoAmanha = byType.get('sessao_amanha') ?? [];
  const ordemDia = byType.get('ordem_dia_publicada') ?? [];
  if (sessaoAmanha.length > 0 && ordemDia.length > 0) {
    const combined = [...sessaoAmanha, ...ordemDia];
    const urgency = combined.reduce<Urgency>(
      (best, e) => higherUrgency(best, e.urgency),
      'informativa',
    );
    groups.push({
      events: combined,
      urgency,
      consolidation: `📋 Sessão amanhã com pauta publicada`,
    });
  } else {
    for (const ev of sessaoAmanha) groups.push({ events: [ev], urgency: ev.urgency });
    for (const ev of ordemDia) groups.push({ events: [ev], urgency: ev.urgency });
  }

  // --- All remaining types: one group per event
  const handledTypes = new Set<EventType>([
    'aniversario',
    'prazo_vencendo',
    'sessao_amanha',
    'ordem_dia_publicada',
  ]);

  for (const [type, evs] of Array.from(byType.entries())) {
    if (handledTypes.has(type)) continue;
    for (const ev of evs) {
      groups.push({ events: [ev], urgency: ev.urgency });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Channel routing by urgency
// ---------------------------------------------------------------------------

function urgencyToChannels(urgency: Urgency): Array<'whatsapp' | 'dashboard' | 'email'> {
  switch (urgency) {
    case 'critica':
      return ['whatsapp', 'dashboard', 'email'];
    case 'alta':
      return ['whatsapp', 'dashboard'];
    case 'media':
      // dashboard now; real-time channels deferred to digest — dispatcher splits them
      return ['dashboard', 'whatsapp', 'email'];
    case 'baixa':
    case 'informativa':
    default:
      return ['dashboard'];
  }
}

// ---------------------------------------------------------------------------
// Steps 4+5 — Quiet hours & daily limit → schedule timing
// ---------------------------------------------------------------------------

async function resolveScheduling(
  group: ConsolidationGroup,
  prefs: NotificationPrefsRow,
  supabase: AnySupabaseClient,
  gabineteId: string,
): Promise<{ scheduled_at: string; channels: Array<'whatsapp' | 'dashboard' | 'email'> }> {
  const now = new Date().toISOString();
  const { urgency } = group;

  // critica is always immediate — no constraints apply
  if (urgency === 'critica') {
    return { scheduled_at: now, channels: ['whatsapp', 'dashboard', 'email'] };
  }

  const baseChannels = urgencyToChannels(urgency);

  // Step 4 — Quiet hours
  const currentTime = currentHHMM();
  const inQuiet =
    prefs.quiet_start && prefs.quiet_end
      ? isDuringQuietHours(currentTime, prefs.quiet_start, prefs.quiet_end)
      : false;

  // Step 5 — Daily limit (count non-dashboard sends today)
  const realTimeChannels = baseChannels.filter((c) => c !== 'dashboard');
  let dailyLimitReached = false;

  if (realTimeChannels.length > 0) {
    const startOfDay = `${todayDate()}T00:00:00.000Z`;
    const { count } = await supabase
      .from('alia_proactive_log')
      .select('*', { count: 'exact', head: true })
      .eq('gabinete_id', gabineteId)
      .gte('sent_at', startOfDay)
      .in('channel', realTimeChannels);

    dailyLimitReached = (count ?? 0) >= prefs.max_daily;
  }

  const shouldDefer = inQuiet || dailyLimitReached;

  if (shouldDefer) {
    const digestTime = prefs.digest_time ?? '08:00';
    return {
      scheduled_at: nextOccurrenceISO(digestTime),
      channels: ['dashboard'],  // only dashboard until digest fires
    };
  }

  return { scheduled_at: now, channels: baseChannels };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function evaluate(
  events: ProactiveEvent[],
  gabineteId: string,
): Promise<EvaluatedAlert[]> {
  if (events.length === 0) return [];

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    // Prefer service role for server-side log queries; fall back to anon key
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // 1. Deduplicate — same type+ref → keep highest urgency
  const deduped = deduplicate(events);

  // 2. Cooldown — skip anything already sent in the last 24 h
  const fresh = await filterByCooldown(deduped, supabase);
  if (fresh.length === 0) return [];

  // 3. Consolidate — merge related events into single alerts
  const groups = consolidate(fresh);

  // Load notification prefs (safe defaults if row is missing)
  const { data: prefsRow } = await supabase
    .from('alia_notification_prefs')
    .select('*')
    .eq('gabinete_id', gabineteId)
    .single<NotificationPrefsRow>();

  const prefs: NotificationPrefsRow = prefsRow ?? {
    gabinete_id: gabineteId,
    recipients: [],
    quiet_start: '22:00',
    quiet_end: '07:00',
    digest_time: '08:00',
    max_daily: 10,
  };

  // 4+5. Resolve scheduling — quiet hours + daily limit per group
  const alerts: EvaluatedAlert[] = [];

  for (const group of groups) {
    const { scheduled_at, channels } = await resolveScheduling(
      group,
      prefs,
      supabase,
      gabineteId,
    );

    alerts.push({
      events: group.events,
      urgency: group.urgency,
      recipients: prefs.recipients,
      channels,
      scheduled_at,
      ...(group.consolidation ? { consolidation: group.consolidation } : {}),
    });
  }

  // Sort critica first
  alerts.sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency],
  );

  return alerts;
}
