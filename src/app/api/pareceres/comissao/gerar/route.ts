// POST /api/pareceres/comissao/gerar
// Gera o texto do Parecer da Comissão e/ou ATA da Reunião (sem IA — template fixo).
//
// Body:
//   materia_id: number            — matéria individual (parecer)
//   materia_ids?: number[]        — matérias selecionadas (ATA multi-select)
//   commission_sigla: string      — ex: "CASP"
//   voto: 'FAVORÁVEL' | 'CONTRÁRIO' | 'CAUTELA'
//   modo?: 'parecer' | 'ata' | 'ambos'   — o que gerar (default: ambos)
//   data?: string                 — "2026-03-03" (data da reunião)
//   hora_inicio?: string          — "OITO HORAS"
//   hora_fim?: string             — "NOVE HORAS"
//
// Response: { parecer_comissao?: string, ata?: string, membros, commission, materia }

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { fetchMateria, enrichMateria } from '@/lib/sapl/client';
import { getCommissionBySigla } from '@/lib/parecer/prompts-relator';
import { resolveAuthorName } from '@/lib/parecer/build-context';
import { dateToExtenso } from '@/lib/parecer/generate-docx';

interface Membro {
  nome: string;
  cargo: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: {
    materia_id?: number;
    materia_ids?: number[];
    commission_sigla?: string;
    voto?: string;
    modo?: 'parecer' | 'ata' | 'ambos';
    data?: string;
    hora_inicio?: string;
    hora_fim?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const {
    materia_id,
    materia_ids,
    commission_sigla,
    voto = 'FAVORÁVEL',
    modo = 'ambos',
    data,
    hora_inicio = 'OITO HORAS',
    hora_fim = 'NOVE HORAS',
  } = body;

  // Aceita materia_id (individual) ou materia_ids[0] como ID principal
  const primaryId = materia_id || (materia_ids && materia_ids.length > 0 ? materia_ids[0] : null);

  if (!primaryId && modo !== 'ata') {
    return NextResponse.json({ error: '"materia_id" ou "materia_ids" é obrigatório' }, { status: 400 });
  }
  if (modo === 'ata' && (!materia_ids || materia_ids.length === 0) && !materia_id) {
    return NextResponse.json({ error: '"materia_ids" é obrigatório para gerar ATA' }, { status: 400 });
  }
  if (!commission_sigla) return NextResponse.json({ error: '"commission_sigla" é obrigatório' }, { status: 400 });

  const commission = getCommissionBySigla(commission_sigla);
  if (!commission) {
    return NextResponse.json({ error: `Comissão "${commission_sigla}" não encontrada` }, { status: 400 });
  }

  const votoRaw = (voto as string).toUpperCase();
  // 'SEGUIR RELATOR' → delega ao relator; para o template usa FAVORÁVEL (padrão ~99% dos casos)
  const votoNorm = votoRaw === 'SEGUIR RELATOR' ? 'FAVORÁVEL' : votoRaw;
  const seguindoRelator = votoRaw === 'SEGUIR RELATOR';
  if (!['FAVORÁVEL', 'CONTRÁRIO', 'CAUTELA'].includes(votoNorm)) {
    return NextResponse.json({ error: '"voto" deve ser FAVORÁVEL, CONTRÁRIO, CAUTELA ou SEGUIR RELATOR' }, { status: 400 });
  }

  // Busca matéria principal no SAPL (para parecer)
  let materia;
  if (primaryId) {
    try {
      const raw = await fetchMateria(primaryId);
      materia = await enrichMateria(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Matéria não encontrada';
      return NextResponse.json({ error: `Falha ao buscar matéria ${primaryId}: ${msg}` }, { status: 502 });
    }
  }

  // Busca membros no SAPL
  // Usa sapl_comissao_id (ID do módulo comissoes) quando disponível.
  // CASP: comissao_id=12, unit_id=83 — são campos distintos.
  let membros: Membro[] = [];
  const membrosQueryId = commission.sapl_comissao_id ?? commission.sapl_unit_id;
  if (membrosQueryId) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/pareceres/comissao/membros?comissao_id=${membrosQueryId}`);
      if (res.ok) {
        const fetchedData = await res.json();
        membros = fetchedData.membros ?? [];
      }
    } catch { /* segue sem membros */ }
  }

  // Resolve matérias para ATA
  // Se materia_ids fornecido, usa essas matérias específicas para a ATA
  // Caso contrário, busca todas as matérias em tramitação na comissão (comportamento legado)
  const ataIds = materia_ids && materia_ids.length > 0 ? materia_ids : (primaryId ? [primaryId] : []);

  let ataMaterias: Array<{ id: number; tipo_sigla: string; numero: number; ano: number; ementa: string; autor: string }> = [];

  if (modo === 'ata' || modo === 'ambos') {
    // Busca detalhes de cada matéria selecionada para ATA
    const detalhes = await Promise.allSettled(
      ataIds.map(id =>
        fetchMateria(id)
          .then(raw => enrichMateria(raw))
          .then(m => ({
            id: m.id,
            tipo_sigla: m.tipo_sigla || (typeof m.tipo === 'object' ? (m.tipo as { sigla?: string })?.sigla : '') || 'PL',
            numero: m.numero,
            ano: m.ano,
            ementa: m.ementa || '',
            autor: resolveAuthorName(m),
          }))
      )
    );

    ataMaterias = detalhes
      .filter((r): r is PromiseFulfilledResult<typeof ataMaterias[0]> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  const tipoSigla = materia
    ? (materia.tipo_sigla || (typeof materia.tipo === 'object' ? (materia.tipo as { sigla?: string })?.sigla : '') || 'PLL')
    : (ataMaterias[0]?.tipo_sigla || 'PLL');
  const tipoDesc = materia
    ? (materia.tipo_descricao || (typeof materia.tipo === 'object' ? (materia.tipo as { descricao?: string })?.descricao : '') || '')
    : '';
  const autorNome = materia ? resolveAuthorName(materia) : (ataMaterias[0]?.autor || '');
  const ementa = materia?.ementa || ataMaterias[0]?.ementa || 'Sem ementa disponível';
  const materiaRef = materia
    ? `${tipoSigla} Nº ${materia.numero}/${materia.ano}`
    : (ataMaterias[0] ? `${ataMaterias[0].tipo_sigla} Nº ${ataMaterias[0].numero}/${ataMaterias[0].ano}` : 'Matéria');

  // Data da reunião
  const reuniaoDate = data ? new Date(data + 'T12:00:00') : new Date();
  const dataExtenso = dateToExtenso(reuniaoDate);
  const dataCurta = reuniaoDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  // Texto do voto para os templates
  const votoFavoravel = votoNorm === 'FAVORÁVEL';
  const votoLabel = votoNorm;
  const aprovando = votoFavoravel ? 'aprovando' : votoNorm === 'CONTRÁRIO' ? 'reprovando' : 'deferindo com cautela';
  const votoAcaoAta = votoFavoravel ? 'APROVADO' : votoNorm === 'CONTRÁRIO' ? 'REPROVADO' : 'EM CAUTELA';

  const presidente = membros.find(m => m.cargo === 'presidente');

  // ── TEMPLATE: PARECER DA COMISSÃO (individual) ────────────────────────────
  let parecerComissao: string | null = null;
  if ((modo === 'parecer' || modo === 'ambos') && materia) {
    parecerComissao = `Na forma do artigo 49, inciso IX do Regimento Interno dessa Câmara Municipal de Boa Vista, passamos a emitir parecer da comissão sobre os projetos abaixo relacionados:

${materiaRef} AUTOR: ${autorNome} - ${ementa}

${seguindoRelator
      ? `Em análise pelos membros, a comissão acompanha e subscreve o voto do relator, manifestando-se **FAVORÁVEL ao parecer apresentado pela Relatoria**, aprovando o respectivo projeto de Lei.`
      : `Em análise pelos membros, a comissão concorda e manifesta-se **${votoLabel} ao parecer apresentado pela Relatoria**, ${aprovando} o respectivo projeto de Lei.`}

É o breve parecer.
Boa Vista – RR, ${dataCurta}.`.trim();
  }

  // ── TEMPLATE: ATA DA REUNIÃO (multi-matéria selecionável) ─────────────────
  let ata: string | null = null;
  if ((modo === 'ata' || modo === 'ambos') && ataMaterias.length > 0) {
    // Tratamento formal: presidente = "A PRESIDENTE DA COMISSÃO, VEREADORA X", demais = "VEREADOR(A) X"
    const presidenteNomeFormal = presidente
      ? `A PRESIDENTE DA COMISSÃO, VEREADORA ${presidente.nome.toUpperCase()}`
      : 'A PRESIDENTE DA COMISSÃO';

    const pautaItems = ataMaterias.map((m, i) =>
      `${i + 1}) ${m.tipo_sigla} Nº ${m.numero}/${m.ano}${m.autor ? ` AUTOR: ${m.autor.toUpperCase()}` : ''} - ${m.ementa.toUpperCase()}`
    ).join(' ');

    const votacaoItems = ataMaterias.map((m) => {
      return `NA SEQUÊNCIA, ${presidenteNomeFormal} LEU O ${m.tipo_sigla.toUpperCase()} Nº ${m.numero}/${m.ano}${m.autor ? ` AUTOR: ${m.autor.toUpperCase()}` : ''} COM PARECER, COLOCOU EM VOTAÇÃO, SENDO ${votoAcaoAta} O PARECER - FICANDO CONSIGNADO EM PARECER DA COMISSÃO.`;
    }).join(' ');

    // Bloco de assinaturas dos membros presentes (com tratamento formal)
    const cargoLabel: Record<string, string> = {
      presidente: 'PRESIDENTE',
      'vice-presidente': 'VICE-PRESIDENTE',
      secretario: 'SECRETÁRIO(A)',
      membro: 'MEMBRO',
      suplente: 'SUPLENTE',
    };
    const cargoOrdem: Record<string, number> = { presidente: 0, 'vice-presidente': 1, secretario: 2, membro: 3, suplente: 4 };
    const membrosOrdenados = [...membros].sort((a, b) => (cargoOrdem[a.cargo] ?? 9) - (cargoOrdem[b.cargo] ?? 9));
    const assinaturas = membrosOrdenados.length > 0
      ? '\n\n' + membrosOrdenados.map(m => {
          const tratamento = m.cargo === 'presidente'
            ? `VEREADORA ${m.nome.toUpperCase()}`
            : `VEREADOR(A) ${m.nome.toUpperCase()}`;
          return `_________________________________\n${tratamento}\n${cargoLabel[m.cargo] ?? m.cargo.toUpperCase()}`;
        }).join('\n\n')
      : '';

    ata = `AO DIA ${dataExtenso}, ÀS ${hora_inicio.toUpperCase()}, NO PLENARINHO, NO PALÁCIO JOÃO EVANGELISTA PEREIRA DE MELO, REUNIRAM-SE OS COMPONENTES DA COMISSÃO DE ${commission.nome.toUpperCase()}, PARA DELIBERAR SOBRE A PAUTA DA ORDEM DO DIA DO COLEGIADO. ${presidenteNomeFormal} DEU CIÊNCIA DA PAUTA DA ORDEM DO DIA: ${pautaItems}.

${votacaoItems} COMO NADA MAIS HOUVE A TRATAR, A REUNIÃO FOI ENCERRADA ÀS ${hora_fim.toUpperCase()}, SENDO ESTA ATA LIDA E ASSINADA PELOS PRESENTES.${assinaturas}`.trim();
  }

  return NextResponse.json({
    parecer_comissao: parecerComissao,
    ata,
    membros,
    commission: {
      sigla: commission.sigla,
      nome: commission.nome,
      sapl_unit_id: commission.sapl_unit_id,
    },
    materia: materia ? {
      tipo: tipoSigla,
      descricao: tipoDesc,
      numero: materia.numero,
      ano: materia.ano,
      ementa,
      autor: autorNome,
    } : (ataMaterias[0] ? {
      tipo: ataMaterias[0].tipo_sigla,
      descricao: '',
      numero: ataMaterias[0].numero,
      ano: ataMaterias[0].ano,
      ementa: ataMaterias[0].ementa,
      autor: ataMaterias[0].autor,
    } : null),
    ata_materias_count: ataMaterias.length,
    data_reuniao: dataCurta,
    data_extenso: dataExtenso,
  });
}
