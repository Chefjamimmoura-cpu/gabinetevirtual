// src/lib/alia/agents/email.agent.ts
// ALIA Agent: Email — triagem inteligente, enriquecimento CADIN e sugestão de respostas.

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const GABINETE_ID = process.env.GABINETE_ID!;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type UrgencyLevel = 'critica' | 'alta' | 'media' | 'baixa' | 'spam';

type EmailCategory =
  | 'intimacao_judicial'
  | 'oficio_recebido'
  | 'convite_evento'
  | 'demanda_cidadao'
  | 'comunicacao_sapl'
  | 'comunicacao_interna'
  | 'newsletter_informativo'
  | 'comercial_spam'
  | 'pessoal'
  | 'outro';

interface EmailClassification {
  email_id: string;
  urgency: UrgencyLevel;
  category: EmailCategory;
  summary: string;
  requires_action: boolean;
  action_deadline?: string | null;
}

interface AgendaEmail {
  id: string;
  gabinete_id: string;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  created_at: string;
}

interface EmailIntelligenceRow {
  id: string;
  email_id: string;
  urgency: UrgencyLevel;
  category: EmailCategory;
  summary: string;
  requires_action: boolean;
  action_deadline: string | null;
  cadin_person_id: string | null;
  cadin_person_name: string | null;
  suggested_actions: string[] | null;
  processed_at: string;
}

const URGENCY_EMOJI: Record<UrgencyLevel, string> = {
  critica: '🔴',
  alta:    '🟠',
  media:   '🟡',
  baixa:   '🟢',
  spam:    '⚫',
};

// ── Gemini helper ─────────────────────────────────────────────────────────────

function getGemini(model = 'gemini-2.5-flash') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada.');
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model });
}

// ── 1. triageEmails ───────────────────────────────────────────────────────────

async function triageEmails(
  _data: Record<string, unknown>,
  gabineteId: string,
): Promise<AgentResult> {
  const supa = getSupabase();

  // Fetch unprocessed emails (no entry in email_intelligence)
  const { data: emails, error: fetchErr } = await supa
    .from('agenda_emails')
    .select('id, subject, from_email, from_name, body_text, body_html, received_at, created_at')
    .eq('gabinete_id', gabineteId)
    .order('received_at', { ascending: false })
    .limit(50);

  if (fetchErr) {
    return { success: false, content: `Falha ao buscar emails: ${fetchErr.message}` };
  }

  if (!emails || emails.length === 0) {
    return { success: true, content: '📧 Nenhum email encontrado para triagem.' };
  }

  // Filter out already-processed emails
  const emailIds = (emails as AgendaEmail[]).map(e => e.id);
  const { data: alreadyProcessed } = await supa
    .from('email_intelligence')
    .select('email_id')
    .in('email_id', emailIds);

  const processedIds = new Set((alreadyProcessed ?? []).map((r: { email_id: string }) => r.email_id));
  const pending = (emails as AgendaEmail[]).filter(e => !processedIds.has(e.id)).slice(0, 10);

  if (pending.length === 0) {
    return {
      success: true,
      content: '📧 Todos os emails recentes já foram triados. Nenhum novo email pendente.',
    };
  }

  let gemini: ReturnType<typeof getGemini> | null = null;
  try {
    gemini = getGemini();
  } catch (err: unknown) {
    return { success: false, content: err instanceof Error ? err.message : String(err) };
  }
  if (!gemini) return { success: false, content: 'Gemini não disponível.' };

  const classificationPrompt = `Você é um classificador de emails para o gabinete de uma vereadora.
Analise cada email abaixo e retorne um JSON com esta estrutura exata para CADA email (array de objetos):
[
  {
    "email_id": "id-do-email",
    "urgency": "critica|alta|media|baixa|spam",
    "category": "intimacao_judicial|oficio_recebido|convite_evento|demanda_cidadao|comunicacao_sapl|comunicacao_interna|newsletter_informativo|comercial_spam|pessoal|outro",
    "summary": "Resumo em 1 frase do conteúdo",
    "requires_action": true/false,
    "action_deadline": "YYYY-MM-DD ou null"
  }
]

Critérios de urgência:
- critica: intimações judiciais, prazos legais iminentes (≤24h), emergências institucionais
- alta: ofícios que requerem resposta, demandas com prazo próximo (≤7 dias), convites institucionais importantes
- media: demandas de cidadãos, convites eventuais, comunicações internas
- baixa: informativos, newsletters, comunicações sem urgência
- spam: publicidade, emails comerciais indesejados, phishing

EMAILS PARA CLASSIFICAR:
${pending.map(e => `
--- EMAIL ID: ${e.id} ---
De: ${e.from_name ?? ''} <${e.from_email ?? ''}>
Assunto: ${e.subject ?? '(sem assunto)'}
Recebido em: ${e.received_at ?? e.created_at}
Corpo:
${(e.body_text ?? e.body_html ?? '(sem conteúdo)').slice(0, 800)}
`).join('\n')}

Retorne APENAS o JSON, sem explicações adicionais.`;

  let classifications: EmailClassification[] = [];
  try {
    const result = await gemini.generateContent(classificationPrompt);
    const raw = result.response.text().trim();
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    classifications = JSON.parse(jsonStr) as EmailClassification[];
  } catch {
    return { success: false, content: 'Falha ao classificar emails com IA. Tente novamente.' };
  }

  // Enrich with CADIN cross-reference
  const fromEmails = pending.map(e => e.from_email).filter((e): e is string => e !== null);
  const uniqueFromEmails = Array.from(new Set(fromEmails));
  const senderEmails: string[] = uniqueFromEmails;
  const cadinMatches: Record<string, { id: string; full_name: string }> = {};

  if (senderEmails.length > 0) {
    const { data: cadinPersons } = await supa
      .from('cadin_persons')
      .select('id, full_name, email')
      .in('email', senderEmails);

    (cadinPersons ?? []).forEach((p: { id: string; full_name: string; email: string | null }) => {
      if (p.email) cadinMatches[p.email.toLowerCase()] = { id: p.id, full_name: p.full_name };
    });
  }

  // Insert results into email_intelligence
  const insertRows = classifications.map(c => {
    const emailRecord = pending.find(e => e.id === c.email_id);
    const senderEmail = emailRecord?.from_email?.toLowerCase() ?? '';
    const cadinMatch = cadinMatches[senderEmail] ?? null;

    const suggestedActions: string[] = [];
    if (c.urgency === 'critica') suggestedActions.push('Atenção imediata necessária');
    if (c.urgency === 'alta') suggestedActions.push('Responder em até 48h');
    if (c.category === 'intimacao_judicial') suggestedActions.push('Encaminhar para assessoria jurídica');
    if (c.category === 'oficio_recebido') suggestedActions.push('Protocolar e encaminhar ao setor responsável');
    if (c.category === 'convite_evento') suggestedActions.push('Confirmar disponibilidade na agenda');
    if (c.category === 'demanda_cidadao') suggestedActions.push('Registrar demanda e providenciar resposta');

    return {
      email_id:         c.email_id,
      gabinete_id:      gabineteId,
      urgency:          c.urgency,
      category:         c.category,
      summary:          c.summary,
      requires_action:  c.requires_action,
      action_deadline:  c.action_deadline ?? null,
      cadin_person_id:  cadinMatch?.id ?? null,
      cadin_person_name: cadinMatch?.full_name ?? null,
      suggested_actions: suggestedActions.length > 0 ? suggestedActions : null,
      processed_at:     new Date().toISOString(),
    };
  });

  const { error: insertErr } = await supa.from('email_intelligence').insert(insertRows);
  if (insertErr) {
    return { success: false, content: `Falha ao salvar triagem: ${insertErr.message}` };
  }

  const urgentes = insertRows.filter(r => r.urgency === 'critica' || r.urgency === 'alta').length;
  const pendentesAcao = insertRows.filter(r => r.requires_action).length;
  const spamCount = insertRows.filter(r => r.urgency === 'spam').length;

  const linhas = insertRows
    .filter(r => r.urgency !== 'spam')
    .map(r => {
      const emoji = URGENCY_EMOJI[r.urgency];
      const email = pending.find(e => e.id === r.email_id);
      return `${emoji} **${email?.subject ?? '(sem assunto)'}**\n  De: ${email?.from_name ?? email?.from_email ?? 'Desconhecido'}${r.cadin_person_name ? ` *(CADIN: ${r.cadin_person_name})*` : ''}\n  ${r.summary}`;
    })
    .join('\n\n');

  return {
    success: true,
    content: `📧 **${pending.length} emails triados:** ${urgentes} urgentes, ${pendentesAcao} pendentes de ação${spamCount > 0 ? `, ${spamCount} spam` : ''}.\n\n${linhas}`,
    structured: { triados: pending.length, urgentes, pendentes_acao: pendentesAcao, spam: spamCount, resultados: insertRows },
    actions_taken: [`emails_triados:${pending.length}`],
  };
}

// ── 2. consultarEmails ────────────────────────────────────────────────────────

async function consultarEmails(
  data: Record<string, unknown>,
  gabineteId: string,
): Promise<AgentResult> {
  const supa = getSupabase();
  const texto = ((data.text as string) || '').toLowerCase();

  // Detect urgency filter from natural language
  let urgencyFilter: UrgencyLevel | null = null;
  if (texto.includes('crít') || texto.includes('critica') || texto.includes('urgente')) {
    urgencyFilter = 'critica';
  } else if (texto.includes('alta')) {
    urgencyFilter = 'alta';
  } else if (texto.includes('media') || texto.includes('média')) {
    urgencyFilter = 'media';
  } else if (texto.includes('baixa')) {
    urgencyFilter = 'baixa';
  } else if (texto.includes('spam')) {
    urgencyFilter = 'spam';
  }

  // Detect category filter
  let categoryFilter: EmailCategory | null = null;
  if (texto.includes('judicial') || texto.includes('intimação') || texto.includes('intimacao')) {
    categoryFilter = 'intimacao_judicial';
  } else if (texto.includes('ofício') || texto.includes('oficio')) {
    categoryFilter = 'oficio_recebido';
  } else if (texto.includes('convite') || texto.includes('evento')) {
    categoryFilter = 'convite_evento';
  } else if (texto.includes('cidadão') || texto.includes('cidadao') || texto.includes('demanda')) {
    categoryFilter = 'demanda_cidadao';
  } else if (texto.includes('sapl')) {
    categoryFilter = 'comunicacao_sapl';
  } else if (texto.includes('interna')) {
    categoryFilter = 'comunicacao_interna';
  }

  // Build query
  let query = supa
    .from('email_intelligence')
    .select(`
      id, email_id, urgency, category, summary, requires_action,
      action_deadline, cadin_person_name, suggested_actions, processed_at,
      agenda_emails!inner ( subject, from_email, from_name, received_at )
    `)
    .eq('gabinete_id', gabineteId)
    .order('processed_at', { ascending: false })
    .limit(20);

  if (urgencyFilter) {
    query = query.eq('urgency', urgencyFilter);
  }
  if (categoryFilter) {
    query = query.eq('category', categoryFilter);
  }

  // Default: show only non-spam, requiring action
  if (!urgencyFilter && !categoryFilter && (texto.includes('pendente') || texto.includes('ação') || texto.includes('acao'))) {
    query = query.eq('requires_action', true).neq('urgency', 'spam');
  } else if (!urgencyFilter && !categoryFilter) {
    query = query.neq('urgency', 'spam');
  }

  const { data: rows, error } = await query;

  if (error) {
    return { success: false, content: `Falha ao consultar emails: ${error.message}` };
  }

  if (!rows || rows.length === 0) {
    return {
      success: true,
      content: '📧 Nenhum email encontrado com os filtros informados. Tente rodar a triagem primeiro.',
    };
  }

  type QueryRow = {
    id: string;
    email_id: string;
    urgency: UrgencyLevel;
    category: EmailCategory;
    summary: string;
    requires_action: boolean;
    action_deadline: string | null;
    cadin_person_name: string | null;
    suggested_actions: string[] | null;
    processed_at: string;
    agenda_emails: { subject: string | null; from_email: string | null; from_name: string | null; received_at: string | null } | null;
  };

  const linhas = (rows as unknown as QueryRow[]).map(r => {
    const emoji = URGENCY_EMOJI[r.urgency] ?? '📧';
    const email = r.agenda_emails;
    const acoes = r.suggested_actions?.join(', ') ?? '';
    const prazo = r.action_deadline ? ` — prazo: ${r.action_deadline}` : '';
    const cadin = r.cadin_person_name ? ` *(CADIN: ${r.cadin_person_name})*` : '';
    const data = email?.received_at
      ? new Date(email.received_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : '';

    return [
      `${emoji} **${email?.subject ?? '(sem assunto)'}**${prazo}`,
      `  De: ${email?.from_name ?? email?.from_email ?? 'Desconhecido'}${cadin} ${data ? `(${data})` : ''}`,
      `  ${r.summary}`,
      acoes ? `  ➡ ${acoes}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const titulo = urgencyFilter
    ? `Emails ${URGENCY_EMOJI[urgencyFilter]} ${urgencyFilter}`
    : categoryFilter
      ? `Emails — ${categoryFilter.replace(/_/g, ' ')}`
      : 'Emails recentes triados';

  return {
    success: true,
    content: `📧 **${titulo}** (${rows.length} resultado${rows.length !== 1 ? 's' : ''}):\n\n${linhas}`,
    structured: { total: rows.length, emails: rows },
  };
}

// ── 3. sugerirResposta ────────────────────────────────────────────────────────

async function sugerirResposta(data: Record<string, unknown>): Promise<AgentResult> {
  const emailId = data.email_id as string | undefined;

  if (!emailId) {
    return {
      success: false,
      content: 'Informe o ID do email para o qual deseja sugerir uma resposta.',
    };
  }

  const supa = getSupabase();

  const { data: email, error: emailErr } = await supa
    .from('agenda_emails')
    .select('id, subject, from_email, from_name, body_text, body_html, received_at')
    .eq('id', emailId)
    .single();

  if (emailErr || !email) {
    return { success: false, content: `Email não encontrado: ${emailErr?.message ?? 'ID inválido'}` };
  }

  // Also fetch intelligence metadata for context
  const { data: intel } = await supa
    .from('email_intelligence')
    .select('category, urgency, summary, cadin_person_name, suggested_actions')
    .eq('email_id', emailId)
    .single();

  let gemini: ReturnType<typeof getGemini> | null = null;
  try {
    gemini = getGemini();
  } catch (err: unknown) {
    return { success: false, content: err instanceof Error ? err.message : String(err) };
  }
  if (!gemini) return { success: false, content: 'Gemini não disponível.' };

  const emailRecord = email as AgendaEmail;
  const hoje = new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' });
  const categoria = intel?.category ?? 'outro';
  const remetente = emailRecord.from_name ?? emailRecord.from_email ?? 'Prezado(a)';
  const corpo = (emailRecord.body_text ?? emailRecord.body_html ?? '').slice(0, 1500);

  const prompt = `Você é assessor(a) parlamentar da Vereadora Carol Dantas (Câmara Municipal de Boa Vista/RR).
Redija um rascunho de resposta profissional em português para o email abaixo.

INFORMAÇÕES DO EMAIL:
- Data: ${emailRecord.received_at ?? ''}
- De: ${emailRecord.from_name ?? ''} <${emailRecord.from_email ?? ''}>
- Assunto: ${emailRecord.subject ?? '(sem assunto)'}
- Categoria: ${categoria}${intel?.summary ? `\n- Resumo IA: ${intel.summary}` : ''}${intel?.cadin_person_name ? `\n- Remetente identificado no CADIN: ${intel.cadin_person_name}` : ''}
- Corpo:
${corpo}

INSTRUÇÕES PARA A RESPOSTA:
- Tom formal e respeitoso, adequado ao contexto legislativo municipal
- Trate o(a) remetente como "${remetente}" ou pelo cargo se identificado
- Estrutura: saudação → reconhecimento da mensagem → resposta/encaminhamento → despedida formal
- Assine como: Gabinete da Vereadora Carol Dantas | CMBV
- Data: ${hoje}
- Tamanho: 3–5 parágrafos objetivos
- Se for intimação judicial, mencione que será encaminhada ao setor jurídico
- Se for demanda de cidadão, demonstre atenção e informe prazo estimado
- NÃO invente informações factuais; use marcadores [COMPLETAR] onde o assessor deve preencher detalhes específicos`;

  let rascunho = '';
  try {
    const result = await gemini.generateContent(prompt);
    rascunho = result.response.text().trim();
  } catch {
    return { success: false, content: 'Falha ao gerar rascunho de resposta. Tente novamente.' };
  }

  if (!rascunho) {
    return { success: false, content: 'O modelo não retornou rascunho.' };
  }

  return {
    success: true,
    content: `📝 **Rascunho de resposta para:** ${emailRecord.subject ?? '(sem assunto)'}\n\n---\n\n${rascunho}`,
    structured: {
      email_id: emailId,
      subject: emailRecord.subject,
      from: emailRecord.from_email,
      rascunho,
    },
    actions_taken: [`rascunho_gerado:${emailId}`],
  };
}

// ── Agent export ──────────────────────────────────────────────────────────────

export const emailAgent: AliaAgent = {
  name: 'email',
  description: 'Triagem e gestão inteligente de emails do gabinete',

  async execute({ action, data, context }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const gabineteId = context.gabineteId || GABINETE_ID;

      switch (action) {
        case 'triagem':         return await triageEmails(data, gabineteId);
        case 'consultar':       return await consultarEmails(data, gabineteId);
        case 'sugerir_resposta': return await sugerirResposta(data);
        default:                return await consultarEmails(data, gabineteId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro no agente de email: ${msg}` };
    }
  },
};
