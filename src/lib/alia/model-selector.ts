// src/lib/alia/model-selector.ts
// Selects AI model per agent type and complexity signals.

import type { AgentType, ChannelType } from './types';

export type ModelId =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-6'
  | 'groq-whisper';

interface ModelConfig {
  default: ModelId;
  upgrade?: ModelId;
}

const AGENT_MODELS: Record<AgentType, ModelConfig> = {
  cadin:       { default: 'gemini-2.5-flash' },
  indicacao:   { default: 'gemini-2.5-flash' },
  agenda:      { default: 'gemini-2.5-flash' },
  oficio:      { default: 'gemini-2.5-flash' },
  ordem_dia:   { default: 'gemini-2.5-flash' },
  comissao:    { default: 'gemini-2.5-flash' },
  general:     { default: 'gemini-2.5-flash' },
  parecer:     { default: 'gemini-2.5-pro', upgrade: 'claude-sonnet-4-6' },
  relator:     { default: 'gemini-2.5-pro', upgrade: 'claude-sonnet-4-6' },
  pls:         { default: 'claude-sonnet-4-6' },
  crossmodule: { default: 'claude-sonnet-4-6' },
  email:       { default: 'gemini-2.5-flash', upgrade: 'claude-sonnet-4-6' },
  sessao:      { default: 'gemini-2.5-flash' },
};

export interface ComplexitySignals {
  multiIntent?: boolean;
  longContext?: boolean;
  legalAnalysis?: boolean;
  crossModule?: boolean;
}

export function selectModel(
  agent: AgentType,
  channel: ChannelType,
  signals?: ComplexitySignals,
): ModelId {
  const config = AGENT_MODELS[agent] ?? AGENT_MODELS.general;

  if (config.upgrade && signals) {
    const shouldUpgrade =
      signals.multiIntent ||
      signals.legalAnalysis ||
      signals.crossModule ||
      signals.longContext;

    if (shouldUpgrade) return config.upgrade;
  }

  return config.default;
}

export function isGeminiModel(model: ModelId): boolean {
  return model.startsWith('gemini-');
}

export function isClaudeModel(model: ModelId): boolean {
  return model.startsWith('claude-');
}
