// =============================================================================
// Dashboard Adapter — Chat ↔ AliaRequest/AliaResponse Conversion
//
// Converts incoming dashboard chat messages to ALIA gateway format
// and formats responses back for the dashboard UI.
//
// Database: alia_sessions (session management), alia_messages (history)
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import type { AliaRequest, AliaResponse } from '../gateway';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DashboardChatBody {
  message: string;
  agente?: string;
  session_id?: string;
  page_context?: string;
}

// ── Singleton DB ──────────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── parseChatToRequest ────────────────────────────────────────────────────────
// Converts DashboardChatBody into AliaRequest format.
//
// Params:
//   body: DashboardChatBody with message, optional agente, session_id, page_context
//   sessionId: Session ID from the request or body
//   profileId: Optional profile ID of the current user (assessor)
//
// Returns: AliaRequest ready for the ALIA core engine

export function parseChatToRequest(
  body: DashboardChatBody,
  sessionId: string,
  profileId?: string,
): AliaRequest {
  const gabineteId = process.env.GABINETE_ID!;

  return {
    channel: 'dashboard',
    session_id: sessionId,
    gabinete_id: gabineteId,
    sender: {
      profile_id: profileId,
      name: 'Assessor',
    },
    content: {
      text: body.message,
    },
    page_context: body.page_context,
    timestamp: new Date().toISOString(),
    is_proactive: false,
  };
}

// ── formatDashboardResponse ────────────────────────────────────────────────────
// Converts AliaResponse into dashboard JSON format.
//
// Params:
//   response: AliaResponse from ALIA core engine
//   sessionId: The session ID for context
//   messageId: Optional message ID if already saved in DB
//
// Returns: Formatted response object for dashboard consumption
//
// Extracts <chips> blocks from content:
//   Example: "Some text\n<chips>\n- Chip 1\n- Chip 2\n</chips>"
//   Parsed as: ["Chip 1", "Chip 2"]

export function formatDashboardResponse(
  response: AliaResponse,
  sessionId: string,
  messageId?: string,
): Record<string, unknown> {
  // Extract chips from content
  const chipsRegex = /<chips>([\s\S]*?)<\/chips>/;
  const chipsMatch = response.text.match(chipsRegex);
  let chips: string[] = [];
  let cleanContent = response.text;

  if (chipsMatch && chipsMatch[1]) {
    chips = chipsMatch[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^- /, '').trim());

    // Remove chips block from content
    cleanContent = response.text.replace(chipsRegex, '').trim();
  }

  return {
    session_id: sessionId,
    message_id: messageId,
    role: 'assistant',
    content: cleanContent,
    chips,
    suggestions: response.suggestions || [],
    agente: response.agent_used,
    model: response.model_used,
    created_at: new Date().toISOString(),
  };
}

// ── getOrCreateDashboardSession ────────────────────────────────────────────────
// Retrieves or creates a dashboard session.
//
// Params:
//   sessionId: Optional existing session ID to verify
//   agente: Agent type for this session
//
// Returns: The session ID (either verified existing or newly created)
//
// Flow:
//   1. If sessionId provided, verify it exists in alia_sessions
//   2. If not found or not provided, create new session with canal='interno'
//   3. Fallback to crypto.randomUUID() if DB fails

export async function getOrCreateDashboardSession(
  sessionId?: string,
  agente?: string,
): Promise<string> {
  const gabineteId = process.env.GABINETE_ID!;

  try {
    // If sessionId provided, verify it exists
    if (sessionId) {
      const { data: existingSession, error: queryError } = await db()
        .from('alia_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('gabinete_id', gabineteId)
        .eq('canal', 'interno')
        .single();

      if (!queryError && existingSession) {
        return sessionId;
      }
    }

    // Create new session
    const newSessionId = randomUUID();
    const { error: insertError } = await db()
      .from('alia_sessions')
      .insert({
        id: newSessionId,
        gabinete_id: gabineteId,
        canal: 'interno',
        agente,
        criado_em: new Date().toISOString(),
      });

    if (insertError) {
      console.error('[Dashboard] Failed to create session:', insertError.message);
      // Fallback to random UUID if insert fails
      return randomUUID();
    }

    return newSessionId;
  } catch (err) {
    console.error('[Dashboard] Session creation exception:', err);
    return randomUUID();
  }
}

// ── saveMessage ────────────────────────────────────────────────────────────────
// Saves a message to alia_messages table.
//
// Params:
//   sessionId: The session ID for this message
//   role: 'user' or 'assistant'
//   content: The message content
//   metadata: Optional additional metadata (agente, model, chips, etc.)
//
// Returns: The message ID if successful, undefined on error

export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    const messageId = randomUUID();

    const { error } = await db()
      .from('alia_messages')
      .insert({
        id: messageId,
        session_id: sessionId,
        role,
        content,
        metadata: metadata || null,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[Dashboard] Failed to save message:', error.message);
      return undefined;
    }

    return messageId;
  } catch (err) {
    console.error('[Dashboard] Save message exception:', err);
    return undefined;
  }
}

// ── fetchHistory ────────────────────────────────────────────────────────────────
// Fetches conversation history from alia_messages.
//
// Params:
//   sessionId: The session ID to fetch history for
//   limit: Maximum number of messages to return (default 20)
//
// Returns: Array of messages in conversation format
//   - role: 'user' | 'model' (assistant → model for consistency)
//   - content: The message text
//
// Ordered ascending by created_at (oldest first, for context building)

export async function fetchHistory(
  sessionId: string,
  limit: number = 20,
): Promise<Array<{ role: string; content: string }>> {
  try {
    const { data: messages, error } = await db()
      .from('alia_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[Dashboard] Failed to fetch history:', error.message);
      return [];
    }

    if (!messages) {
      return [];
    }

    // Map role: 'assistant' → 'model', else 'user'
    return messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      content: msg.content,
    }));
  } catch (err) {
    console.error('[Dashboard] Fetch history exception:', err);
    return [];
  }
}
