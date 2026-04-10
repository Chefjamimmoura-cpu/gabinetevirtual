// src/lib/alia/agents/indicacao.agent.ts
// ALIA Agent: Indicações — registrar, listar, protocolar e consultar status.

import { createClient } from '@supabase/supabase-js';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const GABINETE_ID = process.env.GABINETE_ID!;
const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── registrar_indicacao ──────────────────────────────────────────────────────

async function registrarIndicacao(args: Record<string, unknown>, senderName: string): Promise<AgentResult> {
  const supabase = getSupabase();
  const { bairro, logradouro, setores = [], classificacao = 'necessidade' } = args as {
    bairro: string;
    logradouro: string;
    setores?: string[];
    classificacao?: string;
  };
  const titulo = `${(setores as string[]).slice(0, 2).join(', ') || 'Demanda'} — ${logradouro}, ${bairro}`;

  const { data, error } = await supabase
    .from('indicacoes')
    .insert({
      gabinete_id: GABINETE_ID,
      titulo,
      bairro,
      logradouro,
      setores,
      classificacao,
      responsavel_nome: senderName,
      status: 'pendente',
      fonte: 'whatsapp',
    })
    .select('id')
    .single();

  if (error || !data) {
    return { success: false, content: `Falha ao registrar indicação: ${error?.message ?? 'erro desconhecido'}` };
  }

  const id_curto = (data.id as string).substring(0, 8).toUpperCase();
  return {
    success: true,
    content: `✅ Indicação registrada com sucesso!\nID: **${id_curto}**\nLocal: ${logradouro}, ${bairro}\nClassificação: ${classificacao}`,
    structured: { id_curto, mensagem: 'Criada no banco de dados.' },
    actions_taken: [`indicacao_criada:${id_curto}`],
  };
}

// ── listar_indicacoes ────────────────────────────────────────────────────────

async function listarIndicacoes(args: Record<string, unknown>, senderName: string): Promise<AgentResult> {
  const supabase = getSupabase();
  const responsavel = (args.responsavel as string) || senderName;
  const status = args.status as string | undefined;
  const limite = Math.min((args.limite as number) || 10, 30);

  let q = supabase
    .from('indicacoes')
    .select('id, titulo, logradouro, bairro, status, classificacao, data_registro')
    .eq('gabinete_id', GABINETE_ID)
    .order('data_registro', { ascending: false })
    .limit(limite);

  if (status) {
    q = q.eq('status', status);
  } else {
    q = q.in('status', ['pendente', 'em_andamento']);
  }

  if (responsavel) {
    q = q.ilike('responsavel_nome', `%${responsavel}%`);
  }

  const { data, error } = await q;
  if (error) {
    return { success: false, content: 'Falha ao consultar indicações.' };
  }

  if (!data?.length) {
    return {
      success: true,
      content: `Nenhuma indicação encontrada${responsavel ? ` para ${responsavel}` : ''}.`,
      structured: { indicacoes: [] },
    };
  }

  const linhas = data.map((i: { id: string; logradouro: string; bairro: string; status: string; classificacao?: string }) =>
    `• **${(i.id as string).substring(0, 8).toUpperCase()}** — ${i.logradouro}, ${i.bairro} [${i.status}]`
  ).join('\n');

  return {
    success: true,
    content: `📋 Indicações encontradas (${data.length}):\n\n${linhas}`,
    structured: {
      indicacoes: data.map((i: { id: string; logradouro: string; bairro: string; status: string }) => ({
        id_curto: (i.id as string).substring(0, 8).toUpperCase(),
        logradouro: i.logradouro,
        bairro: i.bairro,
        status: i.status,
      })),
    },
  };
}

// ── protocolar_indicacao ─────────────────────────────────────────────────────

async function protocolarIndicacao(args: Record<string, unknown>): Promise<AgentResult> {
  const supabase = getSupabase();
  const { id_curto } = args as { id_curto: string };

  const { data: ind } = await supabase
    .from('indicacoes')
    .select('id, protocolado_em')
    .eq('gabinete_id', GABINETE_ID)
    .ilike('id', `${id_curto.toLowerCase()}%`)
    .single();

  if (!ind) {
    return { success: false, content: `Indicação "${id_curto}" não encontrada.` };
  }
  if (ind.protocolado_em) {
    return { success: false, content: `A indicação "${id_curto}" já foi protocolada anteriormente.` };
  }

  // Gerar documento IA
  const gerarRes = await fetch(`${INTERNAL_BASE}/api/indicacoes/gerar-documento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indicacao_id: ind.id }),
  });
  const gerarData = await gerarRes.json() as { ok?: boolean; ementa?: string; error?: string };
  if (!gerarData.ok) {
    return { success: false, content: `Falha na geração do documento: ${gerarData.error ?? 'erro desconhecido'}` };
  }

  // Protocolar no SAPL
  const protRes = await fetch(`${INTERNAL_BASE}/api/sapl/protocolar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ descricao: gerarData.ementa, tipo_sigla: 'IND' }),
  });
  const protData = await protRes.json() as { ok?: boolean; numero_proposicao?: string; sapl_url?: string; error?: string };
  if (!protData.ok) {
    return { success: false, content: `Falha ao protocolar no SAPL: ${protData.error ?? 'erro desconhecido'}` };
  }

  const ano = new Date().getFullYear();
  const saplNumero = `IND ${protData.numero_proposicao}/${ano}`;

  await supabase.from('indicacoes').update({
    protocolado_em: new Date().toISOString(),
    sapl_proposicao_id: protData.numero_proposicao,
    sapl_numero: saplNumero,
    status: 'atendida',
  }).eq('id', ind.id);

  return {
    success: true,
    content: `✅ Indicação protocolada com sucesso!\nNúmero SAPL: **${saplNumero}**\nEmenta: ${gerarData.ementa}\nLink: ${protData.sapl_url ?? 'N/I'}`,
    structured: { sapl: saplNumero, url: protData.sapl_url, ementa: gerarData.ementa },
    actions_taken: [`protocolado:${saplNumero}`],
  };
}

// ── consultar_status ─────────────────────────────────────────────────────────

async function consultarStatus(args: Record<string, unknown>): Promise<AgentResult> {
  const supabase = getSupabase();
  const { id_curto } = args as { id_curto: string };

  const { data: ind } = await supabase
    .from('indicacoes')
    .select('status, protocolado_em, sapl_numero, titulo')
    .eq('gabinete_id', GABINETE_ID)
    .ilike('id', `${id_curto.toLowerCase()}%`)
    .single();

  if (!ind) {
    return { success: false, content: `Indicação "${id_curto}" não encontrada.` };
  }

  const protocolado = ind.protocolado_em
    ? new Date(ind.protocolado_em as string).toLocaleDateString('pt-BR')
    : null;

  const linhas = [
    `📌 Indicação: **${id_curto.toUpperCase()}**`,
    `Status: **${ind.status}**`,
    ind.sapl_numero ? `SAPL: **${ind.sapl_numero}**` : null,
    protocolado ? `Protocolado em: ${protocolado}` : null,
  ].filter(Boolean).join('\n');

  return {
    success: true,
    content: linhas,
    structured: { status: ind.status, protocolado: ind.protocolado_em, sapl_numero: ind.sapl_numero },
  };
}

// ── Agent export ─────────────────────────────────────────────────────────────

export const indicacaoAgent: AliaAgent = {
  name: 'indicacao',
  description: 'Gerencia indicações do gabinete: registrar novos problemas urbanos, listar pendências, protocolar no SAPL e consultar status.',

  async execute({ action, data, context }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    // senderName vem do contexto ou do campo data
    const senderName = (data.sender_name as string) || context.sessionId || 'Equipe';

    try {
      switch (action) {
        case 'registrar_indicacao':
          return await registrarIndicacao(data, senderName);
        case 'listar_indicacoes':
        case 'listar_indicacoes_pendentes':
          return await listarIndicacoes(data, senderName);
        case 'protocolar_indicacao':
          return await protocolarIndicacao(data);
        case 'consultar_status':
          return await consultarStatus(data);
        default:
          return { success: false, content: `Ação desconhecida para o agente de indicações: ${action}` };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro no agente de indicações: ${msg}` };
    }
  },
};
