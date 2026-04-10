// POST /api/alia/webhook
// ──────────────────────────────────────────────────────────────
// Thin gateway — receives Evolution API events and routes them
// through the ALIA brain. All domain logic lives in:
//   - src/lib/alia/adapters/whatsapp.ts  (parsing, session, send)
//   - src/lib/alia/brain.ts              (AI orchestration)
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createRateLimiter } from '@/lib/rate-limit';
import {
  shouldProcess,
  extractText,
  extractMedia,
  fetchMediaBase64,
  parseWebhookToRequest,
  sendWhatsAppMessage,
  getOrCreateSession,
  saveMessage,
  type EvolutionMessage,
} from '@/lib/alia/adapters/whatsapp';
import { process as aliaBrain } from '@/lib/alia/brain';

const webhookLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

export async function POST(req: NextRequest) {
  // ── 1. Rate limit ──────────────────────────────────────────────────────────
  const rateLimited = webhookLimiter.check(req);
  if (rateLimited) return rateLimited;

  // ── 2. Validate Evolution webhook secret ───────────────────────────────────
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (webhookSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${webhookSecret}`) {
      return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 });
    }
  } else {
    // Fail closed in production when secret is not configured
    if (process.env.NODE_ENV === 'production') {
      console.error('[ALIA] EVOLUTION_WEBHOOK_SECRET não configurado em produção');
      return NextResponse.json({ ok: false, error: 'Webhook não configurado' }, { status: 500 });
    }
  }

  // ── 3. Parse body ──────────────────────────────────────────────────────────
  let body: EvolutionMessage;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 });
  }

  // ── 4. Filter irrelevant events ────────────────────────────────────────────
  if (!shouldProcess(body)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // ── 5. Extract message data ────────────────────────────────────────────────
  const msg = body as EvolutionMessage;
  const remoteJid = msg.data?.key?.remoteJid ?? '';
  const pushName = msg.data?.pushName ?? 'Cidadão';
  const messageType = msg.data?.messageType ?? '';
  const messageId = msg.data?.key?.id;

  const text = extractText(msg);
  const mediaList = extractMedia(msg);

  // ── 6. Fetch media base64 when not inlined ─────────────────────────────────
  if (mediaList.length > 0 && !mediaList[0].base64 && messageId) {
    const fetched = await fetchMediaBase64(messageId);
    if (fetched) {
      mediaList[0].base64 = fetched.base64;
      mediaList[0].mime = fetched.mimeType;
    }
  }

  const hasMedia = mediaList.length > 0 && !!mediaList[0].base64;

  if (!text && !hasMedia) {
    return NextResponse.json({ ok: true, skipped: 'no text or media content' });
  }

  // ── 7. Get or create session ───────────────────────────────────────────────
  const session = await getOrCreateSession(remoteJid, pushName).catch(() => ({ id: '', status: 'ativa' }));

  // ── 8. Human takeover — save message and return early ─────────────────────
  if (session.status === 'humano') {
    await saveMessage(session.id, 'user', text || '(Mídia enviada)', {
      remoteJid,
      evolution_key: messageId,
    }).catch(() => null);
    return NextResponse.json({ ok: true, skipped: 'human_takeover', session_id: session.id });
  }

  // ── 9. Save user message ───────────────────────────────────────────────────
  await saveMessage(session.id, 'user', text || '(Mídia enviada)', {
    remoteJid,
    evolution_key: messageId,
    messageType,
  }).catch(() => null);

  // ── 10. Build AliaRequest ──────────────────────────────────────────────────
  // Attach resolved media to the message before building the request
  if (hasMedia) {
    if (!msg.data) msg.data = {};
    if (!msg.data.message) msg.data.message = {};
    msg.data.message.base64 = mediaList[0].base64;
  }

  const aliaRequest = parseWebhookToRequest(msg, session.id);

  // ── 11. Run through ALIA brain ─────────────────────────────────────────────
  let replyText = '';
  let brainOk = false;

  try {
    const response = await aliaBrain(aliaRequest);
    replyText = (response.channel_format?.whatsapp ?? response.text ?? '').trim();
    brainOk = true;
  } catch (err) {
    console.error('[ALIA webhook] brain error:', err);
    replyText = `Olá, ${pushName}! Recebi sua mensagem, mas meu sistema interno está offline neste momento. ⏱️\n\n*ALIA*`;
  }

  // ── 12. Send WhatsApp reply ────────────────────────────────────────────────
  const sent = await sendWhatsAppMessage(remoteJid, replyText);

  // ── 13. Save assistant message ─────────────────────────────────────────────
  await saveMessage(session.id, 'assistant', replyText, {
    brain_ok: brainOk,
    whatsapp_sent: sent,
  }).catch(() => null);

  // ── 14. Return success ─────────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    brain_ok: brainOk,
    whatsapp_sent: sent,
    reply_length: replyText.length,
  });
}
