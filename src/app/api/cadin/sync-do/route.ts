// POST /api/cadin/sync-do
// Scrapa D.O.s do dia (DOERR, DOM-BV, DJE-RR), enfileira PDFs encontrados
// e processa cada job via worker (extração → Gemini → appointments pending_review).
//
// Chamado por: cron diário ou botão manual na UI admin.
// Auth: Bearer CRON_SECRET (cron) ou usuário autenticado (UI).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, isCronAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;
const SELF_URL    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface ScraperEdition {
  source: string;
  date: string;
  pdfUrl: string;
}

/** Tenta descobrir URL do PDF para a data. HEAD request para confirmar existência. */
async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'GabineteCarol-DO-Scraper/1.0' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function discoverEditions(date: Date): Promise<ScraperEdition[]> {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const found: ScraperEdition[] = [];

  // DOERR — Diário Oficial Estado de Roraima
  const doerCandidates = [
    `https://www.doe.rr.gov.br/doe/${yyyy}/${mm}/${dd}/doe_${yyyy}${mm}${dd}.pdf`,
    `https://www.doe.rr.gov.br/doe/${yyyy}${mm}${dd}.pdf`,
  ];
  for (const url of doerCandidates) {
    if (await probeUrl(url)) { found.push({ source: 'doerr', date: dateStr, pdfUrl: url }); break; }
  }

  // DOM-BV — Diário Oficial Município de Boa Vista
  const dombvCandidates = [
    `https://dombv.boavista.rr.gov.br/edicoes/${yyyy}/${mm}/dom_${yyyy}${mm}${dd}.pdf`,
    `https://dombv.boavista.rr.gov.br/edicoes/${yyyy}/dom_${yyyy}${mm}${dd}.pdf`,
  ];
  for (const url of dombvCandidates) {
    if (await probeUrl(url)) { found.push({ source: 'dom-bv', date: dateStr, pdfUrl: url }); break; }
  }

  // DJE-RR — Diário da Justiça Eletrônico
  const djeCandidates = [
    `https://www.tjrr.jus.br/dje/${yyyy}/${mm}/dje_${yyyy}${mm}${dd}.pdf`,
  ];
  for (const url of djeCandidates) {
    if (await probeUrl(url)) { found.push({ source: 'dje-rr', date: dateStr, pdfUrl: url }); break; }
  }

  return found;
}

export async function POST(req: NextRequest) {
  // Aceita: cron (Bearer CRON_SECRET) OU usuário autenticado
  // Fail closed: sem CRON_SECRET configurado = sem acesso via cron
  if (!isCronAuth(req)) {
    const authCheck = await requireAuth(req);
    if (authCheck.error) return authCheck.error;
  }

  let targetDate = new Date();
  try {
    const body = await req.json();
    if (body.target_date) {
      targetDate = new Date(body.target_date);
    }
  } catch (err) {
    // Corpo ausente ou inválido é aceitável, usa a data atual
  }

  const editions   = await discoverEditions(targetDate);

  if (editions.length === 0) {
    return NextResponse.json({
      message: 'Nenhuma edição encontrada para hoje (pode ser feriado ou final de semana).',
      editions_found: 0,
      jobs_queued: 0,
    });
  }

  const supabase = db();
  const jobIds: string[] = [];

  // Enfileira cada PDF encontrado (upsert — idempotente por source_url)
  for (const ed of editions) {
    const { data } = await supabase
      .from('cadin_do_jobs')
      .upsert({
        gabinete_id:  GABINETE_ID,
        source:       ed.source,
        source_url:   ed.pdfUrl,
        edition_date: ed.date,
        status:       'pending',
      }, { onConflict: 'gabinete_id,source_url', ignoreDuplicates: true })
      .select('id')
      .single();

    if (data?.id) jobIds.push(data.id);
  }

  // Processa jobs em background (fire-and-forget via fetch interno)
  // O processamento é pesado (pdf-parse + Gemini) — não bloqueia a resposta
  const workerUrl = `${SELF_URL}/api/cadin/do-jobs/process`;
  fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
    },
    body: JSON.stringify({ job_ids: jobIds }),
  }).catch(() => {
    // Falha silenciosa — jobs ficam em 'pending' para próxima execução
  });

  return NextResponse.json({
    message: 'D.O.s descobertos e enfileirados. Processamento em background.',
    editions_found: editions.length,
    jobs_queued: jobIds.length,
    sources: editions.map(e => e.source),
  });
}
