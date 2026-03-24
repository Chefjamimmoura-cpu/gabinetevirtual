// POST /api/alia/ingest/cadin
// Converte todas as 415+ autoridades do CADIN em chunks e indexa no pgvector.
// Idempotente: upsert por (gabinete_id, dominio, source_ref).

import { NextRequest, NextResponse } from 'next/server';
import { upsertKnowledge, type KnowledgeChunk } from '@/lib/alia/rag';

const GABINETE_ID   = process.env.GABINETE_ID!;
const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

interface CadinOrg {
  personId?: string; orgId?: string;
  titularNome?: string; titularCargo?: string;
  nomeOrgao?: string; orgName?: string; orgAcronym?: string | null;
  sphere?: string; tipo?: string;
  phone?: string | null; email?: string | null;
  orgPhone?: string | null; orgEmail?: string | null; orgAddress?: string | null;
  party?: string | null; chefeGab?: string | null; birthday?: string | null;
}

// Mapa de esferas para rótulos semânticos em PT (melhora a busca vetorial)
const ESFERA_LABEL: Record<string, string> = {
  municipal: 'municipal (Prefeitura de Boa Vista / Câmara Municipal de Boa Vista)',
  estadual:  'estadual (Governo do Estado de Roraima / Assembleia Legislativa de Roraima)',
  federal:   'federal (Governo Federal / Congresso Nacional)',
};

// Mapa de tipos para descrição semântica
const TIPO_LABEL: Record<string, string> = {
  secretaria:     'Secretaria',
  autarquia:      'Autarquia',
  fundacao:       'Fundação',
  empresa_publica:'Empresa Pública',
  camara:         'Câmara Legislativa',
  prefeitura:     'Prefeitura',
  judiciario:     'Judiciário / Tribunal',
  governo_estadual:'Governo Estadual',
  outros:         '',
};

function toChunk(o: CadinOrg): KnowledgeChunk {
  const nome   = String(o.titularNome  ?? '').trim();
  const cargo  = String(o.titularCargo ?? '').trim();
  const orgao  = String(o.nomeOrgao ?? o.orgName ?? '').trim();
  const sigla  = String(o.orgAcronym  ?? '').trim();
  const esfera = String(o.sphere ?? 'municipal');
  const esferaLabel = ESFERA_LABEL[esfera] ?? esfera;
  const tipoLabel   = TIPO_LABEL[o.tipo ?? ''] ?? '';

  // Linha de abertura rica em contexto para busca semântica
  // Ex: "Francisco Oliveira é o Secretário Municipal de Saúde na SEMSA (Secretaria Municipal de Saúde), esfera municipal."
  const abertura = [
    nome && cargo && orgao
      ? `${nome} é o(a) ${cargo} ${sigla ? `na ${sigla}` : `em`} (${orgao}), esfera ${esfera}.`
      : nome
        ? `${nome} — ${cargo || 'autoridade'} — ${orgao}`
        : `${orgao} — ${cargo || 'órgão público'}`,
  ];

  const partes = [
    ...abertura,
    '',
    `AUTORIDADE: ${nome}`,
    cargo                          ? `CARGO: ${cargo}` : '',
    orgao                          ? `ÓRGÃO: ${orgao}` : '',
    sigla                          ? `SIGLA: ${sigla}` : '',
    `ESFERA: ${esferaLabel}`,
    tipoLabel                      ? `TIPO DE ÓRGÃO: ${tipoLabel}` : '',
    o.phone    ? `Telefone pessoal: ${o.phone}` : '',
    o.email    ? `Email pessoal: ${o.email}` : '',
    o.orgPhone ? `Telefone do órgão: ${o.orgPhone}` : '',
    o.orgEmail ? `Email do órgão: ${o.orgEmail}` : '',
    o.orgAddress ? `Endereço: ${o.orgAddress}` : '',
    o.party    ? `Partido: ${o.party}` : '',
    o.chefeGab ? `Chefe de Gabinete: ${o.chefeGab}` : '',
    o.birthday ? `Aniversário: ${o.birthday}` : '',
    // Sinônimos e variações para melhorar recall semântico
    cargo ? `Responsável pela ${orgao}: ${nome}` : '',
    cargo ? `Quem é o(a) ${cargo}${orgao ? ` da ${orgao}` : ''}? ${nome}` : '',
  ].filter(Boolean);

  return {
    dominio:    'cadin',
    source_ref: `${nome}:${orgao}`.substring(0, 200),
    chunk_text: partes.join('\n'),
    metadata:   {
      sphere:   esfera,
      tipo:     o.tipo ?? null,
      personId: o.personId,
      orgId:    o.orgId,
      has_phone: !!(o.phone || o.orgPhone),
      has_email: !!(o.email || o.orgEmail),
      has_birthday: !!o.birthday,
    },
  };
}

export async function POST(req: NextRequest) {
  // Aceita chamada sem auth (internal) ou com Bearer CRON_SECRET
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const res = await fetch(`${INTERNAL_BASE}/api/cadin/organizations`);
  if (!res.ok) return NextResponse.json({ error: 'CADIN indisponível' }, { status: 502 });

  const orgs = await res.json() as CadinOrg[];
  const chunks = orgs.filter(o => o.titularNome || o.nomeOrgao).map(toChunk);

  const result = await upsertKnowledge(chunks, GABINETE_ID);
  return NextResponse.json({ total: chunks.length, ...result });
}
