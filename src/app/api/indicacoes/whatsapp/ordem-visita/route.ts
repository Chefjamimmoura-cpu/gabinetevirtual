// POST /api/indicacoes/whatsapp/ordem-visita
// ──────────────────────────────────────────────────────────────
// Envia uma ordem de visita para o agente de campo via WhatsApp.
// Atualiza o status da indicação para 'em_andamento'.
//
// Body:
//   indicacao_id:         string  — UUID da indicação no Supabase
//   telefone_responsavel?: string  — ex: "5595991234567"
//                                    se não informado, tenta responsavel_nome
//                                    mapeado nos contatos
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;

function normalizarTelefone(tel: string): string {
  return tel.replace(/\D/g, '');
}

function formatarOrdemDeVisita(ind: {
  id: string;
  titulo: string;
  bairro: string;
  logradouro: string;
  setores: string[];
  classificacao: string | null;
  responsavel_nome: string | null;
  observacoes: string | null;
}): string {
  const urgenciaEmoji = ind.classificacao === 'urgencia' ? '🔴' : ind.classificacao === 'prioridade' ? '🟡' : '🟢';
  const setoresStr = (ind.setores ?? []).join(', ') || '(não especificado)';
  const idCurto = ind.id.substring(0, 8).toUpperCase();

  return [
    `📍 *ORDEM DE VISITA*`,
    ``,
    `*ID:* ${idCurto}`,
    `*Local:* ${ind.logradouro}, ${ind.bairro}`,
    `*Setores:* ${setoresStr}`,
    `*Classificação:* ${urgenciaEmoji} ${(ind.classificacao ?? 'necessidade').toUpperCase()}`,
    ind.observacoes ? `*Obs:* ${ind.observacoes}` : '',
    ``,
    `✅ Ao chegar, tire fotos e responda este número com:`,
    `*!foto ${idCurto} [descrição]*`,
    ``,
    `Gabinete Vereadora Carol Dantas`,
  ].filter(l => l !== undefined).join('\n');
}

export async function POST(req: NextRequest) {
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const evolutionInstance = process.env.EVOLUTION_INSTANCE;

  if (!evolutionUrl || !evolutionKey || !evolutionInstance) {
    return NextResponse.json({
      error: 'Evolution API não configurada',
      vars_ausentes: ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE'].filter(v => !process.env[v]),
    }, { status: 503 });
  }

  let body: { indicacao_id: string; telefone_responsavel?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  if (!body.indicacao_id) {
    return NextResponse.json({ error: 'indicacao_id é obrigatório' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Buscar indicação
  const { data: ind, error } = await supabase
    .from('indicacoes')
    .select('id, titulo, bairro, logradouro, setores, classificacao, responsavel_nome, observacoes')
    .eq('id', body.indicacao_id)
    .eq('gabinete_id', GABINETE_ID)
    .single();

  if (error || !ind) {
    return NextResponse.json({ error: 'Indicação não encontrada' }, { status: 404 });
  }

  // Resolver telefone do responsável
  let telefone = body.telefone_responsavel;
  if (!telefone && ind.responsavel_nome) {
    // Tentar encontrar no CADIN por nome
    const { data: pessoa } = await supabase
      .from('cadin_persons')
      .select('phone')
      .ilike('full_name', `%${ind.responsavel_nome}%`)
      .eq('gabinete_id', GABINETE_ID)
      .limit(1)
      .single();
    if (pessoa?.phone) telefone = pessoa.phone;
  }

  if (!telefone) {
    return NextResponse.json({
      error: 'Telefone do responsável não encontrado',
      instrucao: 'Passe telefone_responsavel no body ou cadastre o agente no CADIN com o mesmo nome',
      responsavel_nome: ind.responsavel_nome,
    }, { status: 422 });
  }

  const numeroNormalizado = normalizarTelefone(telefone);
  const mensagem = formatarOrdemDeVisita(ind as typeof ind & { setores: string[]; classificacao: string | null; responsavel_nome: string | null; observacoes: string | null });

  // Enviar via Evolution API
  const evoRes = await fetch(
    `${evolutionUrl}/message/sendText/${evolutionInstance}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionKey,
      },
      body: JSON.stringify({ number: numeroNormalizado, text: mensagem }),
    },
  );

  if (!evoRes.ok) {
    const txt = await evoRes.text();
    return NextResponse.json({
      error: `Evolution API retornou ${evoRes.status}`,
      detalhe: txt.substring(0, 300),
    }, { status: 502 });
  }

  // Atualizar status para em_andamento
  await supabase
    .from('indicacoes')
    .update({ status: 'em_andamento' })
    .eq('id', body.indicacao_id)
    .eq('status', 'pendente'); // só muda se ainda estava pendente

  return NextResponse.json({
    ok: true,
    indicacao_id: body.indicacao_id,
    telefone: numeroNormalizado,
    status_novo: 'em_andamento',
    mensagem: `Ordem de visita enviada para ${ind.responsavel_nome ?? numeroNormalizado}`,
  });
}
