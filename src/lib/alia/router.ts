// =============================================================================
// ALIA RAG Router — Detecta domínios relevantes por intenção da mensagem
// Evita buscar em todos os 6 domínios toda vez (reduz latência e custo)
// NULL = busca em todos (fallback seguro para perguntas abertas)
// =============================================================================

import type { Dominio } from './rag';

interface RouteSignal {
  keywords: string[];
  dominios: Dominio[];
  boost?: number; // peso da regra (default 1)
}

const SIGNALS: RouteSignal[] = [
  // ── CADIN: autoridades, contatos, órgãos ────────────────────────────────
  {
    keywords: [
      'secretário','secretaria','secretária','prefeito','governador',
      'vereador','deputado','autoridade','contato','telefone','email',
      'chefe de gabinete','quem é','quem ocupa','quem responde',
      'responsável','titular','cargo','órgão','autarquia','fundação',
      'empresa pública','procurador','juiz','desembargador',
    ],
    dominios: ['cadin'],
    boost: 2,
  },

  // ── CADIN: aniversários ──────────────────────────────────────────────────
  {
    keywords: [
      'aniversário','aniversários','aniversariante','aniversariantes',
      'nasceu','faz anos','parabéns','niver','aniver','data de nascimento',
      'quem faz aniversário','quem nasceu','aniversário hoje',
      'janeiro','fevereiro','março','abril','maio','junho',
      'julho','agosto','setembro','outubro','novembro','dezembro',
    ],
    dominios: ['cadin'],
    boost: 3,
  },

  // ── SAPL: matérias, tramitações, sessões, comissões ─────────────────────
  {
    keywords: [
      'pl','pll','pec','projeto de lei','projeto','tramitação','tramita',
      'comissão','parecer','sessão','plenária','matéria','votação',
      'ordem do dia','sapl','protocolo','protocolar','autoria','ementa',
      'segunda discussão','primeira discussão','requerimento','moção',
      'indicação sapl','indicação legislativa','voto','aprovado','rejeitado',
    ],
    dominios: ['sapl', 'legislacao'],
    boost: 2,
  },

  // ── LEGISLAÇÃO: leis, CF, regimento interno, resoluções ─────────────────
  {
    keywords: [
      'artigo','art.','art ','lei','constituição','cf/88','emenda',
      'resolução','decreto','regimento','ri ','norma','dispositivo',
      'inciso','parágrafo','alínea','caput','Lei Orgânica',
      'lei municipal','lei estadual','lei federal','código','estatuto',
    ],
    dominios: ['legislacao'],
    boost: 2,
  },

  // ── JURISPRUDÊNCIA: súmulas, acórdãos, tribunais ────────────────────────
  {
    keywords: [
      'súmula','jurisprudência','stf','stj','tjrr','acórdão','decisão',
      'precedente','julgamento','ministro do stf','tribunal','recurso',
      'constitucional','inconstitucional','ação direta','adpf','re ','resp ',
    ],
    dominios: ['jurisprudencia', 'legislacao'],
    boost: 2,
  },

  // ── REDAÇÃO OFICIAL: ofícios, requerimentos, documentos ─────────────────
  {
    keywords: [
      'ofício','memorando','requerimento','redigir','elaborar','escrever',
      'documento oficial','comunicado','correspondência','carta',
      'itamaraty','fecho','vocativo','destinatário','minuta','modelo',
      'como escrever','como redigir','como enderençar','tratamento',
    ],
    dominios: ['redacao', 'legislacao'],
    boost: 2,
  },

  // ── INDICAÇÕES DE CAMPO: demandas, obras, equipe ────────────────────────
  {
    keywords: [
      'indicação','demanda','obra','tapa-buraco','buraco','iluminação',
      'foto','georreferência','gps','áudio','depoimento','vistoria',
      'equipe de campo','protocolar indicação','saneamento','calçada',
      'pavimentação','rua','bairro','esgoto','lixo','limpeza','poda',
      'como fazer indicação','como protocolar','passo a passo',
      'equipe','campo','moradores','comunidade',
    ],
    dominios: ['indicacoes', 'sapl'],
    boost: 2,
  },
];

/**
 * Retorna domínios a buscar com base nas keywords da mensagem.
 * Ordena por boost/frequência de match — domínios mais relevantes primeiro.
 * Retorna NULL se nenhum sinal detectado → busca em todos os domínios.
 */
export function routeDominios(message: string): Dominio[] | null {
  const lower = message.toLowerCase();
  const scores = new Map<Dominio, number>();

  for (const signal of SIGNALS) {
    const matched = signal.keywords.filter(kw => lower.includes(kw));
    if (matched.length > 0) {
      const score = matched.length * (signal.boost ?? 1);
      for (const d of signal.dominios) {
        scores.set(d, (scores.get(d) ?? 0) + score);
      }
    }
  }

  if (scores.size === 0) return null; // sem sinal → busca geral

  // Ordena domínios por score descendente
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);
}
