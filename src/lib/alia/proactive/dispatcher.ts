// src/lib/alia/proactive/dispatcher.ts
// Delivers evaluated alerts to their target channels (WhatsApp, Dashboard, Email).
// Logs every dispatch to alia_proactive_log for anti-spam tracking.

import { createClient } from '@supabase/supabase-js';
import type { ProactiveEvent, Urgency } from './watcher.interface';
import type { EvaluatedAlert } from './evaluator';
import { sendWhatsAppMessage } from '../adapters/whatsapp';

// ── Supabase client ───────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Urgency emoji map ─────────────────────────────────────────────────────────

const URGENCY_EMOJI: Record<Urgency, string> = {
  critica:    '🔴',
  alta:       '🟡',
  media:      '🔵',
  baixa:      '⚪',
  informativa: 'ℹ️',
};

// ── Format helpers ────────────────────────────────────────────────────────────

/**
 * Formats an evaluated alert for WhatsApp delivery.
 * Compact layout: urgency emoji + bold title, detail, optional action URL.
 */
function formatWhatsApp(alert: EvaluatedAlert): string {
  const { event } = alert;
  const emoji = URGENCY_EMOJI[event.urgency];
  const lines: string[] = [
    `${emoji} *${event.title}*`,
    event.detail,
  ];
  if (event.action_url) lines.push(event.action_url);
  return lines.join('\n');
}

/**
 * Formats an evaluated alert for the dashboard notification panel.
 * Same text as WhatsApp — rendered differently in the UI.
 */
function formatDashboard(alert: EvaluatedAlert): string {
  return formatWhatsApp(alert);
}

// ── Anti-spam log ─────────────────────────────────────────────────────────────

async function logDispatch(
  gabineteId: string,
  event: ProactiveEvent,
  channel: string,
  recipient: string,
  consolidatedCount: number,
): Promise<void> {
  const { error } = await db()
    .from('alia_proactive_log')
    .insert({
      gabinete_id: gabineteId,
      event_type: event.type,
      event_ref: event.id,
      channel,
      recipient,
      consolidated_count: consolidatedCount,
    });

  if (error) {
    console.error('[Dispatcher] Failed to log dispatch:', error.message);
  }
}

// ── Channel handlers ──────────────────────────────────────────────────────────

async function dispatchWhatsApp(
  alert: EvaluatedAlert,
  gabineteId: string,
): Promise<{ sent: number; failed: number }> {
  const text = formatWhatsApp(alert);

  // Resolve recipient numbers: env var takes precedence, fallback to alert.recipients
  const envNumbers = process.env.ALIA_NOTIFY_NUMBERS
    ? process.env.ALIA_NOTIFY_NUMBERS.split(',').map((n) => n.trim()).filter(Boolean)
    : [];
  const phones = envNumbers.length > 0 ? envNumbers : alert.recipients;

  let sent = 0;
  let failed = 0;

  for (const phone of phones) {
    try {
      const ok = await sendWhatsAppMessage(phone, text);
      if (ok) {
        sent++;
        await logDispatch(gabineteId, alert.event, 'whatsapp', phone, 1);
      } else {
        failed++;
        console.warn(`[Dispatcher] WhatsApp send returned false for ${phone}`);
      }
    } catch (err) {
      failed++;
      console.error(`[Dispatcher] WhatsApp exception for ${phone}:`, err);
    }
  }

  // Nothing to send if no phones configured — count as a single failure
  if (phones.length === 0) {
    console.warn('[Dispatcher] WhatsApp: no recipient numbers configured (ALIA_NOTIFY_NUMBERS)');
    failed++;
  }

  return { sent, failed };
}

async function dispatchDashboard(
  alert: EvaluatedAlert,
  gabineteId: string,
): Promise<{ sent: number; failed: number }> {
  const body = formatDashboard(alert);
  const { event } = alert;

  // Derive per-recipient rows; if no explicit recipients, insert one generic row
  const recipients = alert.recipients.length > 0 ? alert.recipients : [null];

  let sent = 0;
  let failed = 0;

  for (const recipientId of recipients) {
    try {
      const { error } = await db()
        .from('alia_notifications')
        .insert({
          gabinete_id: gabineteId,
          recipient_id: recipientId,
          type: event.type,
          urgency: event.urgency,
          title: event.title,
          body,
          action_url: event.action_url ?? null,
        });

      if (error) {
        failed++;
        console.error('[Dispatcher] Dashboard insert error:', error.message);
      } else {
        sent++;
        await logDispatch(gabineteId, event, 'dashboard', recipientId ?? 'global', 1);
      }
    } catch (err) {
      failed++;
      console.error('[Dispatcher] Dashboard exception:', err);
    }
  }

  return { sent, failed };
}

function dispatchEmail(alert: EvaluatedAlert): { sent: number; failed: number } {
  // Email digest is Phase 4 Task 6 scope — not yet implemented.
  console.log(
    `[Dispatcher] email dispatch not yet implemented (alert: ${alert.event.id}, title: "${alert.event.title}")`,
  );
  return { sent: 0, failed: 0 };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Delivers a list of evaluated alerts to their configured channels.
 * Each channel dispatch is wrapped in try/catch so one failure cannot
 * prevent other channels from being notified.
 *
 * @returns Aggregate count of sent and failed channel dispatches.
 */
export async function dispatch(
  alerts: EvaluatedAlert[],
  gabineteId: string,
): Promise<{ sent: number; failed: number }> {
  let totalSent = 0;
  let totalFailed = 0;

  for (const alert of alerts) {
    for (const channel of alert.channels) {
      try {
        let result: { sent: number; failed: number };

        switch (channel) {
          case 'whatsapp':
            result = await dispatchWhatsApp(alert, gabineteId);
            break;
          case 'dashboard':
            result = await dispatchDashboard(alert, gabineteId);
            break;
          case 'email':
            result = dispatchEmail(alert);
            break;
          default: {
            const _exhaustive: never = channel;
            console.warn(`[Dispatcher] Unknown channel: ${_exhaustive}`);
            result = { sent: 0, failed: 1 };
          }
        }

        totalSent += result.sent;
        totalFailed += result.failed;
      } catch (err) {
        totalFailed++;
        console.error(`[Dispatcher] Unhandled error on channel "${channel}":`, err);
      }
    }
  }

  console.log(
    `[Dispatcher] Done — sent: ${totalSent}, failed: ${totalFailed}, alerts: ${alerts.length}`,
  );

  return { sent: totalSent, failed: totalFailed };
}
