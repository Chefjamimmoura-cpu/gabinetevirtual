// src/lib/alia/adapters/whatsapp.ts
// WhatsApp adapter — extracts Evolution API helpers from the webhook route
// into a reusable, testable module consumed by any handler that needs to
// send/receive WhatsApp messages through the gateway.

import { createClient } from '@supabase/supabase-js';
import type { AliaRequest, MediaAttachment } from '../gateway';

// ── Evolution API message shape ───────────────────────────────────────────────

export interface EvolutionMessage {
  event: string;
  instance: string;
  data?: {
    key?: {
      remoteJid?: string;
      fromMe?: boolean;
      id?: string;
    };
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      imageMessage?: { caption?: string; mimetype?: string };
      videoMessage?: { caption?: string; mimetype?: string };
      audioMessage?: { mimetype?: string };
      documentMessage?: { caption?: string; fileName?: string; mimetype?: string };
      base64?: string;
    };
    messageType?: string;
    pushName?: string;
    /** Some Evolution versions embed base64 at the data root */
    base64?: string;
  };
  messageTimestamp?: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function getEvolutionConfig() {
  return {
    url: process.env.EVOLUTION_API_URL ?? '',
    key: process.env.EVOLUTION_API_KEY ?? '',
    instance: process.env.EVOLUTION_INSTANCE ?? 'gabinete-carol',
  };
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Returns true when the Evolution API event should be processed by the bot.
 * Skips events that are not message upserts, sent by the bot itself, or group chats.
 */
export function shouldProcess(body: EvolutionMessage): boolean {
  if (body.event !== 'messages.upsert' && body.event !== 'MESSAGES_UPSERT') {
    return false;
  }

  const key = body.data?.key;
  const remoteJid = key?.remoteJid;
  const fromMe = key?.fromMe;

  // Ignore own messages and group chats
  if (fromMe || !remoteJid || remoteJid.endsWith('@g.us')) {
    return false;
  }

  return true;
}

// ── Text extraction ───────────────────────────────────────────────────────────

/**
 * Extracts the text content from an Evolution API message, handling all
 * supported message types: plain text, extended text, and media captions.
 */
export function extractText(msg: EvolutionMessage): string {
  const message = msg.data?.message;
  if (!message) return '';

  const type = msg.data?.messageType;

  if (type === 'imageMessage') return message.imageMessage?.caption ?? '';
  if (type === 'videoMessage') return message.videoMessage?.caption ?? '';
  if (type === 'documentMessage') {
    return message.documentMessage?.caption ?? message.documentMessage?.fileName ?? '';
  }
  if (type === 'audioMessage') return '(Áudio Recebido)';

  return message.conversation ?? message.extendedTextMessage?.text ?? '';
}

// ── Media extraction ──────────────────────────────────────────────────────────

/**
 * Builds a MediaAttachment array from the Evolution API message.
 * The base64 field is left empty at this stage — callers should fill it
 * via fetchMediaBase64 when the inline data is absent.
 */
export function extractMedia(msg: EvolutionMessage): MediaAttachment[] {
  const message = msg.data?.message;
  const type = msg.data?.messageType;
  if (!message || !type) return [];

  const inlineBase64: string = message.base64 ?? msg.data?.base64 ?? '';

  if (type === 'imageMessage') {
    return [{
      type: 'image',
      base64: inlineBase64,
      mime: message.imageMessage?.mimetype ?? 'image/jpeg',
      caption: message.imageMessage?.caption,
    }];
  }

  if (type === 'audioMessage') {
    return [{
      type: 'audio',
      base64: inlineBase64,
      mime: message.audioMessage?.mimetype ?? 'audio/ogg',
    }];
  }

  if (type === 'videoMessage') {
    return [{
      type: 'video',
      base64: inlineBase64,
      mime: 'video/mp4',
      caption: message.videoMessage?.caption,
    }];
  }

  if (type === 'documentMessage') {
    return [{
      type: 'document',
      base64: inlineBase64,
      mime: message.documentMessage?.mimetype ?? 'application/octet-stream',
      filename: message.documentMessage?.fileName,
      caption: message.documentMessage?.caption,
    }];
  }

  return [];
}

// ── Media binary fetch ────────────────────────────────────────────────────────

/**
 * Fetches the base64-encoded binary for a media message from the Evolution API.
 * Returns null when the request fails or when environment variables are missing.
 */
export async function fetchMediaBase64(
  messageId: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const { url, key, instance } = getEvolutionConfig();
  if (!url || !key || !messageId) return null;

  try {
    const res = await fetch(
      `${url}/message/getBase64FromMediaMessage/${instance}/${messageId}`,
      { headers: { apikey: key } },
    );
    if (!res.ok) return null;

    const data = await res.json() as { base64?: string; mimetype?: string };
    if (!data?.base64) return null;

    return { base64: data.base64, mimeType: data.mimetype ?? 'audio/ogg' };
  } catch {
    return null;
  }
}

// ── Request building ──────────────────────────────────────────────────────────

/**
 * Converts a raw EvolutionMessage into a normalised AliaRequest ready for
 * the gateway, binding it to the provided session.
 */
export function parseWebhookToRequest(
  msg: EvolutionMessage,
  sessionId: string,
): AliaRequest {
  const remoteJid = msg.data?.key?.remoteJid ?? '';
  const phone = remoteJid.replace('@s.whatsapp.net', '');
  const name = msg.data?.pushName ?? 'Cidadão';
  const text = extractText(msg);
  const media = extractMedia(msg);
  const gabineteId = process.env.GABINETE_ID ?? '';

  return {
    channel: 'whatsapp',
    session_id: sessionId,
    gabinete_id: gabineteId,
    sender: { phone, name },
    content: {
      text,
      ...(media.length > 0 ? { media } : {}),
    },
    timestamp: new Date().toISOString(),
    is_proactive: false,
  };
}

// ── Outbound messaging ────────────────────────────────────────────────────────

/**
 * Sends a plain-text message to a WhatsApp number via the Evolution API.
 * Returns true when the message was accepted by the API.
 */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<boolean> {
  const { url, key, instance } = getEvolutionConfig();
  if (!url || !key) return false;

  try {
    const res = await fetch(`${url}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
      },
      body: JSON.stringify({ number: phone, text, delay: 1000 }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Session management ────────────────────────────────────────────────────────

/**
 * Finds an existing active or humano laia_session for the given phone number,
 * or creates a new one. Returns the session id and its current status.
 */
export async function getOrCreateSession(
  phone: string,
  contactName: string,
): Promise<{ id: string; status: string }> {
  const supabase = getSupabase();
  const gabineteId = process.env.GABINETE_ID ?? '';
  const cleanPhone = phone.replace('@s.whatsapp.net', '');

  const { data: existing } = await supabase
    .from('laia_sessions')
    .select('id, status')
    .eq('gabinete_id', gabineteId)
    .eq('canal', 'whatsapp')
    .eq('telefone', cleanPhone)
    .neq('status', 'encerrada')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    await supabase
      .from('laia_sessions')
      .update({ contato_nome: contactName, ultima_msg_em: new Date().toISOString() })
      .eq('id', existing.id);

    return { id: existing.id, status: existing.status as string };
  }

  const { data: created } = await supabase
    .from('laia_sessions')
    .insert({
      gabinete_id: gabineteId,
      canal: 'whatsapp',
      agente: 'laia',
      telefone: cleanPhone,
      contato_nome: contactName,
      status: 'ativa',
    })
    .select('id, status')
    .single();

  return { id: created?.id ?? '', status: created?.status ?? 'ativa' };
}

// ── Message persistence ───────────────────────────────────────────────────────

/**
 * Inserts a message row into laia_messages and bumps the session timestamp.
 */
export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!sessionId) return;

  const supabase = getSupabase();

  await supabase.from('laia_messages').insert({
    session_id: sessionId,
    role,
    content,
    metadata: metadata ?? {},
  });

  await supabase
    .from('laia_sessions')
    .update({ ultima_msg_em: new Date().toISOString() })
    .eq('id', sessionId);
}
