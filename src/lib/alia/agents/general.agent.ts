// src/lib/alia/agents/general.agent.ts
// ALIA Agent: General — conversa geral usando contexto RAG e memórias da sessão.
// Chama Gemini diretamente com o system prompt da ALIA e o contexto disponível.

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

// ── System prompt base ────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `Você é ALIA — Assessora Legislativa Inteligente e Autônoma do Gabinete da Vereadora Carol Dantas (Câmara Municipal de Boa Vista/RR).

**PÚBLICO:** Este widget é usado pela equipe do gabinete — assessores, secretários e a própria vereadora. Trate todos com formalidade e respeito. Responda diretamente à pergunta sem preâmbulos de apresentação a cada mensagem.

**REGRAS:**
- Seja direta, objetiva e profissional.
- Use linguagem formal mas acessível.
- Quando não souber algo com certeza, diga claramente.
- NUNCA invente dados de contato, IDs, números de protocolo ou informações do SAPL.
- Use sempre markdown estruturado — **negrito** para nomes e cargos, listas com marcadores.

**PROIBIDO:** NUNCA inclua definições conceituais, históricas ou enciclopédicas. Entregue apenas informações práticas e objetivas.`;

// ── Agent export ─────────────────────────────────────────────────────────────

export const generalAgent: AliaAgent = {
  name: 'general',
  description: 'Agente de conversa geral — responde perguntas usando contexto RAG, memórias e o system prompt da ALIA via Gemini.',

  async execute({ data, context, model }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return { success: false, content: 'GEMINI_API_KEY não configurada.' };
      }

      const userMessage = (data.text as string) || '';
      if (!userMessage.trim()) {
        return { success: false, content: 'Nenhuma mensagem para processar.' };
      }

      // Monta system prompt com contexto RAG e memórias
      const hoje = new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
      let systemPrompt = BASE_SYSTEM_PROMPT + `\n\n**CONTEXTO TEMPORAL:** Hoje é ${hoje}.`;

      if (context.ragContext) {
        systemPrompt += `\n\n**CONTEXTO DA BASE DE CONHECIMENTO:**\n${context.ragContext}`;
      }

      if (context.memories?.length) {
        const memoriaTexto = context.memories
          .slice(0, 10)
          .map(m => `- [${m.tipo}] ${m.subject}: ${m.content}`)
          .join('\n');
        systemPrompt += `\n\n**MEMÓRIAS DA SESSÃO:**\n${memoriaTexto}`;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const gemini = genAI.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      });

      const result = await gemini.generateContent(userMessage);
      const text = result.response.text().trim();

      if (!text) {
        return { success: false, content: 'O modelo não retornou resposta.' };
      }

      return {
        success: true,
        content: text,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro no agente geral: ${msg}` };
    }
  },
};
