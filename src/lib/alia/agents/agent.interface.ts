// src/lib/alia/agents/agent.interface.ts
// Standard interface that every ALIA agent implements.

import type { AgentType } from '../types';
import type { AliaMemory } from '../types';

// ── Agent Context ────────────────────────────────────────────────────────────

export interface AgentContext {
  memories: AliaMemory[];
  ragContext?: string;
  crossModuleData?: Record<string, unknown>;
  gabineteId: string;
  sessionId: string;
  channel: string;
}

// ── Agent Result ─────────────────────────────────────────────────────────────

export interface AgentResult {
  success: boolean;
  content: string;
  structured?: Record<string, unknown>;
  actions_taken?: string[];
  suggested_memories?: Array<{
    tipo: 'preference' | 'decision' | 'relation' | 'pattern';
    subject: string;
    content: string;
  }>;
}

// ── Agent Interface ──────────────────────────────────────────────────────────

export interface AliaAgent {
  name: AgentType;
  description: string;

  execute(params: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult>;
}
