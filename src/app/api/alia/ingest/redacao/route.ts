// POST /api/alia/ingest/redacao
// Indexa padrão Itamaraty: estrutura, vocativos, fechos e modelos de documentos.

import { NextRequest, NextResponse } from 'next/server';
import { upsertKnowledge, type KnowledgeChunk } from '@/lib/alia/rag';

const GABINETE_ID = process.env.GABINETE_ID!;

const REDACAO_CHUNKS: KnowledgeChunk[] = [
  {
    dominio: 'redacao', source_ref: 'itamaraty:estrutura-oficio',
    chunk_text: `ESTRUTURA DO OFÍCIO — Padrão Itamaraty (Manual de Redação da Presidência da República, 3ª ed.):
1. CABEÇALHO: nome do órgão emissor centralizado
2. IDENTIFICAÇÃO: "Ofício nº ___/ANO" — local e data por extenso à direita
3. VOCATIVO: tratamento adequado ao destinatário (ver tabela de vocativos)
4. CORPO: exposição objetiva em parágrafos — 1º parágrafo contextualiza, 2º detalha, 3º encerra
5. FECHO: "Atenciosamente," (mesmo nível ou inferior) | "Respeitosamente," (hierarquia superior)
6. ASSINATURA: nome em maiúsculas + cargo abaixo + local/data se não no cabeçalho
7. DESTINATÁRIO: ao final, à esquerda — "A Sua Excelência o Senhor / [Nome] / [Cargo] / [Local]"`,
    metadata: { fonte: 'Manual de Redação PR, 3ª ed.', tipo: 'estrutura' },
  },
  {
    dominio: 'redacao', source_ref: 'itamaraty:vocativos-tratamento',
    chunk_text: `VOCATIVOS E PRONOMES DE TRATAMENTO — Redação Oficial Brasileira:

EXCELENTÍSSIMO(A) SENHOR(A) → Presidente da República, Vice-Presidente, Ministros de Estado,
Governadores, Senadores, Deputados Federais e Estaduais, Vereadores, Prefeitos,
Membros do STF, STJ, TST, TSE, STM, TRF, TRE, TCU, AGU.

SENHOR(A) SECRETÁRIO(A) → Secretários Estaduais e Municipais
SENHOR(A) DIRETOR(A) → Diretores de autarquias, fundações, empresas públicas
MERITÍSSIMO(A) JUIZ(A) → Juízes de 1ª instância
EXCELENTÍSSIMO SENHOR DESEMBARGADOR → Tribunais de 2ª instância
DOUTOR(A) → Procuradores, Promotores, advogados com título de doutor

Em todo o texto: "Vossa Excelência" (V.Exa.) para Excelentíssimos
Em todo o texto: "Vossa Senhoria" (V.Sa.) para Senhores/Doutores`,
    metadata: { fonte: 'Manual de Redação PR, 3ª ed.', tipo: 'vocativos' },
  },
  {
    dominio: 'redacao', source_ref: 'itamaraty:modelo-oficio-secretario-municipal',
    chunk_text: `MODELO COMPLETO — Ofício para Secretário Municipal:

CÂMARA MUNICIPAL DE BOA VISTA
Gabinete da Vereadora Carol Dantas

Boa Vista/RR, [dia] de [mês por extenso] de [ano].

Ofício nº ___/[ano]

Senhor Secretário,

[Parágrafo 1 — Referência e motivação: "Vimos por meio deste ofício solicitar/comunicar/requerer..."]

[Parágrafo 2 — Desenvolvimento: detalhamento objetivo da solicitação, fatos, dados]

[Parágrafo 3 — Encerramento: "Aguardamos vossa atenção / Permanecemos à disposição"]

Atenciosamente,

CAROL DANTAS
Vereadora — Câmara Municipal de Boa Vista/RR

A Sua Senhoria o Senhor
[Nome Completo do Secretário]
[Cargo — ex: Secretário Municipal de Infraestrutura]
Boa Vista/RR`,
    metadata: { tipo: 'modelo', destinatario: 'secretario-municipal' },
  },
  {
    dominio: 'redacao', source_ref: 'itamaraty:modelo-oficio-governador',
    chunk_text: `MODELO COMPLETO — Ofício para Governador do Estado:

CÂMARA MUNICIPAL DE BOA VISTA
Gabinete da Vereadora Carol Dantas

Boa Vista/RR, [data por extenso].

Ofício nº ___/[ano]

Excelentíssimo Senhor Governador,

[Corpo do ofício]

Respeitosamente,

CAROL DANTAS
Vereadora — Câmara Municipal de Boa Vista/RR

A Sua Excelência o Senhor
[Nome do Governador]
Governador do Estado de Roraima
Palácio Senador Hélio Campos
Boa Vista/RR`,
    metadata: { tipo: 'modelo', destinatario: 'governador' },
  },
  {
    dominio: 'redacao', source_ref: 'itamaraty:modelo-requerimento-mesa',
    chunk_text: `MODELO — Requerimento à Mesa Diretora da CMBV:

REQUERIMENTO Nº ___/[ano]

À Mesa Diretora da Câmara Municipal de Boa Vista,

A signatária, Vereadora Carol Dantas, no exercício do mandato, vem
respeitosamente requerer a V.Exas. que [objeto do requerimento], com
fundamento no art. [X] do Regimento Interno desta Casa.

JUSTIFICATIVA:
[Motivação objetiva em 2-3 parágrafos]

Nestes termos, pede deferimento.

Boa Vista/RR, [data].

CAROL DANTAS
Vereadora`,
    metadata: { tipo: 'modelo', destinatario: 'mesa-diretora' },
  },
  {
    dominio: 'redacao', source_ref: 'itamaraty:modelo-indicacao-legislativa',
    chunk_text: `MODELO — Indicação Legislativa (para protocolo no SAPL):

INDICAÇÃO Nº ___/[ano]

Autora: Vereadora Carol Dantas

EMENTA: Indica ao Poder Executivo Municipal que [ação] no/na [local], [bairro], Boa Vista/RR.

JUSTIFICATIVA:

§ 1º — [Descrição objetiva do problema: onde, como se manifesta, há quanto tempo existe]

§ 2º — [Impacto social: número de famílias afetadas, grupos vulneráveis, riscos à segurança]

§ 3º — [Fundamentação legal: CF art. 30, Lei Orgânica de Boa Vista, legislação pertinente]

§ 4º — [Urgência, se aplicável]

SALA DA VEREADORA, Câmara Municipal de Boa Vista, [data].

CAROL DANTAS
Vereadora`,
    metadata: { tipo: 'modelo', documento: 'indicacao-legislativa' },
  },
  {
    dominio: 'redacao', source_ref: 'itamaraty:fechos-corretos',
    chunk_text: `FECHOS DE DOCUMENTOS OFICIAIS — Uso Correto:

"Atenciosamente," → para autoridades de mesmo nível hierárquico ou inferior
  (Ex: Vereadora → Secretário Municipal, Diretor, outros Vereadores)

"Respeitosamente," → para autoridades hierarquicamente superiores
  (Ex: Vereadora → Governador, Ministro, Presidente da República)

PROIBIDO usar: "Com respeito e admiração", "Com estima e consideração",
"Atenciosamente e respeitosamente" juntos, "Subscrevo-me" (arcaico).

Nota: "Certa de vossa atenção" é aceito como frase de encerramento antes do fecho,
mas não substitui o fecho oficial.`,
    metadata: { tipo: 'regra', area: 'fechos' },
  },
];

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const result = await upsertKnowledge(REDACAO_CHUNKS, GABINETE_ID);
  return NextResponse.json({ total: REDACAO_CHUNKS.length, ...result });
}
