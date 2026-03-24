/**
 * worker.ts — Processa fila cadin_do_jobs → Gemini Flash → cadin_appointments
 *
 * Fluxo por job:
 *   1. Marca job como 'processing'
 *   2. Extrai PDF com pdf-extractor
 *   3. Envia texto filtrado ao Gemini Flash (gemini-2.0-flash)
 *   4. Insere nomeações em cadin_appointments com pending_review = true
 *   5. Marca job como 'done' ou 'error'
 *
 * Executado por: POST /api/cadin/sync-do  (chamado pelo cron ou manualmente)
 */

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractFromUrl } from './lib/pdf-extractor';

const GABINETE_ID = process.env.GABINETE_ID!;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const GEMINI_EXTRACT_PROMPT = `
Você é um extrator de nomeações de Diários Oficiais brasileiros.

Analise o texto abaixo (trechos de um D.O.) e extraia TODAS as nomeações, exonerações e designações de cargos.

Para cada registro encontrado, retorne um JSON com:
{
  "nome": "Nome completo da pessoa",
  "cargo": "Cargo/título exato mencionado",
  "orgao": "Órgão ou secretaria",
  "tipo": "nomeacao" | "exoneracao" | "designacao",
  "data_portaria": "YYYY-MM-DD ou null",
  "trecho": "Trecho literal do D.O. que fundamenta (máx 300 chars)"
}

Retorne APENAS um array JSON válido. Se não encontrar nenhuma nomeação, retorne [].
Não invente dados. Use apenas o que está explicitamente no texto.

TEXTO DO D.O.:
`.trim();

interface ApointmentExtract {
  nome: string;
  cargo: string;
  orgao: string;
  tipo: 'nomeacao' | 'exoneracao' | 'designacao';
  data_portaria: string | null;
  trecho: string;
}

export async function processJob(jobId: string): Promise<void> {
  const supabase = db();
  const genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
  const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // 1. Busca o job
  const { data: job, error: fetchErr } = await supabase
    .from('cadin_do_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (fetchErr || !job) throw new Error(`Job não encontrado: ${jobId}`);

  // 2. Marca como processing
  await supabase
    .from('cadin_do_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId);

  try {
    // 3. Extrai PDF
    const extracted = await extractFromUrl(job.source_url);

    if (!extracted.hasAppointments) {
      await supabase
        .from('cadin_do_jobs')
        .update({
          status: 'done',
          appointments_found: 0,
          finished_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      return;
    }

    // 4. Gemini extrai nomeações estruturadas
    const prompt = `${GEMINI_EXTRACT_PROMPT}\n\n${extracted.filteredText.slice(0, 900_000)}`;
    const response = await model.generateContent(prompt);
    const raw = response.response.text().trim();

    // Remove markdown code fences se existirem
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
    let items: ApointmentExtract[] = [];
    try {
      items = JSON.parse(jsonStr);
      if (!Array.isArray(items)) items = [];
    } catch {
      items = [];
    }

    // 5. Insere no banco como pending_review = true
    let inserted = 0;
    for (const item of items) {
      if (!item.nome || !item.cargo) continue;

      // Tenta encontrar person pelo nome (match parcial)
      const { data: persons } = await supabase
        .from('cadin_persons')
        .select('id')
        .eq('gabinete_id', GABINETE_ID)
        .ilike('name', `%${item.nome.split(' ')[0]}%`)
        .limit(1);

      // Tenta encontrar organização pelo nome
      const { data: orgs } = await supabase
        .from('cadin_organizations')
        .select('id')
        .eq('gabinete_id', GABINETE_ID)
        .ilike('name', `%${(item.orgao ?? '').split(' ').slice(0, 3).join('%')}%`)
        .limit(1);

      // Só insere se encontrou ao menos a pessoa ou o órgão — dados sem referência ficam em notes
      const personId = persons?.[0]?.id ?? null;
      const orgId    = orgs?.[0]?.id ?? null;

      if (!personId && !orgId) continue; // sem âncora no CADIN, pula

      const { error: insertErr } = await supabase
        .from('cadin_appointments')
        .insert({
          gabinete_id:    GABINETE_ID,
          person_id:      personId,
          organization_id: orgId,
          title:          item.cargo,
          active:         item.tipo !== 'exoneracao',
          pending_review: true,
          do_source_url:  job.source_url,
          do_raw_text:    item.trecho,
          start_date:     item.data_portaria ?? null,
          notes:          `Importado automaticamente do D.O. (${job.source}) — ${item.tipo}. Aguarda revisão.`,
        });

      if (!insertErr) inserted++;
    }

    // 6. Finaliza job
    await supabase
      .from('cadin_do_jobs')
      .update({
        status: 'done',
        appointments_found: inserted,
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId);

  } catch (err) {
    await supabase
      .from('cadin_do_jobs')
      .update({
        status: 'error',
        error_msg: String(err),
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    throw err;
  }
}
