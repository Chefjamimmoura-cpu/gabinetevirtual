// src/lib/alia/classifier.ts
// Intent classifier for routing requests to appropriate agents.
// Uses keyword matching with boost signals and page context.

import { AgentType, ChannelType } from './types';

// ── Intent Interface ──────────────────────────────────────────────────────────

export interface Intent {
  agent: AgentType;
  action: string;
  confidence: number;
  priority: number;
}

// ── Keyword Database ──────────────────────────────────────────────────────────

interface KeywordSignal {
  keywords: string[];
  agent: AgentType;
  action: string;
  boost: number;
}

const KEYWORD_SIGNALS: KeywordSignal[] = [
  // CADIN: Authorities/Contacts
  {
    keywords: ['secretário', 'prefeito', 'governador', 'autoridade', 'contato', 'telefone', 'quem é', 'cargo', 'órgão'],
    agent: 'cadin',
    action: 'consultar',
    boost: 2,
  },
  // CADIN: Birthdays
  {
    keywords: ['aniversário', 'aniversariante', 'nasceu', 'faz anos', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
    agent: 'cadin',
    action: 'aniversarios',
    boost: 3,
  },
  // Indicações: Demands
  {
    keywords: ['indicação', 'demanda', 'buraco', 'iluminação', 'tapa-buraco', 'bairro'],
    agent: 'indicacao',
    action: 'registrar',
    boost: 2,
  },
  // Pareceres: Legal Opinions
  {
    keywords: ['parecer', 'relator', 'voto', 'favorável', 'contrário', 'comissão', 'matéria', 'pl', 'pll'],
    agent: 'parecer',
    action: 'gerar',
    boost: 2,
  },
  // Ordem do Dia: Session Orders
  {
    keywords: ['ordem do dia', 'pauta', 'sessão', 'plenária', 'votação', 'discussão'],
    agent: 'ordem_dia',
    action: 'consultar',
    boost: 2,
  },
  // Ofícios: Official Documents
  {
    keywords: ['ofício', 'carta', 'correspondência', 'minuta', 'redação oficial'],
    agent: 'oficio',
    action: 'criar',
    boost: 2,
  },
  // Agenda: Events
  {
    keywords: ['agenda', 'evento', 'compromisso', 'reunião', 'agendar', 'calendário'],
    agent: 'agenda',
    action: 'marcar',
    boost: 1,
  },
  // Comissões: Committees
  {
    keywords: ['comissão', 'cljrf', 'cof', 'casp', 'cecej', 'membros', 'composição'],
    agent: 'comissao',
    action: 'consultar',
    boost: 2,
  },
  // Sessões: Session Transcription
  {
    keywords: ['transcrição', 'transcrever', 'áudio', 'sessão gravada'],
    agent: 'sessao',
    action: 'transcrever',
    boost: 2,
  },
  // PLS: Legal Project/Analysis
  {
    keywords: ['projeto de lei', 'redigir lei', 'análise jurídica', 'lc 95'],
    agent: 'pls',
    action: 'redigir',
    boost: 2,
  },
  // Email: Email Triage
  {
    keywords: ['email', 'e-mail', 'caixa de entrada', 'inbox'],
    agent: 'email',
    action: 'triagem',
    boost: 1,
  },
  // CADIN: Caderno PDF
  {
    keywords: ['caderno', 'pdf', 'exportar', 'caderno de autoridades'],
    agent: 'cadin',
    action: 'gerar_caderno',
    boost: 2,
  },
  // Cross-module: explicit cross-data queries
  {
    keywords: [
      'cruzar', 'cruzamento', 'relacionar', 'relação entre',
      'quem tem indicação', 'autoridade e indicação',
      'ofício e indicação', 'tudo sobre', 'resumo completo',
      'visão geral', 'panorama',
    ],
    agent: 'crossmodule',
    action: 'consultar',
    boost: 3,
  },
  // Consulta Matéria: busca de matérias legislativas no SAPL
  {
    keywords: [
      'ementa', 'autoria', 'autor', 'tramitação', 'tramitacao',
      'consultar matéria', 'consultar materia',
      'sobre o que é', 'sobre o que e',
      'qual projeto', 'ficha',
      'PLL', 'PLE', 'PLO', 'REQ', 'IND', 'RLO', 'PDL',
    ],
    agent: 'consulta_materia',
    action: 'consultar',
    boost: 3.0,
  },
];

// ── Page Context Mapping ──────────────────────────────────────────────────────

interface PageContextMap {
  [key: string]: AgentType;
}

const PAGE_CONTEXT_MAP: PageContextMap = {
  pareceres: 'parecer',
  relator: 'relator',
  indicacoes: 'indicacao',
  oficios: 'oficio',
  pls: 'pls',
  cadin: 'cadin',
  agenda: 'agenda',
  email: 'email',
  sessao: 'sessao',
  sessoes: 'sessao',
  'ordem-dia': 'ordem_dia',
  'ordem_dia': 'ordem_dia',
  comissoes: 'comissao',
  comissão: 'comissao',
};

// ── Classification Function ───────────────────────────────────────────────────

/**
 * Classifies user intent based on keyword matching and page context.
 * Returns array of intents sorted by confidence (descending).
 * Defaults to 'general' agent if nothing matches.
 *
 * @param text - User input text to classify
 * @param pageContext - Optional current page context (e.g., 'pareceres', 'cadin')
 * @returns Array of Intent objects sorted by confidence descending
 */
export function classifyIntent(text: string, pageContext?: string): Intent[] {
  if (!text || typeof text !== 'string') {
    return [
      {
        agent: 'general',
        action: 'assist',
        confidence: 0.5,
        priority: 0,
      },
    ];
  }

  const normalizedText = text.toLowerCase();
  const intentScores: Map<string, { agent: AgentType; action: string; score: number }> = new Map();

  // ── Step 1: Score agents by keyword matches ────────────────────────────────

  for (const signal of KEYWORD_SIGNALS) {
    let matchCount = 0;

    for (const keyword of signal.keywords) {
      // Check for whole word match (not substring)
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const matches = normalizedText.match(regex);
      if (matches) {
        matchCount += matches.length;
      }
    }

    if (matchCount > 0) {
      const key = `${signal.agent}:${signal.action}`;
      const score = Math.min((matchCount * signal.boost) / 6, 1);

      if (!intentScores.has(key)) {
        intentScores.set(key, {
          agent: signal.agent,
          action: signal.action,
          score,
        });
      } else {
        // Keep the highest score if this agent/action combo already exists
        const existing = intentScores.get(key)!;
        if (score > existing.score) {
          existing.score = score;
        }
      }
    }
  }

  // ── Step 2: Apply page context boosting ────────────────────────────────────

  if (pageContext) {
    const normalizedContext = pageContext.toLowerCase();
    const contextAgent = PAGE_CONTEXT_MAP[normalizedContext];

    if (contextAgent) {
      // Boost any intent matching the page context agent by +3 priority
      // (we apply this as a priority boost rather than confidence boost)
      intentScores.forEach((value) => {
        if (value.agent === contextAgent) {
          value.score = Math.min(value.score + 0.3, 1); // Cap at 1.0
        }
      });

      // If no matches found, add the page context agent as a fallback
      if (intentScores.size === 0) {
        intentScores.set(`${contextAgent}:default`, {
          agent: contextAgent,
          action: 'default',
          score: 0.6, // Medium confidence for page context alone
        });
      }
    }
  }

  // ── Step 3: Convert scores to Intent objects ───────────────────────────────

  let intents: Intent[] = [];

  if (intentScores.size === 0) {
    // Default to general agent
    intents = [
      {
        agent: 'general',
        action: 'assist',
        confidence: 0.5,
        priority: 0,
      },
    ];
  } else {
    const intentsArray: Intent[] = [];
    intentScores.forEach((value) => {
      intentsArray.push({
        agent: value.agent,
        action: value.action,
        confidence: value.score,
        priority: 0, // Will be updated after sorting
      });
    });

    // Sort by confidence descending
    intentsArray.sort((a, b) => b.confidence - a.confidence);

    // Update priority based on sorted order
    intentsArray.forEach((intent, index) => {
      intent.priority = index;
    });

    intents = intentsArray;
  }

  return intents;
}

// ── Multi-Intent Detection ────────────────────────────────────────────────────

/**
 * Determines if multiple agents are equally viable for the request.
 * Returns true if the top 2 intents have similar confidence (diff < 0.3).
 *
 * @param intents - Array of Intent objects (typically from classifyIntent)
 * @returns true if multi-intent (ambiguous), false if single primary intent
 */
export function isMultiIntent(intents: Intent[]): boolean {
  if (!intents || intents.length < 2) {
    return false;
  }

  const top1 = intents[0];
  const top2 = intents[1];

  // If confidence difference is less than 0.3, consider it multi-intent
  return Math.abs(top1.confidence - top2.confidence) < 0.3;
}

// ── Utility: Get primary intent ───────────────────────────────────────────────

/**
 * Returns the single most confident intent from the list.
 * Convenience function for simple routing.
 *
 * @param intents - Array of Intent objects
 * @returns Primary (highest confidence) Intent
 */
export function getPrimaryIntent(intents: Intent[]): Intent {
  return intents[0] || {
    agent: 'general',
    action: 'assist',
    confidence: 0.5,
    priority: 0,
  };
}

// ── Utility: Filter intents by agent ──────────────────────────────────────────

/**
 * Returns intents for specific agent(s).
 *
 * @param intents - Array of Intent objects
 * @param agents - Agent type(s) to filter by
 * @returns Filtered intents
 */
export function filterIntentsByAgent(intents: Intent[], agents: AgentType | AgentType[]): Intent[] {
  const agentList = Array.isArray(agents) ? agents : [agents];
  return intents.filter((intent) => agentList.includes(intent.agent));
}
