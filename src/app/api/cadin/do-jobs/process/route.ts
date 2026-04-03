// POST /api/cadin/do-jobs/process
// Endpoint interno — processa uma lista de job_ids sequencialmente.
// Chamado em fire-and-forget por /api/cadin/sync-do.
// Também pode ser chamado manualmente para reprocessar um job com erro.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractFromUrl } from '@/lib/do/pdf-extractor';
import { requireAuth, isCronAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const GEMINI_PROMPT = `Você é um extrator inteligente de nomeações de Diários Oficiais brasileiros focado no CADIN (Cadastro de Autoridades).
Sua missão é extrair APENAS nomeações, exonerações e designações de ALTO e MÉDIO ESCALÃO (ex: Secretários, Diretores, Comandantes, Chefes de Setor, Presidentes, Procuradores, Superintendentes, Gerentes, Assessores Especiais).
IGNORE completamente cargos operacionais e de baixo escalão (ex: Assistente, Auxiliar, Motorista, Vigia, Técnico Administrativo, Professor base, Estagiário) a menos que ocupem função de chefia/direção.

Para cada autoridade identificada, retorne um objeto JSON:
{
  "nome": "Nome completo",
  "cargo": "Cargo exato",
  "orgao": "Órgão, secretaria ou departamento",
  "orgao_esfera": "estadual" | "municipal" | "federal" | null,
  "tipo": "nomeacao" | "exoneracao" | "designacao",
  "data_portaria": "YYYY-MM-DD ou null",
  "trecho": "Trecho literal ou resumo (máx 300 chars)"
}

Retorne APENAS um array JSON válido. Se não houver nomeações de alto/médio escalão, retorne [].

TRECHOS DO D.O.:`;

interface ApointmentExtract {
  nome: string;
  cargo: string;
  orgao?: string;
  orgao_esfera?: string | null;
  tipo: 'nomeacao' | 'exoneracao' | 'designacao';
  data_portaria: string | null;
  trecho: string;
}

async function processJobById(jobId: string): Promise<{ inserted: number }> {
  const supabase = db();
  const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
  const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const { data: job } = await supabase
    .from('cadin_do_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('gabinete_id', GABINETE_ID)
    .single();

  if (!job || job.status === 'done') return { inserted: 0 };

  await supabase
    .from('cadin_do_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId);

  try {
    const extracted = await extractFromUrl(job.source_url);

    if (!extracted.hasAppointments) {
      await supabase
        .from('cadin_do_jobs')
        .update({ status: 'done', appointments_found: 0, finished_at: new Date().toISOString() })
        .eq('id', jobId);
      return { inserted: 0 };
    }

    const prompt = `${GEMINI_PROMPT}\n\n${extracted.filteredText.slice(0, 900_000)}`;
    const resp = await model.generateContent(prompt);
    const raw = resp.response.text().trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '');

    let items: ApointmentExtract[] = [];
    try { items = JSON.parse(raw); if (!Array.isArray(items)) items = []; } catch { items = []; }

    let inserted = 0;
    for (const item of items) {
      if (!item.nome || !item.cargo) continue;

      // Smart Triage: Busca nome completo usando textSearch com similaridade/ilike
      // Melhor que o obsoleto .split(' ')[0] que gerava falsos positivos
      const { data: persons } = await supabase
        .from('cadin_persons')
        .select('id, full_name')
        .eq('gabinete_id', GABINETE_ID)
        .ilike('full_name', `%${item.nome.trim()}%`)
        .limit(1);

      const { data: orgs } = item.orgao
        ? await supabase
            .from('cadin_organizations')
            .select('id, name')
            .eq('gabinete_id', GABINETE_ID)
            .ilike('name', `%${item.orgao.split(' ').slice(0, 3).join('%')}%`)
            .limit(1)
        : { data: null };

      const personId = persons?.[0]?.id ?? null;
      const orgId    = orgs?.[0]?.id ?? null;

      // A inserção deve ir para pending_updates, não importando se a pessoa/orgao existe ou não
      const suggestedChanges = {
        full_name: item.nome,
        title: item.cargo,
        active: item.tipo !== 'exoneracao' ? 'true' : 'false',
        organization_name: item.orgao || '',
        sphere: item.orgao_esfera || '',
        start_date: item.data_portaria || '',
      };

      const { error } = await supabase
        .from('cadin_pending_updates')
        .insert({
          gabinete_id: GABINETE_ID,
          person_id: personId, // Pode ser nulo se for Nova Autoridade
          organization_id: orgId, // Pode ser nulo se for Novo Órgão
          update_type: item.tipo,
          extracted_text: item.trecho,
          source_url: job.source_url,
          source_date: item.data_portaria,
          gemini_summary: `${item.tipo.toUpperCase()}: ${item.nome} -> ${item.cargo} (${item.orgao || 'Sem Órgão'})`,
          suggested_changes: suggestedChanges,
          confidence: 0.9,
          status: 'pendente'
        });

      if (!error) inserted++;
      else console.error('Erro ao inserir pending_update:', error);
    }

    await supabase
      .from('cadin_do_jobs')
      .update({ status: 'done', appointments_found: inserted, finished_at: new Date().toISOString() })
      .eq('id', jobId);

    return { inserted };
  } catch (err) {
    await supabase
      .from('cadin_do_jobs')
      .update({ status: 'error', error_msg: String(err), finished_at: new Date().toISOString() })
      .eq('id', jobId);
    return { inserted: 0 };
  }
}

export async function POST(req: NextRequest) {
  if (!isCronAuth(req)) {
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;
  }

  let body: { job_ids?: string[]; job_id?: string };
  try { body = await req.json(); } catch { body = {}; }

  const ids: string[] = body.job_ids ?? (body.job_id ? [body.job_id] : []);
  if (ids.length === 0) return NextResponse.json({ error: 'job_ids obrigatório' }, { status: 400 });

  let totalInserted = 0;
  const results: Record<string, number> = {};

  for (const id of ids) {
    try {
      const { inserted } = await processJobById(id);
      results[id] = inserted;
      totalInserted += inserted;
    } catch {
      results[id] = -1; // erro
    }
  }

  return NextResponse.json({ ok: true, total_inserted: totalInserted, results });
}
