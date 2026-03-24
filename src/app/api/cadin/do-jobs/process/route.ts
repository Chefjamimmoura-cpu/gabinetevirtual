// POST /api/cadin/do-jobs/process
// Endpoint interno — processa uma lista de job_ids sequencialmente.
// Chamado em fire-and-forget por /api/cadin/sync-do.
// Também pode ser chamado manualmente para reprocessar um job com erro.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractFromUrl } from '@/lib/do/pdf-extractor';

const GABINETE_ID = process.env.GABINETE_ID!;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const GEMINI_PROMPT = `Você é um extrator de nomeações de Diários Oficiais brasileiros.

Analise os trechos abaixo e extraia TODAS as nomeações, exonerações e designações.

Para cada registro, retorne JSON:
{
  "nome": "Nome completo",
  "cargo": "Cargo exato",
  "orgao": "Órgão ou secretaria",
  "tipo": "nomeacao" | "exoneracao" | "designacao",
  "data_portaria": "YYYY-MM-DD ou null",
  "trecho": "Trecho literal (máx 300 chars)"
}

Retorne APENAS um array JSON válido. Se não houver nenhuma, retorne [].

TRECHOS DO D.O.:`;

interface ApointmentExtract {
  nome: string;
  cargo: string;
  orgao?: string;
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

      const { data: persons } = await supabase
        .from('cadin_persons')
        .select('id')
        .eq('gabinete_id', GABINETE_ID)
        .ilike('name', `%${item.nome.split(' ')[0]}%`)
        .limit(1);

      const { data: orgs } = item.orgao
        ? await supabase
            .from('cadin_organizations')
            .select('id')
            .eq('gabinete_id', GABINETE_ID)
            .ilike('name', `%${item.orgao.split(' ').slice(0, 3).join('%')}%`)
            .limit(1)
        : { data: null };

      const personId = persons?.[0]?.id ?? null;
      const orgId    = orgs?.[0]?.id ?? null;
      if (!personId && !orgId) continue;

      const { error } = await supabase
        .from('cadin_appointments')
        .insert({
          gabinete_id:     GABINETE_ID,
          person_id:       personId,
          organization_id: orgId,
          title:           item.cargo,
          active:          item.tipo !== 'exoneracao',
          pending_review:  true,
          do_source_url:   job.source_url,
          do_raw_text:     item.trecho,
          start_date:      item.data_portaria ?? null,
          notes:           `Auto-importado do D.O. (${job.source}) — ${item.tipo}. Revisão obrigatória.`,
        });

      if (!error) inserted++;
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
  const auth   = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
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
