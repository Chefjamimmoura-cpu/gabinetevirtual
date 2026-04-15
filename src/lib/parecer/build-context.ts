// ═══════════════════════════════════════════
// BUILD CONTEXT — Monta contexto de matérias para o Gemini
// Portado de cmbv-parecer/src/prompts.js
// ═══════════════════════════════════════════

import { SAPL_BASE, VOTING_KEYWORDS, PROC_KEYS, SIGLAS_COMISSOES } from './prompts';
import type { SaplMateria, SaplDocumento, SaplTramitacao } from '../sapl/client';
import { extractTextFlateDecode, extractTextFromPdfBuffer, detectVoteInText } from '../sapl/ocr';

/** Mapa de docId → texto extraído do PDF (pré-carregado antes da geração do parecer) */
export type DocContentMap = Map<number, string>;

// ── Normalização de nomes de comissão para deduplicação ───────
// "Comissão de Saúde e Assistência Social" → "saude assistencia social e meio ambiente"
// Normaliza acentos para evitar duplicatas por variação ortográfica (ex: "Assistência" vs "Assistencia")
function normalizeCommissionName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos: "Saúde" → "saude"
    .replace(/[,;]/g, ' ')                             // vírgulas viram espaço
    .replace(/^comiss\S*\s+(de|do|da|dos|das)\s+/i, '') // remove "Comissão de/da/do" (qualquer forma após "comiss")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Detecção de "comissão acompanha relator" ──────────────────
// Quando a comissão aprova o voto do relator, o voto que vale é o do relator —
// não o da comissão. Detecta esse padrão para propagar o voto do relator.
const RELATOR_AGREEMENT_PHRASES = [
  'FAVORÁVEL AO VOTO DO RELATOR',
  'FAVORÁVEL COM O RELATOR',
  'FAVORÁVEL COM O VOTO DO RELATOR',
  'APROVADO O VOTO DO RELATOR',
  'APROVAÇÃO DO VOTO DO RELATOR',
  'ACOMPANHA O RELATOR',
  'ACOMPANHOU O RELATOR',
  'ACOMPANHA O VOTO DO RELATOR',
  'CONFORME VOTO DO RELATOR',
  'DE ACORDO COM O RELATOR',
  'ACOLHE O VOTO DO RELATOR',
  'VOTO DO RELATOR APROVADO',
  'APROVANDO O VOTO DO RELATOR',
  'PELO VOTO DO RELATOR',
];

function commissionFollowsRelatorInText(text: string): boolean {
  const upper = text.toUpperCase();
  return RELATOR_AGREEMENT_PHRASES.some(p => upper.includes(p));
}

// ── Pré-carregamento de texto dos documentos acessórios ───────
// Baixa PDFs de comissões/procuradoria e extrai texto via FlateDecode (sem OCR).
// Limites rígidos para não bloquear a geração do parecer:
//   • 5s por documento
//   • Máx 30 documentos no total
//   • 5 downloads em paralelo
// O texto extraído permite detectar "FAVORÁVEL AO VOTO DO RELATOR" e outros padrões.
export async function fetchCommissionDocContents(
  materias: SaplMateria[],
): Promise<DocContentMap> {
  const map: DocContentMap = new Map();

  // Coleta docs relevantes (comissão / relator / procuradoria) que têm arquivo
  const targets: Array<{ id: number; arquivo: string }> = [];
  for (const m of materias) {
    for (const d of m._docs || []) {
      if (!d.arquivo || !d.id) continue;
      const combined = `${d.nome || ''} ${d.autor || ''} ${d.__str__ || ''} ${d.indexacao || ''}`.toLowerCase();
      const isRelevant =
        combined.includes('procuradoria') || combined.includes('jurídico') ||
        combined.includes('juridico')     || combined.includes('comissão') ||
        combined.includes('comissao')     || combined.includes('relator')  ||
        combined.includes('parecer');
      if (isRelevant) targets.push({ id: d.id, arquivo: d.arquivo });
    }
  }

  // Limita a 30 docs (evita travar sessões grandes)
  const limited = targets.slice(0, 30);

  // Baixa em lotes de 5 com timeout de 5s cada
  for (let i = 0; i < limited.length; i += 5) {
    const batch = limited.slice(i, i + 5);
    await Promise.all(
      batch.map(async ({ id, arquivo }) => {
        try {
          const url = arquivo.startsWith('http') ? arquivo : `${SAPL_BASE}${arquivo}`;
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 CMBV-Gabinete/2.0' },
            signal: AbortSignal.timeout(10_000), // 10s máx por doc (pdftotext precisa do arquivo completo)
          });
          if (!res.ok) return;
          const buf = Buffer.from(await res.arrayBuffer());
          // Tenta FlateDecode (rápido); se o PDF for imagem, cai para OCR via tesseract.
          // Timeout de 25s para não bloquear a geração em VPS com OCR lento.
          const text = await Promise.race([
            extractTextFromPdfBuffer(buf),
            new Promise<string>(resolve => setTimeout(() => resolve(''), 30_000)),
          ]);
          const printable = (text.match(/[a-záéíóúãõâêôàüçA-ZÁÉÍÓÚÃÕÂÊÔÀÜÇ\s]/g) || []).length;
          if (printable > 30) map.set(id, text);
        } catch { /* timeout ou erro de rede — silencioso */ }
      }),
    );
  }

  return map;
}

// ── Extrator de voto da Procuradoria ──────────────────────
// Tenta determinar o resultado do parecer jurídico a partir
// de campos textuais do documento e tramitações próximas.
// Retorna 'FAVORÁVEL', 'CONTRÁRIO' ou 'NÃO IDENTIFICADO'.
function extractProcuradoriaVote(doc: SaplDocumento, tramits: SaplTramitacao[], docContent?: string): string {
  // Conteúdo real do PDF tem precedência sobre metadados
  if (docContent) {
    const voto = detectVoteInText(docContent);
    if (voto !== 'NÃO IDENTIFICADO') return voto;
  }

  const fields = [
    doc.indexacao || '',
    doc.nome || '',
    doc.__str__ || '',
    (doc.arquivo || '').split('/').pop() || '',
  ].join(' ').toUpperCase();

  if (
    fields.includes('INCONSTITUCIONAL') || fields.includes('CONTRÁRIO') ||
    fields.includes('CONTRARIO') || fields.includes('REJEITAD') ||
    fields.includes('ILEGAL') || fields.includes('IRREGULAR')
  ) return 'CONTRÁRIO';

  if (
    fields.includes('CONSTITUCIONAL') || fields.includes('FAVORÁVEL') ||
    fields.includes('FAVORAVEL') || fields.includes('APROVAD') ||
    fields.includes('SEM ÓBICE') || fields.includes('SEM OBICE') ||
    fields.includes('NÃO HÁ IMPEDIMENTO') || fields.includes('NAO HA IMPEDIMENTO')
  ) return 'FAVORÁVEL';

  // Busca em tramitações próximas que mencionem a procuradoria
  const docDateMs = new Date(doc.data || '2000-01-01').getTime();
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

  for (const t of tramits) {
    const tDateMs = new Date(t.data_tramitacao || '2000-01-01').getTime();
    if (Math.abs(tDateMs - docDateMs) > WINDOW_MS) continue;

    const tCombined = `${t.texto || ''} ${t.__str__ || ''}`.toUpperCase();
    const isProcRef = PROC_KEYS.some(k => tCombined.toLowerCase().includes(k));
    if (!isProcRef) continue;

    if (tCombined.includes('INCONSTITUCIONAL') || tCombined.includes('CONTRÁRIO') || tCombined.includes('CONTRARIO')) return 'CONTRÁRIO';
    if (tCombined.includes('CONSTITUCIONAL') || tCombined.includes('FAVORÁVEL') || tCombined.includes('FAVORAVEL') || tCombined.includes('SEM ÓBICE')) return 'FAVORÁVEL';
  }

  return 'NÃO IDENTIFICADO';
}

// Tipos numéricos do SAPL para documentos acessórios
const TIPO_PARECER_RELATOR = 1;
const TIPO_PARECER_COMISSAO = 16;
const TIPO_FOLHA_VOTACAO = 12;

// ── Helpers ────────────────────────────────────────────────

export function buildDocUrl(arquivo?: string): string {
  if (!arquivo) return '';
  return arquivo.startsWith('http') ? arquivo : `${SAPL_BASE}${arquivo}`;
}

export function isProcuradoriaDoc(d: SaplDocumento): boolean {
  const nome = (d.nome || '').toLowerCase();
  const autor = (d.autor || '').toLowerCase();
  const str = (d.__str__ || '').toLowerCase();
  const arquivo = (d.arquivo || '').split('/').pop()!.toLowerCase();
  const indexacao = (d.indexacao || '').toLowerCase();
  const space = `${nome} ${autor} ${str} ${arquivo} ${indexacao}`;

  if (PROC_KEYS.some(key => space.includes(key))) return true;

  const tipo = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
  if (tipo === 2 && nome.includes('parecer') && !autor.startsWith('comiss')) return true;

  return false;
}

const IMPACTO_KEYS = [
  'impacto financeiro', 'impacto fiscal', 'estudo de impacto',
  'nota de impacto', 'impacto_financeiro', 'impacto_fiscal',
  'estudo_de_impacto', 'nota_de_impacto',
];

export function isImpactoFinanceiroDoc(d: SaplDocumento): boolean {
  const nome = (d.nome || '').toLowerCase();
  const str = (d.__str__ || '').toLowerCase();
  const arquivo = (d.arquivo || '').split('/').pop()!.toLowerCase();
  const indexacao = (d.indexacao || '').toLowerCase();
  const space = `${nome} ${str} ${arquivo} ${indexacao}`;
  return IMPACTO_KEYS.some(key => space.includes(key));
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function resolveAuthorName(materia: SaplMateria): string {
  if (materia._autorias && materia._autorias.length > 0) {
    return materia._autorias.map(a => a.autor_nome || a.__str__ || '—').join(', ');
  }
  return materia.autor_nome || '—';
}

function extractComissaoName(doc: SaplDocumento): string {
  const autor = doc.autor || '';
  const autorLower = autor.toLowerCase();
  const strLower = (doc.__str__ || '').toLowerCase();
  const fileName = (doc.arquivo || '').split('/').pop()!.toLowerCase();
  const nomeLower = (doc.nome || '').toLowerCase();

  if (autorLower.startsWith('comiss')) return autor;

  const searchFields = [autorLower, strLower, fileName, nomeLower].join(' ');
  const sortedEntries = Object.entries(SIGLAS_COMISSOES).sort((a, b) => b[0].length - a[0].length);
  for (const [sigla, nomeCompleto] of sortedEntries) {
    if (searchFields.includes(sigla)) return nomeCompleto;
  }

  if (autor) return `Relator: ${autor}`;
  return 'Comissão não identificada';
}

/**
 * Constrói mapa de unidade_tramitacao_id → palavra-chave do nome da comissão.
 * Usa as tramitações "Segue para tramitação na Comissão Permanente de X" onde
 * unidade_tramitacao_destino = unidade física da comissão.
 * Permite identificar qual comissão emitiu o voto pelo campo unidade_tramitacao_local.
 */
function buildUnitMap(tramits: SaplTramitacao[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const t of tramits) {
    const dest = t.unidade_tramitacao_destino;
    if (!dest) continue;
    const texto = (t.texto || '').toLowerCase();
    // Ex: "segue para tramitação na comissão permanente de administração..."
    // Ex: "segue para tramitação na comissão permanente educação..."
    const m = texto.match(/comiss[aã]o\s+permanente\s+(?:de\s+|do\s+|da\s+)?([a-záàâãéêíóôõúç\s,]+?)(?:\s*,|\s+para|\s*$)/i);
    if (m) {
      const kw = m[1].trim().toLowerCase().split(/[\s,]+/)[0]; // primeira palavra significativa
      if (kw.length >= 4) map.set(dest, kw);
    }
  }
  return map;
}

function extractComissaoVote(
  doc: SaplDocumento,
  tramits: SaplTramitacao[],
  docContent?: string,
  unitMap?: Map<number, string>,
): string {
  // Prioridade 1: conteúdo real do PDF (OCR ou FlateDecode) — mais confiável
  if (docContent) {
    const votoDoc = detectVoteInText(docContent);
    if (votoDoc !== 'NÃO IDENTIFICADO') return votoDoc;
  }

  // Prioridade 2: metadados do documento (indexação, nome, filename)
  const indexacao = (doc.indexacao || '').toUpperCase();
  if (indexacao.includes('CONTRÁRIO') || indexacao.includes('CONTRARIO') || indexacao.includes('REJEITAD') || indexacao.includes('INCONSTITUCIONALIDADE') || indexacao.includes('DESFAVORÁVEL') || indexacao.includes('DESFAVORAVEL')) return 'CONTRÁRIO';
  if (indexacao.includes('FAVORÁVEL') || indexacao.includes('FAVORAVEL')) return 'FAVORÁVEL';

  const docStr = (doc.__str__ || '').toUpperCase();
  if (docStr.includes('CONTRÁRIO') || docStr.includes('CONTRARIO') || docStr.includes('INCONSTITUCIONALIDADE') || docStr.includes('DESFAVORÁVEL') || docStr.includes('DESFAVORAVEL')) return 'CONTRÁRIO';

  const arquivo = (doc.arquivo || '').split('/').pop()!.toLowerCase();
  if (arquivo.includes('desfavoravel') || arquivo.includes('desfavor')) return 'CONTRÁRIO';
  if (arquivo.includes('favoravel') && !arquivo.includes('desfavoravel')) return 'FAVORÁVEL';

  // Prioridade 3: tramitações
  // SAPL não inclui o nome da comissão nas tramitações de voto — apenas "Parecer favorável da comissão".
  // Usamos três estratégias de matching em ordem de precisão:
  //   a) unitMap: unidade_tramitacao_local → comissão (extraído de tramitações "Segue para Comissão X")
  //   b) comissaoKey: nome da comissão (12 chars) aparece no texto da tramitação
  //   c) genérico: "comissão" + voto explícito (último recurso, mesmo que CONTRÁRIO usa)
  const comissaoNome = extractComissaoName(doc);
  const comissaoNomeLower = comissaoNome.toLowerCase();
  const comissaoKey = comissaoNomeLower.replace(/^comiss[ãa]o\s+(de|do|da|dos|das)\s+/i, '').substring(0, 12);
  const docDateMs = new Date(doc.data || '2000-01-01').getTime();
  // Janela ampliada: 90 dias — SAPL frequentemente registra tramitações com data diferente do parecer
  const VOTE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

  for (const t of tramits) {
    const tDateMs = new Date(t.data_tramitacao || '2000-01-01').getTime();
    if (Math.abs(tDateMs - docDateMs) > VOTE_WINDOW_MS) continue;

    const tTexto = (t.texto || '').toUpperCase();
    const tStr = (t.__str__ || '').toUpperCase();
    const tLower = `${t.texto || ''} ${t.__str__ || ''}`.toLowerCase();

    // Estratégia a: unitMap — a tramitação veio da unidade desta comissão?
    const unitLocal = t.unidade_tramitacao_local;
    const unitKw = unitLocal ? unitMap?.get(unitLocal) : undefined;
    const unitMatchesThisCommission = unitKw
      ? comissaoNomeLower.includes(unitKw)
      : false;

    // Estratégia b: nome da comissão no texto
    const nameInText = tLower.includes(comissaoKey);

    // Estratégia c: "comissão" + voto explícito (SAPL usa "Parecer favorável da comissão")
    const genericCommissionVote =
      tLower.includes('comiss') && (
        tStr.includes('FAVORÁVEL') || tStr.includes('FAVORAVEL') ||
        tTexto.includes('CONTRÁRIO') || tTexto.includes('CONTRARIO') ||
        tStr.includes('PARECER CONTRÁRIO') || tStr.includes('CONTRÁRIO DA COMISSÃO')
      );

    const mentionsThisComission = unitMatchesThisCommission || nameInText || genericCommissionVote;
    if (!mentionsThisComission) continue;

    // CONTRÁRIO (verificado primeiro — mais crítico)
    if (tTexto.includes('INCONSTITUCIONALIDADE') || tTexto.includes('CONTRÁRIO') || tTexto.includes('CONTRARIO') ||
        tStr.includes('PARECER CONTRÁRIO') || tStr.includes('CONTRÁRIO DA COMISSÃO')) {
      return 'CONTRÁRIO';
    }

    // FAVORÁVEL — simétrico com CONTRÁRIO: aceita match genérico de "comissão"
    if (tStr.includes('FAVORÁVEL') || tStr.includes('FAVORAVEL') ||
        tTexto.includes('FAVORÁVEL') || tTexto.includes('FAVORAVEL')) {
      return 'FAVORÁVEL';
    }
  }

  return 'NÃO IDENTIFICADO';
}

// ── Normalização do resultado de _pareceres (endpoint SAPL) ───
// SAPL retorna: "Favorável", "APROVADO", "Aprovado", "Reprovado", "Pendente", etc.
// Normaliza para FAVORÁVEL / CONTRÁRIO / NÃO IDENTIFICADO para o Gemini.
function normalizeParecer(resultado: string): string {
  const u = resultado.toUpperCase();
  if (
    u.includes('FAVORÁVEL') || u.includes('FAVORAVEL') || u.includes('APROVAD') ||
    u.includes('CONSTITUCIONAL') || u.includes('SEM ÓBICE') || u.includes('SEM OBICE') ||
    u.includes('SEM OBJEÇÃO') || u.includes('SEM OBJECAO')
  ) return 'FAVORÁVEL';
  if (
    u.includes('CONTRÁRIO') || u.includes('CONTRARIO') || u.includes('DESFAVOR') ||
    u.includes('REJEITAD') || u.includes('REPROVAD') || u.includes('INCONSTITUCIONAL')
  ) return 'CONTRÁRIO';
  return resultado || 'NÃO IDENTIFICADO';
}

// ── inferDiscussionStage ───────────────────────────────────

export function inferDiscussionStage(materia: SaplMateria, tipoSigla: string, docs?: SaplDocumento[]): string {
  const tipo = (tipoSigla || '').toUpperCase();

  if (tipo === 'PDL') return 'ÚNICA DISCUSSÃO E VOTAÇÃO (HONRARIAS)';

  // Folha de Votação registrada → matéria JÁ foi votada em plenário → SEGUNDA DISCUSSÃO
  if (docs && docs.some(d => {
    const t = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
    return t === TIPO_FOLHA_VOTACAO;
  })) {
    return 'SEGUNDA DISCUSSÃO E VOTAÇÃO';
  }

  const tramits = materia._tramits || [];
  let hasSegunda = false;
  let hasAprovadaPrimeira = false;
  let hasPrimeira = false;

  for (const t of tramits) {
    const _statusObj383 = typeof t.status === 'object' ? t.status : null;
    const status = (_statusObj383?.descricao || _statusObj383?.sigla || '').toUpperCase();
    const texto = (t.texto || '').toUpperCase();
    const combined = `${status} ${texto}`;

    if (combined.includes('SEGUNDA DISCUSS') || combined.includes('2ª DISCUSS') || combined.includes('2A DISCUSS')) {
      hasSegunda = true; break;
    }
    if ((status.includes('APROVAD') || texto.includes('APROVAD')) &&
        (combined.includes('PRIMEIRA') || combined.includes('1ª') || combined.includes('1A'))) {
      hasAprovadaPrimeira = true;
    }
    if (combined.includes('PRIMEIRA DISCUSS') || combined.includes('1ª DISCUSS') || combined.includes('1A DISCUSS')) {
      hasPrimeira = true;
    }
  }

  if (hasSegunda || hasAprovadaPrimeira) return 'SEGUNDA DISCUSSÃO E VOTAÇÃO';

  const regime = (materia.regime_tramitacao?.descricao || '').toUpperCase();
  if (regime.includes('ÚNICA') || regime.includes('UNICA') || regime.includes('URGÊNCIA') || regime.includes('URGENCIA')) {
    return 'ÚNICA DISCUSSÃO E VOTAÇÃO';
  }

  if (hasPrimeira) return 'PRIMEIRA DISCUSSÃO E VOTAÇÃO';

  const numPareceresAPI = (materia._pareceres || []).length;
  const numPareceresDoc = (materia._docs || []).filter(d => {
    const tipoId = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
    return tipoId === TIPO_PARECER_RELATOR || tipoId === TIPO_PARECER_COMISSAO;
  }).length;
  if (numPareceresAPI + numPareceresDoc >= 2) return 'SEGUNDA DISCUSSÃO E VOTAÇÃO';

  return 'PRIMEIRA DISCUSSÃO E VOTAÇÃO';
}

// ── Filtro de Relevância (V3-F4) ──────────────────────────
// IND / REQ / MOC / RIV são "Expediente" — apenas listados, sem análise.
// PLL / PDL / PLC / PRE / LOA / LDO / PELOM / CEV / SBV / VET são "Ordem do Dia"
// e recebem análise jurídica completa com gasto de tokens Gemini.

const SIGLAS_EXPEDIENTE = new Set(['IND', 'REQ', 'MOC', 'RIV', 'REI', 'MEM']);

function isExpediente(materia: SaplMateria): boolean {
  const sigla = (
    materia.tipo_sigla ||
    (typeof materia.tipo === 'object' ? materia.tipo?.sigla : undefined) ||
    ''
  ).toUpperCase();
  return SIGLAS_EXPEDIENTE.has(sigla);
}

// ── buildMateriaContext ────────────────────────────────────

export function buildMateriaContext(
  materias: SaplMateria[],
  dataSessao?: string,
  sessaoStr?: string,
  folhaVotacaoUrl?: string | null,
  docVotes?: DocContentMap,
): string {
  const dataFormatada = dataSessao
    ? new Date(dataSessao + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  let context = `CONTEXTO FORNECIDO\n`;
  context += `DATA DA SESSÃO: ${dataFormatada}\n`;
  if (sessaoStr) context += `SESSÃO: ${sessaoStr}\n`;
  if (folhaVotacaoUrl) {
    context += `PAUTA DA SESSÃO (PDF): ${folhaVotacaoUrl}\n`;
    context += `FOLHA DE VOTAÇÃO URL: ${folhaVotacaoUrl}\n`;
  }
  // V3-F4: separa matérias de Expediente (IND/REQ/MOC) das Legislativas (PLs)
  const legislativas = materias.filter(m => !isExpediente(m));
  const expediente   = materias.filter(m =>  isExpediente(m));

  context += `TOTAL EXATO DE MATÉRIAS: ${materias.length}\n`;
  context += `  → Itens Legislativos (analisar): ${legislativas.length}\n`;
  context += `  → Expediente (listar apenas, sem análise): ${expediente.length}\n\n`;

  // Pré-calcula estágio de votação de cada matéria legislativa para montar sumário de blocos
  const blocosPorMateria = legislativas.map(m => {
    const sigla = m.tipo_sigla || (typeof m.tipo === 'object' ? (m.tipo as { sigla?: string })?.sigla : undefined) || '';
    return { m, bloco: inferDiscussionStage(m, sigla, m._docs || []) };
  });

  const blocoGroups: Map<string, number[]> = new Map();
  blocosPorMateria.forEach(({ bloco }, i) => {
    if (!blocoGroups.has(bloco)) blocoGroups.set(bloco, []);
    blocoGroups.get(bloco)!.push(i + 1);
  });

  if (blocoGroups.size > 0) {
    context += `ESTRUTURA DA SESSÃO — BLOCOS DE VOTAÇÃO:\n`;
    blocoGroups.forEach((nums, bloco) => {
      context += `  • ${bloco}: ${nums.length} matéria(s) — itens ${nums[0]} a ${nums[nums.length - 1]}\n`;
    });
    context += `⚠️ INSTRUÇÃO: Organize o parecer RESPEITANDO A ORDEM EXATA DA PAUTA. PDLs aparecem na posição em que constam na Ordem do Dia (NÃO no final). Cada bloco de votação (Segunda Discussão, Primeira Discussão, PDLs etc.) deve ter seu cabeçalho "## BLOCO..." na posição correta.\n\n`;
  }

  // Bloco de Expediente — listagem simples, zero tokens de análise
  if (expediente.length > 0) {
    context += `══════════════════════════════════════════\n`;
    context += `EXPEDIENTE (${expediente.length} itens — APENAS LISTE, NÃO ANALISE)\n`;
    context += `══════════════════════════════════════════\n`;
    expediente.forEach((m) => {
      const sigla = m.tipo_sigla || 'EXP';
      const autor = resolveAuthorName(m);
      const ementa = m.ementa ? m.ementa.substring(0, 120) : '(sem ementa)';
      context += `• ${sigla} ${m.numero}/${m.ano} | ${autor} — ${ementa}\n`;
    });
    context += `\n`;
  }

  // Bloco Legislativo — análise completa (apenas estes consomem tokens Gemini)
  if (legislativas.length > 0) {
    context += `══════════════════════════════════════════\n`;
    context += `ORDEM DO DIA — ITENS LEGISLATIVOS PARA ANÁLISE (${legislativas.length} itens)\n`;
    context += `══════════════════════════════════════════\n\n`;
  }

  legislativas.forEach((m, i) => {
    const autorNome = resolveAuthorName(m);
    const tipoSigla = m.tipo_sigla || (typeof m.tipo === 'object' ? m.tipo?.sigla : undefined) || 'MAT';
    const blocoVotacao = inferDiscussionStage(m, tipoSigla, m._docs || []);
    const allDocs = m._docs || [];
    const tramits = m._tramits || [];

    context += `═══════════════════════════════════════════\n`;
    context += `[MATÉRIA DE CONTEXTO ${i + 1} DE ${materias.length}] — ${tipoSigla} Nº ${m.numero}/${m.ano}\n`;
    context += `═══════════════════════════════════════════\n`;
    context += `Tipo: ${tipoSigla}\n`;
    context += `Número do Projeto: ${m.numero}/${m.ano}\n`;
    context += `Link no SAPL: ${SAPL_BASE}/materia/${m.id}\n`;
    context += `Ementa Oficial: ${m.ementa || 'Não informada'}\n`;
    context += `Autor(es): ${autorNome}\n`;
    context += `BLOCO DE VOTAÇÃO: ${blocoVotacao}\n`;

    // Tramitações recentes + votações
    context += `\nTRAMITAÇÕES RECENTES:\n`;
    if (tramits.length > 0) {
      const sorted = [...tramits].sort((a, b) => (b.data_tramitacao || '').localeCompare(a.data_tramitacao || ''));
      const votingTramits = tramits.filter(t => {
        const _so = typeof t.status === 'object' ? t.status : null;
        const s = (_so?.descricao || _so?.sigla || '').toUpperCase();
        const txt = (t.texto || '').toUpperCase();
        return VOTING_KEYWORDS.some(kw => s.includes(kw) || txt.includes(kw));
      });
      const seen = new Set<string>();
      const tramitsParaContexto = [...votingTramits, ...sorted.slice(0, 3)]
        .filter(t => {
          const _sid = typeof t.status === 'object' ? t.status?.id : t.status;
          const key = String(t.id ?? `${t.data_tramitacao}|${_sid}`);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 6);
      tramitsParaContexto.forEach(t => {
        // status pode vir como número (ID) ou objeto — extrai descrição do __str__ quando necessário
        const statusObj = typeof t.status === 'object' ? t.status : null;
        const statusParts = t.__str__?.split('|');
        const statusFromStr = statusParts && statusParts.length >= 2 ? statusParts[statusParts.length - 2].trim() : '';
        const statusDesc = statusObj?.descricao || statusObj?.sigla || statusFromStr;
        context += `  • ${formatDate(t.data_tramitacao)}: ${statusDesc} — ${t.texto || ''}\n`;
      });
    } else {
      context += `  Nenhuma tramitação registrada.\n`;
    }

    // Votações anteriores
    context += `\nRESULTADO DE VOTAÇÕES ANTERIORES (FOLHA DE VOTAÇÃO):\n`;
    const votacoesTramits = tramits.filter(t => {
      // status pode ser número — usa __str__ que sempre contém a descrição
      const s = (typeof t.status === 'object' ? t.status?.descricao || t.status?.sigla : '') || '';
      const str = (t.__str__ || '').toUpperCase();
      const txt = (t.texto || '').toUpperCase();
      return VOTING_KEYWORDS.some(kw => s.toUpperCase().includes(kw) || str.includes(kw) || txt.includes(kw));
    });
    if (votacoesTramits.length > 0) {
      votacoesTramits.forEach(t => {
        const _so561 = typeof t.status === 'object' ? t.status : null;
        const statusDesc = _so561?.descricao || _so561?.sigla || '';
        context += `  • ${formatDate(t.data_tramitacao)}: ${statusDesc}`;
        if (t.texto) context += ` — ${t.texto}`;
        context += `\n`;
      });
    } else {
      context += `  Nenhuma votação anterior registrada. Provavelmente é a PRIMEIRA votação desta matéria.\n`;
    }

    // Mapa unidade→comissão (para extraction precisa de votos via unidade_tramitacao_local)
    const unitMap = buildUnitMap(tramits);

    // Categorizar documentos
    const TIPO_ATA_COMISSAO = 17;
    const comissaoDocs = allDocs.filter(d => {
      if (isProcuradoriaDoc(d)) return false;
      const tipo = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
      if (tipo === TIPO_PARECER_RELATOR || tipo === TIPO_PARECER_COMISSAO || tipo === TIPO_ATA_COMISSAO) return true;
      const nome = (d.nome || '').toLowerCase();
      const str = (d.__str__ || '').toLowerCase();
      return ((nome.includes('comiss') || nome.includes('relator') || str.includes('comiss') || str.includes('relator'))
             && (nome.includes('parecer') || str.includes('parecer')));
    });

    const folhaVotacaoDocs = allDocs.filter(d => {
      const tipo = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
      if (tipo === TIPO_FOLHA_VOTACAO) return true;
      const nome = (d.nome || '').toLowerCase();
      return nome.includes('folha de votação') || nome.includes('folha de votacao');
    });

    const procuradoriaDocs = allDocs.filter(isProcuradoriaDoc);
    const impactoFinanceiroDocs = allDocs.filter(d => !isProcuradoriaDoc(d) && isImpactoFinanceiroDoc(d));
    const usedIds = new Set([...comissaoDocs, ...procuradoriaDocs, ...folhaVotacaoDocs, ...impactoFinanceiroDocs].map(d => d.id));
    const outrosDocs = allDocs.filter(d => !usedIds.has(d.id));

    // Pareceres das comissões
    context += `\nPARECERES DAS COMISSÕES REGISTRADOS NO SISTEMA:\n`;
    const seenComissoes = new Set<string>();

    if (m._pareceres && m._pareceres.length > 0) {
      m._pareceres.forEach(p => {
        const comissao = p.comissao_nome || p.comissao?.nome || 'Comissão';
        const rawResultado = p.parecer || p.tipo_resultado_votacao?.nome || '';
        const resultado = normalizeParecer(rawResultado);
        context += `  • COMISSÃO: ${comissao} | VOTO: ${resultado}\n`;
        seenComissoes.add(normalizeCommissionName(comissao));
      });
    }

    if (comissaoDocs.length > 0) {
      const comissaoRealDocs: SaplDocumento[] = [];
      const relatorDocs: SaplDocumento[] = [];
      comissaoDocs.forEach(d => {
        const autor = (d.autor || '').toLowerCase();
        const tipo = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
        if (autor.startsWith('comiss') || tipo === TIPO_PARECER_COMISSAO) {
          comissaoRealDocs.push(d);
        } else {
          relatorDocs.push(d);
        }
      });

      interface ComissaoGroup {
        nome: string;
        docs: SaplDocumento[];
        relator: string | null;
        voto: string | null;
        data: string | undefined;
      }

      const comissaoGroups = new Map<string, ComissaoGroup>();
      comissaoRealDocs.forEach(d => {
        const comissaoNome = d.autor || extractComissaoName(d);
        // Usa normalizeCommissionName para agrupar variações do mesmo nome
        // ("Saúde, Assistência Social" == "Saude,Assistencia Social" → mesma comissão)
        const groupKey = normalizeCommissionName(comissaoNome);
        if (!comissaoGroups.has(groupKey)) {
          comissaoGroups.set(groupKey, { nome: comissaoNome, docs: [], relator: null, voto: null, data: d.data });
        }
        comissaoGroups.get(groupKey)!.docs.push(d);
      });

      relatorDocs.forEach(rd => {
        const rdDate = new Date(rd.data || '2000-01-01').getTime();
        let bestGroup: ComissaoGroup | null = null;
        let bestDiff = Infinity;
        comissaoGroups.forEach(group => {
          const diff = Math.abs(rdDate - new Date(group.data || '2000-01-01').getTime());
          if (diff < bestDiff && diff < 30 * 24 * 60 * 60 * 1000) { bestDiff = diff; bestGroup = group; }
        });
        if (bestGroup) {
          (bestGroup as ComissaoGroup).docs.push(rd);
          if (rd.autor && !rd.autor.toLowerCase().startsWith('comiss')) {
            (bestGroup as ComissaoGroup).relator = rd.autor;
          }
        }
      });

      comissaoGroups.forEach((group) => {
        if (seenComissoes.has(normalizeCommissionName(group.nome))) return;

        // Classifica docs do grupo: relator vs própria comissão
        const isRelatorDoc = (d: SaplDocumento) => {
          const autor = (d.autor || '').toLowerCase();
          const tipo = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
          return !autor.startsWith('comiss') && tipo !== TIPO_PARECER_COMISSAO;
        };

        // Passo 1: extrai voto do relator (necessário para "comissão acompanha relator")
        let relatorVote: string | null = null;
        for (const d of group.docs) {
          if (!isRelatorDoc(d)) continue;
          const docContent = docVotes?.get(d.id);
          const voto = extractComissaoVote(d, tramits, docContent, unitMap);
          if (voto !== 'NÃO IDENTIFICADO') { relatorVote = voto; break; }
        }

        // Passo 2: extrai voto da comissão, detectando "segue relator"
        let followedRelator = false;
        for (const d of group.docs) {
          if (isRelatorDoc(d)) continue;
          const docContent = docVotes?.get(d.id);
          // "FAVORÁVEL AO VOTO DO RELATOR" → o voto que vale é o do relator, não o da comissão
          if (docContent && commissionFollowsRelatorInText(docContent)) {
            group.voto = relatorVote ?? 'NÃO IDENTIFICADO';
            followedRelator = true;
            break;
          }
          const voto = extractComissaoVote(d, tramits, docContent, unitMap);
          if (voto !== 'NÃO IDENTIFICADO') { group.voto = voto; break; }
        }

        // Se comissão não tem doc próprio com voto, usa voto do relator como proxy
        if (!group.voto && relatorVote) group.voto = relatorVote;

        if (!group.voto) {
          // Fallback: procura explicitamente o nome da comissão nas tramitações
          const nomeLower = group.nome.toLowerCase();
          for (const t of tramits) {
            const tStr = (t.__str__ || '').toLowerCase();
            const tTexto = (t.texto || '').toLowerCase();
            // REQUER menção explícita do nome da comissão (mín. 15 chars) — evita falso-positivo
            if (!tStr.includes(nomeLower.substring(0, 15)) && !tTexto.includes(nomeLower.substring(0, 15))) continue;
            const tTextU = (t.texto || '').toUpperCase();
            const tStrU = (t.__str__ || '').toUpperCase();
            if (tTextU.includes('INCONSTITUCIONALIDADE') || tTextU.includes('CONTRÁRIO') || tTextU.includes('CONTRARIO')) { group.voto = 'CONTRÁRIO'; break; }
            if (tStrU.includes('PARECER CONTRÁRIO') || tStrU.includes('PARECER CONTRARIO') || tStrU.includes('CONTRÁRIO DA COMISSÃO') || tStrU.includes('CONTRARIO DA COMISSAO')) { group.voto = 'CONTRÁRIO'; break; }
            if (tStrU.includes('PARECER FAVORÁVEL') || tStrU.includes('PARECER FAVORAVEL')) { group.voto = 'FAVORÁVEL'; break; }
          }
        }
        const votoComissao = group.voto || 'NÃO IDENTIFICADO';
        let line = `  • COMISSÃO: ${group.nome}`;
        if (group.relator) {
          line += ` | RELATOR: ${group.relator}`;
          if (relatorVote) line += ` | VOTO_RELATOR: ${relatorVote}`;
        }
        if (followedRelator) {
          line += ` | VOTO_COMISSAO: ${votoComissao} (acompanhou o relator)`;
        } else {
          line += ` | VOTO: ${votoComissao}`;
        }
        const parecerDoc = group.docs.find(d => {
          const t = typeof d.tipo === 'number' ? d.tipo : (d.tipo as { id?: number })?.id;
          return t === TIPO_PARECER_COMISSAO;
        }) || group.docs[0];
        const url = buildDocUrl(parecerDoc?.arquivo);
        if (url) line += ` | LINK: [Ver Parecer](${url})`;
        context += line + `\n`;
      });
    }

    if ((!m._pareceres || m._pareceres.length === 0) && comissaoDocs.length === 0) {
      context += `  Nenhum parecer de comissão registrado no SAPL até o momento.\n`;
    }

    // Folha de votação
    if (folhaVotacaoDocs.length > 0) {
      context += `\n📋 FOLHA DE VOTAÇÃO (DISCUSSÃO/VOTAÇÃO EM PLENÁRIO):\n`;
      folhaVotacaoDocs.forEach(d => {
        const url = buildDocUrl(d.arquivo);
        const linkDoc = url ? `[Ver Folha de Votação](${url})` : 'Sem Anexo';
        context += `  • DATA: ${formatDate(d.data)} | LINK: ${linkDoc}\n`;
      });
      context += `  ⚠️ SEGUNDA DISCUSSÃO — COERÊNCIA OBRIGATÓRIA: Esta matéria JÁ FOI VOTADA em plenário anteriormente.\n`;
      context += `     Salvo fato novo ou mudança de posição documentada, a Recomendação DEVE acompanhar o voto anterior para garantir coerência política.\n`;
      context += `     Verifique a folha de votação acima para identificar o voto da Vereadora Carol Dantas na primeira discussão.\n`;
    }

    // Procuradoria — voto extraído explicitamente para evitar alucinação do modelo
    context += `\nPARECER DA PROCURADORIA:\n`;
    if (procuradoriaDocs.length > 0) {
      procuradoriaDocs.forEach(d => {
        const nomeExibido = d.nome || 'Parecer da Procuradoria';
        const autorExibido = d.autor && d.autor !== d.nome ? ` (${d.autor})` : '';
        const dataDoc = d.data ? ` | DATA: ${formatDate(d.data)}` : '';
        const url = buildDocUrl(d.arquivo);
        const linkDoc = url ? `[Ver Parecer](${url})` : 'Sem Anexo';
        const docContent = docVotes?.get(d.id);
        const voto = extractProcuradoriaVote(d, tramits, docContent);
        context += `  • VOTO: ${voto} | NOME: ${nomeExibido.toUpperCase()}${autorExibido}${dataDoc} | LINK: ${linkDoc}\n`;
      });
    } else {
      context += `  Sem Parecer da Procuradoria registrado no SAPL.\n`;
    }
    // Estudos de impacto financeiro vinculados ao parecer da Procuradoria
    if (impactoFinanceiroDocs.length > 0) {
      context += `  → ESTUDO(S) DE IMPACTO FINANCEIRO (recomendado pela Procuradoria):\n`;
      impactoFinanceiroDocs.forEach(d => {
        const nomeExibido = d.nome || 'Estudo de Impacto Financeiro';
        const dataDoc = d.data ? ` | DATA: ${formatDate(d.data)}` : '';
        const url = buildDocUrl(d.arquivo);
        const linkDoc = url ? `[Ver Estudo](${url})` : 'Sem Anexo';
        context += `      • ${nomeExibido.toUpperCase()}${dataDoc} | LINK: ${linkDoc}\n`;
      });
    }
    // Alerta explícito ao modelo: proibir substituição/inferência de voto
    context += `  ⚠️ REGRA ANTI-ALUCINAÇÃO: Copie o campo "VOTO:" acima VERBATIM no parecer.\n`;
    context += `     Se o valor for "NÃO IDENTIFICADO", escreva exatamente isso — nunca substitua por FAVORÁVEL ou CONTRÁRIO.\n`;

    // Outros documentos
    context += `\nDOCUMENTOS ACESSÓRIOS:\n`;
    if (outrosDocs.length > 0) {
      outrosDocs.forEach(d => {
        const tipoDoc = (d.tipo as { descricao?: string; nome?: string })?.descricao || (d.tipo as { descricao?: string; nome?: string })?.nome || d.nome || 'Documento';
        const url = buildDocUrl(d.arquivo);
        const linkDoc = url ? `[Ver Documento](${url})` : 'Sem Anexo';
        context += `  • FORMATO: ${tipoDoc} | NOME: ${d.nome || 'N/A'} | LINK: ${linkDoc}\n`;
      });
    } else {
      context += `  Nenhum documento acessório vinculado.\n`;
    }

    // Bloco anti-alucinação por matéria — consolida todos os votos determinados
    context += `\n⚠️ INSTRUÇÃO OBRIGATÓRIA PARA ESTA MATÉRIA:\n`;
    context += `   Os valores de VOTO listados acima (comissões e procuradoria) foram extraídos\n`;
    context += `   diretamente do banco de dados do SAPL. Reproduza-os EXATAMENTE como estão:\n`;
    context += `   - Se VOTO = FAVORÁVEL → escreva FAVORÁVEL\n`;
    context += `   - Se VOTO = CONTRÁRIO → escreva CONTRÁRIO\n`;
    context += `   - Se VOTO = NÃO IDENTIFICADO → escreva "NÃO IDENTIFICADO no SAPL"\n`;
    context += `   NÃO INFERIR nem SUBSTITUIR nenhum voto com base em outros documentos.\n`;
    context += `   Os votos já foram extraídos via OCR/leitura direta dos PDFs pelo sistema.\n`;

    context += `\n---\n`;
  });

  return context;
}
