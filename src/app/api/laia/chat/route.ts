// POST /api/laia/chat
// Gateway slim — dashboard chat handler.
// Logic lives in adapters/dashboard.ts (session, history, save) and brain.ts (pipeline).

import { NextRequest, NextResponse } from 'next/server';
import {
  parseChatToRequest,
  formatDashboardResponse,
  getOrCreateDashboardSession,
  saveMessage,
  type DashboardChatBody,
} from '@/lib/alia/adapters/dashboard';
import { process as aliaBrain } from '@/lib/alia/brain';

export async function POST(req: NextRequest) {
  // 1. Validate API key
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  // 2. Parse body
  let body: DashboardChatBody;
  try {
    body = (await req.json()) as DashboardChatBody;
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  // 3. Validate message
  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'message é obrigatório' }, { status: 400 });
  }

  try {
    // 4. Get or create session
    const sessionId = await getOrCreateDashboardSession(body.session_id, body.agente);

    // 5. Save user message
    await saveMessage(sessionId, 'user', body.message);

    // 6. Build AliaRequest
    const aliaRequest = parseChatToRequest(body, sessionId);

    // 7. Run brain pipeline
    const aliaResponse = await aliaBrain(aliaRequest);

    // 8. Save assistant message
    const messageId = await saveMessage(sessionId, 'assistant', aliaResponse.text, {
      agente: aliaResponse.agent_used,
      model: aliaResponse.model_used,
      suggestions: aliaResponse.suggestions,
    });

    // 9. Return formatted response
    return NextResponse.json(formatDashboardResponse(aliaResponse, sessionId, messageId));
  } catch (err) {
    console.error('[laia/chat]', err);
    return NextResponse.json({ error: 'Falha ao processar resposta da IA' }, { status: 500 });
  }
}
