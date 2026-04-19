/**
 * Preços por 1M tokens (USD) — atualizar quando providers mudarem.
 * Fontes:
 *   - Gemini: https://ai.google.dev/pricing (consultado 2026-04-16)
 *   - Anthropic: https://www.anthropic.com/pricing (consultado 2026-04-16)
 *
 * Usado pra estimar cost_usd em alia_agent_runs. Margem de erro aceitável:
 * ±10% comparado com fatura real (vide spec seção 9 Riscos).
 */

export interface ModelPricing {
  inputPerMillion: number;   // USD por 1M tokens de input
  outputPerMillion: number;  // USD por 1M tokens de output
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Gemini
  'gemini-2.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-2.5-pro':   { inputPerMillion: 1.25,  outputPerMillion: 10.00 },
  'gemini-2.0-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },

  // Anthropic
  'claude-sonnet-4-6': { inputPerMillion: 3.00,  outputPerMillion: 15.00 },
  'claude-opus-4-7':   { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'claude-haiku-4-5':  { inputPerMillion: 0.80,  outputPerMillion: 4.00 },
};

/**
 * Calcula custo USD de um run dado modelo + tokens.
 * Retorna null se o modelo não estiver na tabela (não falha — apenas não estima).
 */
export function estimateCostUsd(
  model: string,
  tokensInput: number | null,
  tokensOutput: number | null,
): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  if (tokensInput == null && tokensOutput == null) return null;

  const inCost  = ((tokensInput  ?? 0) / 1_000_000) * pricing.inputPerMillion;
  const outCost = ((tokensOutput ?? 0) / 1_000_000) * pricing.outputPerMillion;
  return Number((inCost + outCost).toFixed(6));
}
