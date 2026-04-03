/**
 * POST /api/cadin/assistente/disparar
 *
 * Orquestra o disparo de mensagens WhatsApp personalizadas via CIa:
 *   1. Busca os dados de cada pessoa no Supabase
 *   2. Gera mensagem personalizada com Gemini 2.5 Flash
 *   3. Dispara via Evolution API (WhatsApp)
 *   4. Registra cada resultado em cadin_cia_logs
 *
 * Body: { person_ids: string[], context: string }
 * Response: { total, sent, errors, skipped, results: CiaResult[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '@/lib/supabase/auth-guard';

// ── Lazy singletons (não instanciar no top-level — Next.js avalia durante build) ──
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getGenAI() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface PersonRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  gabinete_id: string;
  cadin_appointments: { title: string; active: boolean }[];
}

interface CiaResult {
  person_id: string;
  person_name: string;
  phone: string;
  status: 'sent' | 'error' | 'skipped';
  message_preview?: string;
  evolution_message_id?: string;
  error?: string;
}

// ── Evolution API helper ──────────────────────────────────────────────────────
async function sendWhatsApp(
  phone: string,
  text: string
): Promise<{ messageId?: string; error?: string }> {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;

  if (!baseUrl || !apiKey || !instance) {
    return { error: 'Evolution API não configurada (variáveis ausentes)' };
  }

  // Normaliza para formato internacional sem símbolos (ex: 5595991234567)
  const normalizedPhone = phone.replace(/\D/g, '');

  try {
    const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({
        number: normalizedPhone,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { error: `Evolution API HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = await res.json();
    // Evolution API retorna { key: { id: "..." }, ... }
    const messageId = data?.key?.id ?? data?.id ?? 'ok';
    return { messageId };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Gerar mensagem com Gemini ─────────────────────────────────────────────────
async function gerarMensagem(
  nomePessoa: string,
  cargo: string,
  contexto: string
): Promise<string> {
  const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `Você é assistente da Vereadora Carol Dantas (CMBV - Boa Vista/RR).
Redija uma mensagem de WhatsApp curta (máximo 3 parágrafos), cordial e profissional para enviar a ${nomePessoa}, ${cargo}.
Contexto / motivo do contato: "${contexto}"

Regras:
- Use o primeiro nome da pessoa naturalmente
- Tom respeitoso e parlamentar, mas caloroso
- Não use emojis excessivos (máximo 1)
- Assine como "Vereadora Carol Dantas"
- Responda APENAS com o texto da mensagem, sem aspas ou explicações extras`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ── Salvar log no Supabase ────────────────────────────────────────────────────
async function salvarLog(payload: {
  gabinete_id: string;
  person_id: string;
  person_name: string;
  person_phone: string;
  person_title: string | null;
  context_input: string;
  message_generated: string;
  status: 'sent' | 'error' | 'skipped';
  evolution_message_id?: string;
  error_message?: string;
}) {
  await getSupabase().from('cadin_cia_logs').insert({
    gabinete_id: payload.gabinete_id,
    person_id: payload.person_id,
    person_name: payload.person_name,
    person_phone: payload.person_phone,
    person_title: payload.person_title,
    context_input: payload.context_input,
    message_generated: payload.message_generated,
    message_preview: payload.message_generated.slice(0, 200),
    status: payload.status,
    evolution_message_id: payload.evolution_message_id ?? null,
    error_message: payload.error_message ?? null,
    dispatched_at: payload.status === 'sent' ? new Date().toISOString() : null,
  });
}

// ── Handler principal ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authCheck = await requireAuth(req);
  if (authCheck.error) return authCheck.error;

  try {
    const body = await req.json();
    const { person_ids, context } = body as {
      person_ids: string[];
      context: string;
    };

    if (!Array.isArray(person_ids) || person_ids.length === 0) {
      return NextResponse.json(
        { error: 'person_ids é obrigatório e não pode ser vazio' },
        { status: 400 }
      );
    }

    if (!context || context.trim().length < 5) {
      return NextResponse.json(
        { error: 'context é obrigatório (descreva o motivo do contato)' },
        { status: 400 }
      );
    }

    // 1. Buscar pessoas + cargos ativos no Supabase
    const { data: rawPersons, error: dbError } = await getSupabase()
      .from('cadin_persons')
      .select(`
        id,
        full_name,
        phone,
        email,
        gabinete_id,
        cadin_appointments (
          title,
          active
        )
      `)
      .in('id', person_ids);

    const persons = (rawPersons ?? []) as PersonRow[];

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    if (!persons || persons.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma pessoa encontrada para os IDs informados' },
        { status: 404 }
      );
    }

    // 2. Processar cada pessoa
    const results: CiaResult[] = [];
    let sent = 0;
    let errors = 0;
    let skipped = 0;

    for (const person of persons) {
      // Sem telefone → pular
      if (!person.phone) {
        skipped++;
        results.push({
          person_id: person.id,
          person_name: person.full_name,
          phone: '',
          status: 'skipped',
          error: 'Telefone não cadastrado',
        });
        continue;
      }

      // Cargo ativo mais recente
      const cargoAtivo =
        person.cadin_appointments?.find((a) => a.active)?.title ??
        person.cadin_appointments?.[0]?.title ??
        'Autoridade';

      let message = '';
      let dispatchResult: { messageId?: string; error?: string } = {};

      try {
        // 3. Gerar mensagem personalizada
        message = await gerarMensagem(person.full_name, cargoAtivo, context.trim());

        // 4. Disparar via Evolution API
        dispatchResult = await sendWhatsApp(person.phone, message);

        if (dispatchResult.error) {
          errors++;
          results.push({
            person_id: person.id,
            person_name: person.full_name,
            phone: person.phone,
            status: 'error',
            message_preview: message.slice(0, 100),
            error: dispatchResult.error,
          });

          await salvarLog({
            gabinete_id: person.gabinete_id,
            person_id: person.id,
            person_name: person.full_name,
            person_phone: person.phone,
            person_title: cargoAtivo,
            context_input: context,
            message_generated: message,
            status: 'error',
            error_message: dispatchResult.error,
          });
        } else {
          sent++;
          results.push({
            person_id: person.id,
            person_name: person.full_name,
            phone: person.phone,
            status: 'sent',
            message_preview: message.slice(0, 100),
            evolution_message_id: dispatchResult.messageId,
          });

          await salvarLog({
            gabinete_id: person.gabinete_id,
            person_id: person.id,
            person_name: person.full_name,
            person_phone: person.phone,
            person_title: cargoAtivo,
            context_input: context,
            message_generated: message,
            status: 'sent',
            evolution_message_id: dispatchResult.messageId,
          });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors++;
        results.push({
          person_id: person.id,
          person_name: person.full_name,
          phone: person.phone,
          status: 'error',
          error: errMsg,
        });

        if (person.gabinete_id) {
          await salvarLog({
            gabinete_id: person.gabinete_id,
            person_id: person.id,
            person_name: person.full_name,
            person_phone: person.phone,
            person_title: cargoAtivo,
            context_input: context,
            message_generated: message,
            status: 'error',
            error_message: errMsg,
          });
        }
      }

      // Delay entre disparos (evitar rate limit da Evolution API)
      if (persons.indexOf(person) < persons.length - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    return NextResponse.json({
      total: persons.length,
      sent,
      errors,
      skipped,
      results,
    });
  } catch (err: unknown) {
    console.error('[CIa] Erro geral:', err);
    return NextResponse.json(
      { error: 'Erro interno no servidor' },
      { status: 500 }
    );
  }
}
