// POST /api/alia/ingest/legislacao
// Seed: Regimento Interno CMBV (artigos-chave) + CF/88 (art. municipais)
// Para indexar o RI completo: POST /api/alia/knowledge com chunks do PDF.

import { NextRequest, NextResponse } from 'next/server';
import { upsertKnowledge, type KnowledgeChunk } from '@/lib/alia/rag';

const GABINETE_ID = process.env.GABINETE_ID!;

const LEGISLACAO_CHUNKS: KnowledgeChunk[] = [
  // ── Regimento Interno CMBV ───────────────────────────────────────────────
  {
    dominio: 'legislacao', source_ref: 'RI-CMBV:Art.73',
    chunk_text: `Art. 73 do Regimento Interno da CMBV (Resolução nº 93/1998):
O voto do relator nas comissões permanentes poderá ser FAVORÁVEL ou CONTRÁRIO.
Não existe voto de CAUTELA no Regimento Interno. A comissão deve emitir parecer
conclusivo aprovando ou rejeitando a matéria. Votos de abstenção não são previstos.`,
    metadata: { lei: 'RI-CMBV', resolucao: '93/1998', artigo: '73' },
  },
  {
    dominio: 'legislacao', source_ref: 'RI-CMBV:Art.79-CLJRF',
    chunk_text: `Art. 79 do RI CMBV — Comissão de Legislação, Justiça, Redação e Finanças (CLJRF)
Resolução nº 93/1998.
Competência: apreciar a constitucionalidade, legalidade e juridicidade dos projetos.
Examinar a redação final das proposições aprovadas. Apreciar matéria tributária e orçamentária.`,
    metadata: { lei: 'RI-CMBV', resolucao: '93/1998', artigo: '79', sigla: 'CLJRF' },
  },
  {
    dominio: 'legislacao', source_ref: 'RI-CMBV:Art.80-COF',
    chunk_text: `Art. 80 do RI CMBV — Comissão de Obras e Finanças (COF)
Resolução nº 93/1998.
Competência: projetos relativos a obras públicas, urbanismo, habitação, transporte,
sistema viário, financeiro e orçamentário municipal.`,
    metadata: { lei: 'RI-CMBV', resolucao: '93/1998', artigo: '80', sigla: 'COF' },
  },
  {
    dominio: 'legislacao', source_ref: 'RI-CMBV:Art.81-COUTH',
    chunk_text: `Art. 81 do RI CMBV — Comissão de Urbanismo, Turismo e Habitação (COUTH)
Resolução nº 93/1998.
Competência: projetos relativos ao turismo, habitação, uso do solo, parcelamento do solo urbano.`,
    metadata: { lei: 'RI-CMBV', resolucao: '93/1998', artigo: '81', sigla: 'COUTH' },
  },
  {
    dominio: 'legislacao', source_ref: 'RI-CMBV:Art.82-CECEJ',
    chunk_text: `Art. 82 do RI CMBV — Comissão de Educação, Cultura, Esporte e Juventude (CECEJ)
Resolução nº 93/1998.
Competência: projetos relativos à educação, cultura, desporto, lazer e políticas para juventude.`,
    metadata: { lei: 'RI-CMBV', resolucao: '93/1998', artigo: '82', sigla: 'CECEJ' },
  },
  {
    dominio: 'legislacao', source_ref: 'RI-CMBV:Art.82A-CSASM',
    chunk_text: `Art. 82-A do RI CMBV — Comissão de Saúde, Assistência Social e Meio Ambiente (CSASM)
Resolução nº 137/2009.
Competência: projetos relativos à saúde pública, assistência social, meio ambiente,
saneamento, defesa civil e políticas de bem-estar social.`,
    metadata: { lei: 'RI-CMBV', resolucao: '137/2009', artigo: '82-A', sigla: 'CSASM' },
  },
  {
    dominio: 'legislacao', source_ref: 'RI-CMBV:Art.83B-CASP',
    chunk_text: `Art. 83-B do RI CMBV — Comissão de Acessibilidade e Serviço Público (CASP)
Resolução nº 226/2021.
Competência: acessibilidade, defesa do consumidor, serviços públicos municipais,
concessões, permissões e mobilidade urbana.`,
    metadata: { lei: 'RI-CMBV', resolucao: '226/2021', artigo: '83-B', sigla: 'CASP' },
  },
  {
    dominio: 'legislacao', source_ref: 'RI-CMBV:Art.83C-CPMAIPD',
    chunk_text: `Art. 83-C do RI CMBV — Comissão Permanente de Mulher, Assuntos da Infância e Pessoa com Deficiência (CPMAIPD)
Resolução nº 226/2021.
Competência: projetos relativos a direitos das mulheres, crianças, adolescentes,
idosos e pessoas com deficiência.`,
    metadata: { lei: 'RI-CMBV', resolucao: '226/2021', artigo: '83-C', sigla: 'CPMAIPD' },
  },
  // ── CF/88 — Artigos municipais ───────────────────────────────────────────
  {
    dominio: 'legislacao', source_ref: 'CF88:Art.29',
    chunk_text: `Art. 29 da Constituição Federal de 1988 — Organização dos Municípios:
Os municípios se regerão por lei orgânica, votada em dois turnos.
Garante: eleição direta do prefeito e vereadores, mandato de 4 anos,
remuneração dos vereadores fixada pelas câmaras.`,
    metadata: { lei: 'CF/88', artigo: '29' },
  },
  {
    dominio: 'legislacao', source_ref: 'CF88:Art.30',
    chunk_text: `Art. 30 da CF/88 — Competências Municipais:
I   — legislar sobre assuntos de interesse local;
II  — suplementar a legislação federal e estadual no que couber;
III — instituir e arrecadar tributos;
IV  — criar, organizar e suprimir distritos;
V   — organizar e prestar serviços públicos de interesse local (transporte coletivo);
VI  — manter, com cooperação técnica federal/estadual, programas de educação infantil e fundamental;
VII — prestar serviços de atendimento à saúde da população;
VIII— promover ordenamento territorial.`,
    metadata: { lei: 'CF/88', artigo: '30' },
  },
  {
    dominio: 'legislacao', source_ref: 'CF88:Art.5-IncisoXIV',
    chunk_text: `Art. 5º, XIV da CF/88 — Direito à informação:
É assegurado a todos o acesso à informação e resguardado o sigilo da fonte,
quando necessário ao exercício profissional. Base legal para requerimentos
de informação e transparência pública pela câmara municipal.`,
    metadata: { lei: 'CF/88', artigo: '5', inciso: 'XIV' },
  },
  // ── Lei Orgânica de Boa Vista ────────────────────────────────────────────
  {
    dominio: 'legislacao', source_ref: 'LOBV:competencias-camara',
    chunk_text: `Lei Orgânica do Município de Boa Vista — Competências da Câmara Municipal:
- Legislar sobre assuntos de interesse local
- Fiscalizar os atos do Poder Executivo Municipal
- Apreciar o orçamento anual do município
- Autorizar empréstimos e operações de crédito
- Conceder títulos de honra e cidadania honorária
- Criar e extinguir cargos públicos municipais
Base: Lei Orgânica de Boa Vista/RR, promulgada em 05/04/1990.`,
    metadata: { lei: 'Lei Orgânica Boa Vista', ano: '1990' },
  },
];

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const result = await upsertKnowledge(LEGISLACAO_CHUNKS, GABINETE_ID);
  return NextResponse.json({
    total: LEGISLACAO_CHUNKS.length,
    nota: 'Seed inicial. Para indexar o RI completo: POST /api/alia/knowledge com chunks do PDF.',
    ...result,
  });
}
