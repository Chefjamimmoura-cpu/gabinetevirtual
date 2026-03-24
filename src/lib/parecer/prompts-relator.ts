// ═══════════════════════════════════════════
// PROMPTS — Relatoria (Parecer de Relator)
// Geração de parecer de comissão pelo relator
// ═══════════════════════════════════════════

export interface CommissionConfig {
  sigla: string;
  nome: string;
  /** Artigo do Regimento Interno que fundamenta a comissão */
  artigoRegimento?: string;
  /** Área temática de competência (white-label: vem do DB quando disponível) */
  area?: string;
  /** @deprecated Use area */
  areaExpertise?: string;
  /** Critérios de análise em markdown (opcional; fallback genérico se ausente) */
  criterios?: string;
  /** @deprecated Use criterios */
  criteriosAnalise?: string;
  /** Escopo negativo: o que a comissão NÃO deve analisar (injetado como restrição no prompt) */
  escopoNegativo?: string;
  /** Palavras-chave para localizar PLs desta comissão no SAPL cache */
  keywords?: string[];
  /** @deprecated Use keywords */
  saplKeywords?: string[];
  /** ID da unidade de tramitação no SAPL para scan ao vivo (opcional).
   *  ATENÇÃO: é o ID da UNIDADE de tramitação, diferente do ID da comissão.
   *  Ex: CASP tem unidade_id=83 (comissao_id=12). */
  sapl_unit_id?: number | null;
  /** ID da comissão no módulo comissoes do SAPL (para busca de membros/composição).
   *  Diferente do sapl_unit_id (unidade de tramitação). Ex: CASP comissao_id=12, unit_id=83. */
  sapl_comissao_id?: number | null;
  /** URL da lei/resolução que criou ou regulamenta a comissão */
  link_lei?: string;
}

/** Registro de todas as comissões permanentes da CMBV (10 comissões — atualizado conforme SAPL e RI) */
export const COMISSOES_CMBV: CommissionConfig[] = [
  {
    sigla: 'CLJRF',
    nome: 'Comissão de Legislação, Justiça, Redação Final e Legislação Participativa',
    artigoRegimento: 'Art. 79 do Regimento Interno (Res. 93/1998)',
    area: 'constitucionalidade, legalidade, técnica legislativa, redação final e legislação participativa',
    sapl_unit_id: 1,
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Legislação, Justiça e Redação', 'CLJRF', 'Legislação Participativa'],
    criterios: `
- Constitucionalidade: analisar compatibilidade com a Constituição Federal e Lei Orgânica Municipal (LOM)
- Legalidade: verificar se há vício de iniciativa, competência legislativa, processo legislativo regular
- Técnica Legislativa: redação clara, linguagem jurídica precisa, coerência sistemática com ordenamento vigente (LC 95/1998)
- Redação Final: adequação da ementa ao conteúdo, terminologia correta, ausência de ambiguidades
- Iniciativa Popular: verificar se a proposição de iniciativa popular atende os requisitos legais
- Mérito Administrativo: conveniência e oportunidade quando envolver organização administrativa, bens imóveis, consórcios ou denominação de logradouros`,
    escopoNegativo: `
- NÃO analise impacto orçamentário/fiscal detalhado (competência da COF — Art. 80)
- NÃO analise mérito técnico de obras e infraestrutura (competência da COUTH — Art. 81)
- NÃO analise mérito pedagógico de políticas educacionais (competência da CECEJ — Art. 82)
- NÃO analise mérito sanitário/ambiental (competência da CSASM — Art. 82-A)
- NÃO analise detalhes previdenciários dos servidores (competência da CASP — Art. 83-B)
- NÃO emita opinião de mérito nas áreas temáticas das demais comissões — concentre-se na constitucionalidade, legalidade e técnica legislativa`,
  },
  {
    sigla: 'COF',
    nome: 'Comissão de Orçamento, Fiscalização Financeira, Tributação e Controle',
    artigoRegimento: 'Art. 80 do Regimento Interno (Res. 93/1998)',
    area: 'orçamento público, fiscalização financeira, tributação municipal e controle externo',
    sapl_unit_id: 2,
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Orçamento e Finanças', 'COF', 'COFFTC', 'Fiscalização Financeira'],
    criterios: `
- Impacto Fiscal: verificar se há criação de despesa e se há indicação de fonte de custeio (Arts. 16 e 17 da LRF — LC 101/2000)
- Compatibilidade Orçamentária: adequação à LOA, LDO e PPA vigentes de Boa Vista
- Lei de Responsabilidade Fiscal (LRF): conformidade com arts. 16, 17 e 21 da LC 101/2000
- Equilíbrio Financeiro: não comprometimento das metas fiscais do município
- Tributação: impactos sobre receita municipal, isenções, benefícios fiscais, renúncia de receita (Art. 14 LRF)
- Fiscalização e Controle: conformidade com as diretrizes do TCE-RR e CGM
- Limite de Gastos com Pessoal: observância dos limites da LRF (Arts. 19 e 20)`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal (competência da CLJRF — Art. 79)
- NÃO analise mérito técnico de obras (competência da COUTH — Art. 81)
- NÃO analise mérito pedagógico de políticas educacionais (competência da CECEJ — Art. 82)
- NÃO analise mérito sanitário/ambiental (competência da CSASM — Art. 82-A)
- NÃO analise regime jurídico dos servidores (competência da CASP — Art. 83-B)
- Concentre-se EXCLUSIVAMENTE no aspecto financeiro, orçamentário e fiscal`,
  },
  {
    sigla: 'COUTH',
    nome: 'Comissão de Obras, Urbanização, Transportes e Habitação',
    artigoRegimento: 'Art. 81 do Regimento Interno (Res. 93/1998)',
    area: 'obras públicas, urbanização, transportes, habitação e serviços públicos locais',
    sapl_unit_id: 3,
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Obras, Urbanização, Transportes', 'COUTH', 'Habitação'],
    criterios: `
- Viabilidade Técnica: avaliar se a proposta é tecnicamente viável e adequada à realidade de Boa Vista
- Plano Diretor: compatibilidade com o Plano Diretor de Boa Vista e Lei de Uso e Ocupação do Solo
- Infraestrutura: impacto na infraestrutura urbana existente (saneamento, drenagem, energia, vias)
- Mobilidade Urbana: conformidade com a Política Nacional de Mobilidade Urbana (Lei 12.587/2012) e CTB
- Habitação: adequação aos programas habitacionais municipais e ao PLHIS
- Licitação de Obras: observância da Lei 14.133/2021 para obras públicas
- Acessibilidade: conformidade com Lei 13.146/2015 (LBI) e ABNT NBR 9050`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal (competência da CLJRF — Art. 79)
- NÃO analise impacto orçamentário/fiscal detalhado (competência da COF — Art. 80)
- NÃO analise aspectos sanitários de saúde pública (competência da CSASM — Art. 82-A)
- NÃO analise políticas educacionais ou culturais (competência da CECEJ — Art. 82)
- Concentre-se no mérito técnico de obras, urbanização e infraestrutura`,
  },
  {
    sigla: 'CECEJ',
    nome: 'Comissão de Educação, Cultura, Esporte e Juventude',
    artigoRegimento: 'Art. 82 do Regimento Interno (Res. 93/1998)',
    area: 'educação municipal, cultura, patrimônio histórico, esporte, lazer e juventude',
    sapl_unit_id: 4,
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Educação, Cultura, Esporte', 'CECEJ', 'Juventude'],
    criterios: `
- Educação: adequação à LDB (Lei 9.394/96), PNE, PME e política municipal de educação de Boa Vista
- Cultura: fomento à identidade cultural local, preservação do patrimônio histórico e cultural (Art. 216 CF/88)
- Esporte e Lazer: promoção do esporte como direito social (Art. 217 CF/88)
- Criança e Adolescente: conformidade com ECA (Lei 8.069/90) no contexto educacional
- Juventude: adequação ao Estatuto da Juventude (Lei 12.852/13)
- Patrimônio Histórico: proteção aos bens tombados e sítios históricos do município`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal (competência da CLJRF — Art. 79)
- NÃO analise impacto orçamentário/fiscal detalhado (competência da COF — Art. 80)
- NÃO analise obras e infraestrutura escolar em aspecto técnico-construtivo (competência da COUTH — Art. 81)
- NÃO analise saúde da criança em aspecto clínico (competência da CSASM — Art. 82-A)
- NÃO analise regime jurídico dos professores em aspectos previdenciários (competência da CASP — Art. 83-B)`,
  },
  {
    sigla: 'CSASM',
    nome: 'Comissão de Saúde, Assistência Social e Meio Ambiente',
    artigoRegimento: 'Art. 82-A do Regimento Interno (Res. 137/2009)',
    area: 'saúde pública, assistência social, meio ambiente e proteção dos recursos naturais',
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Saúde, Assistência Social e Meio Ambiente', 'CSASM', 'saúde', 'meio ambiente'],
    criterios: `
- Saúde: conformidade com a Lei 8.080/90 (SUS), Lei 8.142/90 e política municipal de saúde
- Assistência Social: adequação à LOAS (Lei 8.742/93), PNAS, SUAS e planos municipais
- Saneamento Básico: adequação à Lei 14.026/20 (Marco do Saneamento) e PMSB
- Meio Ambiente: compatibilidade com PNMA (Lei 6.938/81), SNUC, Código Florestal e normas municipais
- Sustentabilidade: impactos ambientais e exigência de EIA/RIMA quando aplicável
- Vigilância Sanitária: adequação às normas da ANVISA e vigilância municipal
- Proteção ao Idoso: conformidade com o Estatuto do Idoso (Lei 10.741/03) no aspecto de saúde`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal (competência da CLJRF — Art. 79)
- NÃO analise impacto orçamentário/fiscal detalhado (competência da COF — Art. 80)
- NÃO analise obras em aspecto técnico-construtivo (competência da COUTH — Art. 81)
- NÃO analise regime jurídico dos profissionais de saúde em aspectos administrativos (competência da CASP — Art. 83-B)
- NÃO analise agrotóxicos em aspecto produtivo (competência da CAG)`,
  },
  {
    sigla: 'CDCDHAISU',
    nome: 'Comissão de Defesa do Consumidor, Direitos Humanos, Assuntos Indígenas e Segurança Urbana',
    artigoRegimento: 'Regimento Interno (Res. 93/1998 — disposições originais)',
    area: 'defesa do consumidor, direitos humanos, assuntos indígenas e segurança urbana',
    sapl_unit_id: 5,
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Defesa do Consumidor', 'Direitos Humanos', 'Assuntos Indígenas', 'Segurança Urbana', 'CDCDHAISU'],
    criterios: `
- Defesa do Consumidor: conformidade com o CDC (Lei 8.078/90), PROCON municipal, relações de consumo
- Direitos Humanos: compatibilidade com a DUDH, CF/88 (Arts. 1º, 3º, 5º) e tratados internacionais
- Assuntos Indígenas: conformidade com o Estatuto do Índio (Lei 6.001/73), CF/88 (Arts. 231 e 232) e a realidade das comunidades indígenas de Roraima
- Segurança Urbana: adequação às políticas de segurança pública municipal, papel da Guarda Municipal (Art. 144, §8º CF/88)
- Grupos Vulneráveis: proteção de populações em situação de vulnerabilidade social`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal (competência da CLJRF — Art. 79)
- NÃO analise impacto orçamentário/fiscal detalhado (competência da COF — Art. 80)
- NÃO analise obras e infraestrutura (competência da COUTH — Art. 81)
- NÃO analise educação, cultura e esporte (competência da CECEJ — Art. 82)
- NÃO analise saúde pública e meio ambiente (competência da CSASM — Art. 82-A)
- NÃO analise políticas específicas para mulheres, crianças, idosos e PcD — encaminhe à CPMAIPD (Art. 83-C), exceto quando envolvam violação de direitos humanos fundamentais`,
  },
  {
    sigla: 'CEDP',
    nome: 'Comissão de Ética e Decoro Parlamentar',
    artigoRegimento: 'Regimento Interno da CMBV',
    area: 'ética parlamentar, decoro, conduta dos vereadores e processo disciplinar',
    sapl_unit_id: 7,
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Ética', 'Decoro Parlamentar', 'CEDP', 'ética parlamentar'],
    criterios: `
- Ética Parlamentar: verificar se a proposição respeita os princípios éticos que regem o exercício do mandato (CF/88, Art. 37 e LOM)
- Decoro Parlamentar: adequação às normas de conduta exigidas pelo Regimento Interno e Código de Ética da CMBV
- Processo Disciplinar: conformidade com os ritos do processo disciplinar, ampla defesa e contraditório (Art. 5º, LV, CF/88)
- Cassação de Mandato: verificar requisitos legais e procedimentais para perda de mandato
- Incompatibilidades e Impedimentos: análise de conflitos de interesse, vedações e incompatibilidades do cargo de vereador
- Transparência e Prestação de Contas: conformidade com deveres de transparência e publicidade dos atos parlamentares`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal de projetos de lei em geral (competência da CLJRF — Art. 79)
- NÃO analise impacto orçamentário/fiscal (competência da COF — Art. 80)
- NÃO analise mérito de políticas públicas setoriais (saúde, educação, obras, etc.)
- A CEDP atua exclusivamente sobre questões de conduta e ética dos parlamentares — não sobre o mérito legislativo de projetos de lei ordinários`,
  },
  {
    sigla: 'CASP',
    nome: 'Comissão de Administração, Serviços Públicos e Previdência',
    artigoRegimento: 'Art. 83-B do Regimento Interno (Res. 226/2021)',
    area: 'administração pública, servidores municipais, serviços públicos residuais e previdência',
    sapl_unit_id: 83,      // ID da unidade de tramitação CASP no SAPL (não confundir: 93 = caixa pessoal da Carol, 83 = comissão CASP)
    sapl_comissao_id: 12,  // ID da comissão no módulo comissoes (para busca de membros)
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Administração, Serviços Públicos e Previdência', 'CASP', 'administração', 'servidor'],
    criterios: `
- Regime Jurídico: compatibilidade com o Estatuto dos Servidores Públicos Municipais e CLT (onde aplicável)
- Criação/Extinção de Cargos: impacto na estrutura administrativa e necessidade demonstrada
- Plano de Cargos, Carreiras e Remunerações (PCCR): adequação e isonomia salarial
- Previdência: conformidade com Lei 9.717/98, EC 103/2019 e legislação municipal
- Contratações e Concessões: adequação à Lei 14.133/2021 e normas de concessão
- Eficiência Administrativa: melhoria na prestação do serviço público ao cidadão (Art. 37, CF/88)
- Serviços Públicos Residuais: matérias não enquadradas nas demais comissões`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal (competência da CLJRF — Art. 79)
- NÃO analise impacto orçamentário/fiscal detalhado, LOA, LDO, PPA (competência da COF — Art. 80)
- NÃO analise obras e infraestrutura (competência da COUTH — Art. 81)
- NÃO analise educação, cultura, esporte e juventude (competência da CECEJ — Art. 82)
- NÃO analise saúde pública e meio ambiente (competência da CSASM — Art. 82-A)
- NÃO analise defesa do consumidor e segurança urbana (competência da CDCDHAISU)
- NÃO analise políticas para mulheres, crianças, idosos e PcD (competência da CPMAIPD — Art. 83-C)
- NÃO analise agricultura (competência da CAG)`,
  },
  {
    sigla: 'CPMAIPD',
    nome: 'Comissão de Políticas para Mulheres, Crianças e Adolescentes, Idosos e Pessoa com Deficiência',
    artigoRegimento: 'Art. 83-C do Regimento Interno (Res. 226/2021)',
    area: 'políticas públicas para mulheres, crianças e adolescentes, idosos e pessoas com deficiência',
    sapl_unit_id: 13,
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Políticas para Mulheres', 'Crianças e Adolescentes', 'Idosos', 'Pessoa com Deficiência', 'CPMAIPD'],
    criterios: `
- Mulheres: conformidade com a Lei Maria da Penha (Lei 11.340/06), combate à violência doméstica, equidade de gênero
- Crianças e Adolescentes: adequação ao ECA (Lei 8.069/90), proteção integral, Conselho Tutelar
- Idosos: conformidade com o Estatuto do Idoso (Lei 10.741/03), acessibilidade, prioridade no atendimento
- Pessoa com Deficiência: adequação à LBI (Lei 13.146/2015), acessibilidade (ABNT NBR 9050), educação inclusiva
- Saúde Especializada: fortalecimento do atendimento especializado em saúde para os grupos protegidos
- Transversalidade: verificar impactos diferenciados sobre mulheres, crianças, idosos e PcD`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal (competência da CLJRF — Art. 79)
- NÃO analise impacto orçamentário/fiscal detalhado (competência da COF — Art. 80)
- NÃO analise obras em aspecto técnico (competência da COUTH — Art. 81)
- NÃO analise educação e cultura em geral fora do contexto de proteção dos grupos (competência da CECEJ — Art. 82)
- NÃO analise saúde pública geral (competência da CSASM — Art. 82-A) — pode opinar sobre saúde especializada dos seus grupos
- NÃO analise direitos humanos em geral que não envolvam mulheres, crianças, idosos ou PcD (competência da CDCDHAISU)
- NÃO analise agricultura (competência da CAG)`,
  },
  {
    sigla: 'CAG',
    nome: 'Comissão de Agricultura',
    artigoRegimento: 'Regimento Interno (incluída pela Res. 152/2011)',
    area: 'agricultura, pecuária, desenvolvimento rural, agroindústria e sustentabilidade no campo',
    sapl_unit_id: 9,
    link_lei: 'https://sapl.boavista.rr.leg.br/norma/38',
    keywords: ['Agricultura', 'CAG', 'pecuária', 'rural', 'agropecuária'],
    criterios: `
- Política Agrícola: conformidade com a Lei 8.171/91 (Política Agrícola Nacional) e programas de fomento de Roraima
- Desenvolvimento Rural: adequação às políticas de desenvolvimento rural sustentável e regularização fundiária
- Sustentabilidade: práticas sustentáveis, uso de agrotóxicos (Lei 7.802/89), preservação de recursos hídricos
- Abastecimento: impacto na segurança alimentar e abastecimento do município (Lei 11.346/06 — LOSAN)
- Pecuária: políticas de sanidade animal, controle sanitário em articulação com órgãos estaduais
- Contexto Regional: particularidades de Roraima (lavrado, terra indígena, fronteira) na análise de políticas agrícolas`,
    escopoNegativo: `
- NÃO analise constitucionalidade ou legalidade formal (competência da CLJRF — Art. 79)
- NÃO analise impacto orçamentário/fiscal detalhado (competência da COF — Art. 80)
- NÃO analise obras urbanas e infraestrutura da cidade (competência da COUTH — Art. 81)
- NÃO analise educação e cultura (competência da CECEJ — Art. 82)
- NÃO analise saúde pública geral (competência da CSASM — Art. 82-A)
- NÃO analise regime jurídico dos servidores (competência da CASP — Art. 83-B)
- NÃO analise assuntos indígenas fora do contexto fundiário rural (competência da CDCDHAISU)`,
  },
];

/** Retorna a configuração de uma comissão pelo sigla (case-insensitive) */
export function getCommissionBySigla(sigla: string): CommissionConfig | undefined {
  return COMISSOES_CMBV.find(c => c.sigla.toLowerCase() === sigla.toLowerCase());
}

/**
 * Detecta o tratamento correto (Relator / Relatora) com base no nome.
 * Regra simples: nomes femininos conhecidos ou que terminam com 'a' recebem "Relatora".
 */
function detectarCargo(nome: string): { cargo: string; pronomeTratamento: string } {
  const nomeLower = nome.toLowerCase();
  const feminino =
    nomeLower.includes('vereadora') ||
    nomeLower.includes('deputada') ||
    nomeLower.includes('dra.') ||
    nomeLower.includes('dra ') ||
    // Primeiro nome terminado em 'a' antes do sobrenome (heurística)
    /^[^a-z]*[a-záàâãéêíóôõúü]+a\s/i.test(nome);

  return feminino
    ? { cargo: 'Relatora', pronomeTratamento: 'a Relatora' }
    : { cargo: 'Relator', pronomeTratamento: 'o Relator' };
}

/**
 * Gera o prompt de sistema para elaboração do parecer de relator.
 *
 * Lógica baseada no documento "logica.txt" elaborado pela equipe do Gabinete (18/03/2026):
 * - Apenas FAVORÁVEL ou CONTRÁRIO (+ variações: com emendas, com ressalvas)
 * - 5 seções obrigatórias (seção II — Da Competência só se residual)
 * - Seção III dedicada a PROGE e CLJRF com detalhamento completo
 * - Árvore de decisão explícita para o voto
 * - Critérios da ficha técnica da comissão como parâmetro principal
 *
 * White-label: funciona para qualquer vereador e qualquer comissão.
 */
export function buildRelatorSystemPrompt(
  commission: CommissionConfig,
  relatorNome: string,
): string {
  const area = commission.area ?? commission.areaExpertise ?? commission.sigla;
  const criterios = commission.criterios ?? commission.criteriosAnalise;
  const { cargo, pronomeTratamento } = detectarCargo(relatorNome);

  const criteriosSection = criterios
    ? `## FICHA TÉCNICA — CRITÉRIOS DA ${commission.sigla}\n${criterios}`
    : `## ÁREA DE COMPETÊNCIA DA ${commission.sigla}\n${area}`;

  const escopoSection = commission.escopoNegativo
    ? `\n\n## RESTRIÇÕES DE ESCOPO — NÃO ANALISE\nA ${commission.sigla} NÃO deve analisar os seguintes aspectos (competência de outras comissões):\n${commission.escopoNegativo}`
    : '';

  const artigoComissao = commission.artigoRegimento
    ? ` (${commission.artigoRegimento})`
    : '';

  return `Você é a Assessora Jurídica Parlamentar responsável por elaborar o **Parecer de ${cargo}** da ${commission.nome} (${commission.sigla}) da Câmara Municipal de Boa Vista/RR.

${cargo}: **${relatorNome}**${artigoComissao}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## REGRA DE OURO — VOTO POSSÍVEIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

O parecer de relator na CMBV admite APENAS estes resultados (Art. 73 do RI — Resolução nº 93/1998):

| Resultado | Quando usar |
|---|---|
| **FAVORÁVEL** | A proposição é constitucional, legal e meritoriamente adequada |
| **FAVORÁVEL COM EMENDAS** | Aprova, mas sugere alterações pontuais (Art. 73, §4º RI) |
| **FAVORÁVEL COM RESSALVAS** | Aprova, mas registra observações formais |
| **CONTRÁRIO** | Há vício insanável, inconstitucionalidade ou inconveniência grave |

**JAMAIS** use "voto em cautela", "diligência" ou qualquer resultado intermediário.
A base regimental é o Art. 73 do RI (Resolução nº 93/1998): *"As Comissões Permanentes deliberarão, por maioria de votos, sobre o pronunciamento do relator."*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ÁRVORE DE DECISÃO DO VOTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Percorra esta árvore em ordem. Na primeira resposta SIM, defina o voto:

1. A PROGE (Procuradoria) opinou pela INCONSTITUCIONALIDADE?
   → SIM: **CONTRÁRIO** — citar o parecer da PROGE como fundamento principal
   → NÃO: continuar ↓

2. Há vício de iniciativa? (matéria de iniciativa privativa do Executivo — Art. 61 §1º CF/88)
   → SIM: **CONTRÁRIO** — fundamentar com Art. 61 CF/88
   → NÃO: continuar ↓

3. A matéria gera impacto financeiro sem indicação de fonte de custeio? (Arts. 16 e 17 LRF)
   → SIM: **CONTRÁRIO** — fundamentar com LRF
   → NÃO: continuar ↓

4. A matéria invade competência exclusiva estadual ou federal?
   → SIM: **CONTRÁRIO** — fundamentar com Art. 30 CF/88
   → NÃO: continuar ↓

5. O mérito é adequado e conveniente sob a ótica da ${commission.sigla}?
   → SIM: **FAVORÁVEL** (ou COM EMENDAS se precisar de ajustes pontuais)
   → NÃO: **CONTRÁRIO** — fundamentar o mérito desfavorável

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ORDEM DE REFERÊNCIAS (hierarquia)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **CLJRF** — parecer obrigatório para TODOS os projetos (Art. 79, §1º RI). Se a CLJRF já se manifestou, cite seu entendimento e sua conclusão de forma detalhada na seção III.
2. **PROGE (Procuradoria)** — parecer vinculante em matéria de constitucionalidade. Se existir no contexto, transcreva sua conclusão e seus fundamentos na seção III.
3. **Pareceres de outras comissões** — referência complementar, citar se disponível.
4. **Tramitações** — fornecem o histórico processual (contexto do relatório).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## REGRAS INVIOLÁVEIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **ANTI-ALUCINAÇÃO**: Use APENAS dados do contexto fornecido. Nunca invente números de pareceres, datas, nomes de procuradores ou artigos de lei que não constem no contexto.
2. **COMPETÊNCIA EXCLUSIVA**: A ${commission.sigla} analisa EXCLUSIVAMENTE sua área. NÃO invada competência de outras comissões.
3. **TOM FORMAL**: Linguagem jurídica, impessoal, 3ª pessoa. Use "esta Relatoria", "esta Comissão", "o presente projeto".
4. **BLOCKQUOTE PARA CITAÇÕES**: Use \`>\` (blockquote markdown) para transcrever trechos de artigos de lei e de pareceres anteriores.
5. **NUNCA MENCIONAR IA**: O parecer é um documento oficial. Não inclua qualquer menção a inteligência artificial, sistemas automáticos ou software no corpo do texto.
6. **PARECER COMPLETO**: Não truncar. Todas as seções devem ser elaboradas.
7. **GÊNERO**: ${pronomeTratamento} assina o parecer como **${cargo}**.
8. **ARTIGO + RESOLUÇÃO**: Ao citar o Regimento Interno, sempre indique o artigo E a resolução. Formato obrigatório: *"Art. XX do RI (Resolução nº YY/AAAA)"*. Exemplo: *"Art. 83-B do RI (Resolução nº 226/2021)"* para a CASP; *"Art. 73 do RI (Resolução nº 93/1998)"* para deliberações. O mapa completo: CLJRF → Art. 79 (Res. 93/1998) · COF → Art. 80 · COUTH → Art. 81 · CECEJ → Art. 82 · CSASM → Art. 82-A (Res. 137/2009) · CASP → Art. 83-B (Res. 226/2021) · CPMAIPD → Art. 83-C (Res. 226/2021).

${criteriosSection}${escopoSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ESTRUTURA OBRIGATÓRIA DO PARECER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Gere o parecer exatamente nesta estrutura (em Markdown):

---

**CÂMARA MUNICIPAL DE BOA VISTA**
**${commission.nome.toUpperCase()} — ${commission.sigla}**

**PARECER Nº ___/[ANO]**

| Campo | Valor |
|---|---|
| **Matéria** | [TIPO Nº NÚMERO/ANO] |
| **Autor(a)** | [Nome completo do autor] |
| **Ementa** | [Ementa oficial] |
| **${cargo}** | ${relatorNome} |
| **Data** | [DD de mês de AAAA] |

---

### I — RELATÓRIO

Descreva:
- O objeto da proposição (o que o projeto propõe)
- Autoria e data de apresentação
- Histórico de tramitação (baseado nas tramitações fornecidas)
- Síntese dos artigos principais do projeto (use bullet points se forem mais de 3 artigos)

---

### II — DA COMPETÊNCIA DESTA COMISSÃO

[INCLUIR ESTA SEÇÃO somente se a competência for residual ou precisar de justificativa.
Se a competência da ${commission.sigla} for direta e evidente pela ementa, SUPRIMIR esta seção e ir direto para a III.]

Se incluída, cite ${artigoComissao || 'o artigo do Regimento Interno'} e explique por que a matéria se enquadra na competência da ${commission.sigla}.

---

### III — DOS PARECERES ANTERIORES

Para CADA parecer disponível no contexto (PROGE e/ou CLJRF e/ou outras comissões):

**[Nome do órgão emitente — ex: Procuradoria Legislativa / CLJRF]**
- **Conclusão:** [FAVORÁVEL / CONTRÁRIO / PELA CONSTITUCIONALIDADE etc.]
- **Fundamentos principais:** [resumo dos argumentos, 2-4 pontos]
- **Citação textual relevante** (se disponível):
  > "[trecho mais importante do parecer]"
- **Link:** [URL do documento no SAPL se disponível no contexto]

Se NÃO houver pareceres anteriores no contexto, escreva:
*"Até a data de elaboração deste parecer, não foram localizados no sistema SAPL documentos acessórios com manifestação da Procuradoria ou da Comissão de Legislação, Justiça e Redação Final sobre a presente matéria."*

---

### IV — ANÁLISE DE MÉRITO

Analise sob a ótica EXCLUSIVA da ${commission.sigla}:

1. **Adequação à área de competência** — verificar se a matéria é efetivamente da alçada da ${commission.sigla}
2. **Critérios técnicos específicos** — aplicar os critérios da ficha técnica desta comissão (descritos acima)
3. **Impacto financeiro** — verificar se gera ônus e se há previsão de custeio (LRF)
4. **Constitucionalidade e legalidade** — na perspectiva da ${commission.sigla} (sem invadir a CLJRF)
5. **Viabilidade e conveniência** — análise de mérito sob a ótica da comissão
6. **Posicionamento em relação aos pareceres anteriores** — concordar, divergir ou complementar

Use blockquotes (\`>\`) para citar artigos de lei e trechos de pareceres.

---

### V — CONCLUSÃO

Parágrafo final com os fundamentos listados (use bullet points) e o voto em destaque:

**Pelo exposto**, a ${commission.nome} (${commission.sigla}), por ${pronomeTratamento}, opina pelo:

> # VOTO: **[FAVORÁVEL / FAVORÁVEL COM EMENDAS / CONTRÁRIO]**

ao(à) [TIPO Nº NÚMERO/ANO], com base nos fundamentos acima expostos.

Boa Vista/RR, [DD de mês de AAAA].

${relatorNome}
${cargo} — ${commission.sigla}
Câmara Municipal de Boa Vista

---

## REFERÊNCIAS SAPL
[Se houver links de documentos no contexto (tramitações, pareceres, texto original), liste-os aqui como:
- [Tipo do documento](URL)]

---

## FORMATAÇÃO FINAL
- Negrito para termos jurídicos chave, números de artigos e o voto
- O voto na seção V deve estar em heading H1 (\`# VOTO: **FAVORÁVEL**\`) para máximo destaque
- Blockquote (\`>\`) para toda citação de artigo de lei ou de parecer anterior
- Nunca mencionar IA, software ou sistema automático no corpo do parecer
`;
}
