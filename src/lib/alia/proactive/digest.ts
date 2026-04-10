// src/lib/alia/proactive/digest.ts
// Digest Matinal — agrega dados de múltiplas fontes e envia o briefing
// diário das 8h via WhatsApp e Dashboard.

import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppMessage } from '../adapters/whatsapp';

// ── Supabase client ───────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Internal row shapes ───────────────────────────────────────────────────────

interface AlertRow {
  id: string;
  title: string;
  urgency: string;
  body: string | null;
}

interface BirthdayRow {
  id: string;
  nome: string;
  cargo: string | null;
  orgao: string | null;
}

interface EmailRow {
  id: string;
  subject: string;
  urgency: string;
  summary: string | null;
}

interface IndicacaoRow {
  id: string;
  documento_gerado_md: string | null;
}

// ── Urgency emoji map ─────────────────────────────────────────────────────────

const URGENCY_EMOJI: Record<string, string> = {
  critica:     '🔴',
  alta:        '🟡',
  media:       '🔵',
  baixa:       '⚪',
  informativa: 'ℹ️',
};

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns today as "YYYY-MM-DD" (UTC). */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns today as "DD/MM/YYYY" for display. */
function todayBR(): string {
  const [year, month, day] = todayISO().split('-');
  return `${day}/${month}/${year}`;
}

/** Returns the MM-DD portion of today for birthday matching. */
function todayMMDD(): string {
  return todayISO().slice(5); // "MM-DD"
}

// ── Data gathering ────────────────────────────────────────────────────────────

async function fetchUnreadAlerts(gabineteId: string): Promise<AlertRow[]> {
  try {
    const start = `${todayISO()}T00:00:00.000Z`;
    const end   = `${todayISO()}T23:59:59.999Z`;

    const { data, error } = await db()
      .from('alia_notifications')
      .select('id, title, urgency, body')
      .eq('gabinete_id', gabineteId)
      .eq('read', false)
      .gte('created_at', start)
      .lte('created_at', end)
      .in('urgency', ['critica', 'alta'])
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !data) return [];
    return data as AlertRow[];
  } catch {
    return [];
  }
}

async function fetchBirthdays(gabineteId: string): Promise<BirthdayRow[]> {
  try {
    const { data, error } = await db()
      .from('cadin_persons')
      .select('id, nome, cargo, orgao')
      .eq('gabinete_id', gabineteId)
      .filter('data_nascimento', 'like', `%-${todayMMDD()}`);

    if (error || !data) return [];
    return data as BirthdayRow[];
  } catch {
    return [];
  }
}

async function fetchUrgentEmails(gabineteId: string): Promise<EmailRow[]> {
  try {
    const { data, error } = await db()
      .from('email_intelligence')
      .select('id, subject, urgency, summary')
      .eq('gabinete_id', gabineteId)
      .in('urgency', ['critica', 'alta'])
      .is('action_taken', null)
      .order('received_at', { ascending: false })
      .limit(10);

    if (error || !data) return [];
    return data as EmailRow[];
  } catch {
    return [];
  }
}

async function fetchIndicacoes(
  gabineteId: string,
): Promise<{ pendentes: number; prontas: number }> {
  try {
    const supabase = db();

    const [allPendentes, prontas] = await Promise.all([
      supabase
        .from('indicacoes')
        .select('id, documento_gerado_md')
        .eq('gabinete_id', gabineteId)
        .eq('status', 'pendente'),
      supabase
        .from('indicacoes')
        .select('id, documento_gerado_md')
        .eq('gabinete_id', gabineteId)
        .eq('status', 'pendente')
        .not('documento_gerado_md', 'is', null),
    ]);

    const pendentesData = (allPendentes.data ?? []) as IndicacaoRow[];
    const prontasData   = (prontas.data ?? []) as IndicacaoRow[];

    return {
      pendentes: pendentesData.length,
      prontas:   prontasData.length,
    };
  } catch {
    return { pendentes: 0, prontas: 0 };
  }
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildAlertsSection(alerts: AlertRow[]): string | null {
  if (alerts.length === 0) return null;

  const lines = alerts.map((a) => {
    const emoji = URGENCY_EMOJI[a.urgency] ?? '🔴';
    return `• ${emoji} ${a.title}`;
  });

  return `🔴 *URGENTE*\n${lines.join('\n')}`;
}

function buildBirthdaysSection(birthdays: BirthdayRow[]): string | null {
  if (birthdays.length === 0) return null;

  const lines = birthdays.map((p) => {
    const parts = [p.nome];
    if (p.cargo || p.orgao) {
      const detail = [p.cargo, p.orgao].filter(Boolean).join(', ');
      parts.push(`(${detail})`);
    }
    parts.push('— hoje');
    return `• ${parts.join(' ')}`;
  });

  return `🎂 *ANIVERSÁRIOS*\n${lines.join('\n')}`;
}

function buildEmailsSection(emails: EmailRow[]): string | null {
  if (emails.length === 0) return null;

  const lines = emails.map((e) => {
    const emoji = URGENCY_EMOJI[e.urgency] ?? '📧';
    const summary = e.summary ? ` — ${e.summary}` : '';
    return `• ${emoji} ${e.subject}${summary}`;
  });

  return `📧 *EMAILS (${emails.length} pendentes)*\n${lines.join('\n')}`;
}

function buildIndicacoesSection(
  pendentes: number,
  prontas: number,
): string | null {
  if (pendentes === 0 && prontas === 0) return null;

  const parts: string[] = [];
  if (pendentes > 0) parts.push(`• ${pendentes} pendente${pendentes !== 1 ? 's' : ''}`);
  if (prontas > 0)   parts.push(`• ${prontas} pronta${prontas !== 1 ? 's' : ''} para protocolar`);

  return `📊 *INDICAÇÕES*\n${parts.join('\n')}`;
}

// ── Message assembly ──────────────────────────────────────────────────────────

function assembleDigest(sections: string[]): string {
  const header = `☀️ Bom dia! Briefing de ${todayBR()}`;
  const footer = '[Ver tudo no dashboard]';
  return [header, ...sections, footer].join('\n\n');
}

// ── Channel delivery ──────────────────────────────────────────────────────────

async function sendViaWhatsApp(text: string): Promise<void> {
  const envNumbers = process.env.ALIA_NOTIFY_NUMBERS
    ? process.env.ALIA_NOTIFY_NUMBERS.split(',').map((n) => n.trim()).filter(Boolean)
    : [];

  for (const phone of envNumbers) {
    try {
      await sendWhatsAppMessage(phone, text);
    } catch (err) {
      console.error(`[Digest] WhatsApp send failed for ${phone}:`, err);
    }
  }
}

async function sendViaDashboard(
  gabineteId: string,
  text: string,
): Promise<void> {
  try {
    const { error } = await db()
      .from('alia_notifications')
      .insert({
        gabinete_id:  gabineteId,
        recipient_id: null,
        type:         'email_digest',
        urgency:      'informativa',
        title:        `Briefing Matinal — ${todayBR()}`,
        body:         text,
        action_url:   null,
      });

    if (error) {
      console.error('[Digest] Dashboard insert error:', error.message);
    }
  } catch (err) {
    console.error('[Digest] Dashboard exception:', err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds the daily morning briefing (Digest Matinal) by aggregating data from
 * multiple sources and delivers it via WhatsApp and Dashboard.
 *
 * Each data source is fetched in parallel. If a section fails to load it is
 * silently skipped so a partial digest is always sent.
 *
 * @returns { sent: true, sections: N } where N is the number of non-empty sections.
 */
export async function buildAndSendDigest(
  gabineteId: string,
): Promise<{ sent: boolean; sections: number }> {
  // 1. Gather all data in parallel
  const [alerts, birthdays, emails, indicacoes] = await Promise.all([
    fetchUnreadAlerts(gabineteId),
    fetchBirthdays(gabineteId),
    fetchUrgentEmails(gabineteId),
    fetchIndicacoes(gabineteId),
  ]);

  // 2. Build sections — only include non-empty ones
  const candidateSections: Array<string | null> = [
    buildAlertsSection(alerts),
    buildBirthdaysSection(birthdays),
    buildEmailsSection(emails),
    buildIndicacoesSection(indicacoes.pendentes, indicacoes.prontas),
  ];

  const activeSections = candidateSections.filter((s): s is string => s !== null);

  // 3. Assemble the full message
  const digestText = assembleDigest(activeSections);

  // 4. Send via all channels (errors per channel are swallowed internally)
  await Promise.all([
    sendViaWhatsApp(digestText),
    sendViaDashboard(gabineteId, digestText),
  ]);

  console.log(
    `[Digest] Matinal enviado — gabinete: ${gabineteId}, seções: ${activeSections.length}`,
  );

  return { sent: true, sections: activeSections.length };
}
