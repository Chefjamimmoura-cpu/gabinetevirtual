// src/app/api/cron/alia-sentinel/route.ts
// GET — Daily cron that runs the CADIN Sentinel.
// Collects from DOU, DOERR, DOMBV, DJE, TSE → analyzes → pending_updates.
// Schedule: 0 6 * * * (6am daily)
// Auth: CRON_SECRET bearer token

import { NextResponse } from 'next/server';
import { DouCollector } from '@/lib/alia/sentinel/collectors/dou-collector';
import { DoerrCollector } from '@/lib/alia/sentinel/collectors/doerr-collector';
import { DombvCollector } from '@/lib/alia/sentinel/collectors/dombv-collector';
import { DjeCollector } from '@/lib/alia/sentinel/collectors/dje-collector';
import { TseCollector } from '@/lib/alia/sentinel/collectors/tse-collector';
import { analyzeEntries, type AuthorityChange as AnalyzedChange } from '@/lib/alia/sentinel/analyzer';
import { processChanges, logSentinelRun, type AuthorityChange } from '@/lib/alia/sentinel/updater';

const GABINETE_ID = process.env.GABINETE_ID!;

const COLLECTORS = [
  new DouCollector(),
  new DoerrCollector(),
  new DombvCollector(),
  new DjeCollector(),
  new TseCollector(),
];

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date();
  const results: Array<{
    source: string;
    entries: number;
    changes: number;
    suggestions: number;
  }> = [];

  try {
    // Run all collectors in parallel
    const collectorResults = await Promise.allSettled(
      COLLECTORS.map(c => c.fetchLatest(today))
    );

    // Process each source's results
    for (let i = 0; i < COLLECTORS.length; i++) {
      const source = COLLECTORS[i].source;
      const collectorResult = collectorResults[i];

      if (collectorResult.status === 'rejected') {
        console.error(`[sentinel] ${source} collector failed:`, collectorResult.reason);
        results.push({ source, entries: 0, changes: 0, suggestions: 0 });
        continue;
      }

      const entries = collectorResult.value;
      if (entries.length === 0) {
        results.push({ source, entries: 0, changes: 0, suggestions: 0 });
        continue;
      }

      // Analyze entries
      const analyzedChanges = await analyzeEntries(entries, GABINETE_ID);

      // Map analyzer output to updater input format
      const changes: AuthorityChange[] = analyzedChanges.map(change => {
        // Map analyzer tipo to updater tipo
        let tipo: AuthorityChange['tipo'] = 'outros';
        if (change.tipo === 'nomeacao') tipo = 'nova_nomecao';
        else if (change.tipo === 'exoneracao') tipo = 'exoneracao';
        else if (change.tipo === 'posse') tipo = 'nova_nomecao';
        else if (change.tipo === 'substituicao') tipo = 'mudanca_cargo';
        else if (change.tipo === 'aposentadoria') tipo = 'exoneracao';

        return {
          matched_person_id: change.matched_person_id,
          confidence: change.confidence,
          tipo,
          campo: change.cargo_novo ? 'cargo' : undefined,
          valor_atual: change.cargo_anterior,
          valor_novo: change.cargo_novo || change.nome,
          source,
          fonte_url: change.fonte_url,
          data_efeito: new Date(change.data_efeito),
          trecho_original: change.trecho_original,
        };
      });

      // Process into pending_updates
      const { created } = await processChanges(changes, GABINETE_ID);

      // Log the run
      await logSentinelRun(
        GABINETE_ID,
        source,
        today,
        entries.length,
        changes.length,
        created,
      );

      results.push({
        source,
        entries: entries.length,
        changes: changes.length,
        suggestions: created,
      });
    }

    return NextResponse.json({
      ok: true,
      date: today.toISOString().split('T')[0],
      results,
      total_entries: results.reduce((s, r) => s + r.entries, 0),
      total_changes: results.reduce((s, r) => s + r.changes, 0),
      total_suggestions: results.reduce((s, r) => s + r.suggestions, 0),
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[alia-sentinel] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
