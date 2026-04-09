// src/lib/alia/gateway.ts
// Normalizes input from any channel into AliaRequest and formats output.

import type { AgentType, ChannelType, RenderMode } from './types';

// ── Request ──────────────────────────────────────────────────────────────────

export interface MediaAttachment {
  type: 'image' | 'audio' | 'document' | 'video';
  base64: string;
  filename?: string;
  mime: string;
  caption?: string;
}

export interface AliaRequest {
  channel: ChannelType;
  session_id: string;
  gabinete_id: string;
  sender: {
    phone?: string;
    profile_id?: string;
    email?: string;
    name: string;
  };
  content: {
    text: string;
    media?: MediaAttachment[];
  };
  page_context?: string;
  timestamp: string;
  is_proactive: boolean;
}

// ── Response ─────────────────────────────────────────────────────────────────

export interface AliaAction {
  tool: string;
  params: Record<string, unknown>;
  result: string;
}

export interface AliaResponse {
  text: string;
  channel_format: {
    whatsapp?: string;
    dashboard?: string;
    email?: string;
  };
  actions: AliaAction[];
  memories_created: string[];
  agent_used: AgentType;
  model_used: string;
  suggestions?: string[];
  render_mode?: RenderMode;
}
