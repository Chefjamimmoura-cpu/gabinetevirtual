// src/lib/alia/sentinel/updater.ts
// Sentinel updater — processes analyzed changes and creates pending_updates rows
// NEVER modifies CADIN directly. Creates curadoria queue entries for human review.

import { createClient } from '@supabase/supabase-js';

/**
 * Authority change detected from monitoring sources (DOs, DJE, news, etc.)
 */
export interface AuthorityChange {
  matched_person_id?: string;      // UUID if person matched in CADIN
  confidence: number;              // 0.0–1.0 confidence score
  tipo: string;                    // 'nova_nomecao' | 'exoneracao' | 'mudanca_cargo' | 'novo_orgao' | 'dado_contato' | 'aniversario' | 'outros'
  campo?: string;                  // 'cargo', 'telefone', etc. — defaults to 'cargo'
  valor_atual?: string;            // current value from CADIN (if known)
  valor_novo: string;              // new value from source
  source: string;                  // 'doerr' | 'dombv' | 'dou' | 'dje' | 'tse' | source name
  fonte_url?: string;              // URL of the publication
  data_efeito: Date;               // effective date or publication date
  trecho_original: string;         // original text excerpt
}

/**
 * Processes analyzed authority changes and creates pending_updates rows.
 * Returns counts of created and skipped rows.
 */
export async function processChanges(
  changes: AuthorityChange[],
  gabineteId: string,
): Promise<{ created: number; skipped: number }> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let created = 0;
  let skipped = 0;

  for (const change of changes) {
    try {
      // Only process if high confidence match or relevant new authority
      if (change.matched_person_id && change.confidence >= 0.8) {
        // High confidence match — check for duplicates
        const sourceDate = change.data_efeito.toISOString().split('T')[0];

        const { data: existing } = await db
          .from('cadin_pending_updates')
          .select('id')
          .eq('gabinete_id', gabineteId)
          .eq('person_id', change.matched_person_id)
          .eq('update_type', change.tipo)
          .eq('source_date', sourceDate)
          .limit(1);

        if (existing && existing.length > 0) {
          skipped++;
          continue;
        }

        // Insert pending update for curation
        const { error } = await db
          .from('cadin_pending_updates')
          .insert({
            gabinete_id: gabineteId,
            person_id: change.matched_person_id,
            update_type: change.tipo,
            extracted_text: change.trecho_original,
            source_url: change.fonte_url,
            source_date: sourceDate,
            suggested_changes: {
              campo: change.campo || 'cargo',
              valor_atual: change.valor_atual,
              valor_novo: change.valor_novo,
            },
            confidence: change.confidence,
            status: 'pendente',
          });

        if (error) {
          console.error('[sentinel:updater] Insert error:', error);
          skipped++;
        } else {
          created++;
        }
      } else if (!change.matched_person_id && change.confidence >= 0.6) {
        // No match but high-enough confidence for new record suggestion
        const sourceDate = change.data_efeito.toISOString().split('T')[0];

        // Duplicate check: same source_date + extracted_text + tipo
        const { data: existing } = await db
          .from('cadin_pending_updates')
          .select('id')
          .eq('gabinete_id', gabineteId)
          .eq('update_type', 'novo_cadastro')
          .eq('source_date', sourceDate)
          .textSearch('extracted_text', change.valor_novo.slice(0, 50))
          .limit(1);

        if (existing && existing.length > 0) {
          skipped++;
          continue;
        }

        const { error } = await db
          .from('cadin_pending_updates')
          .insert({
            gabinete_id: gabineteId,
            update_type: 'novo_cadastro',
            extracted_text: change.trecho_original,
            source_url: change.fonte_url,
            source_date: sourceDate,
            suggested_changes: {
              nome: change.valor_novo,
              cargo: change.campo || 'cargo',
            },
            confidence: change.confidence,
            status: 'pendente',
          });

        if (error) {
          console.error('[sentinel:updater] Insert novo_cadastro error:', error);
          skipped++;
        } else {
          created++;
        }
      } else {
        // Below confidence threshold — skip
        skipped++;
      }
    } catch (err) {
      console.error('[sentinel:updater] Unexpected error processing change:', err);
      skipped++;
    }
  }

  return { created, skipped };
}

/**
 * Logs sentinel run execution for audit trail.
 */
export async function logSentinelRun(
  gabineteId: string,
  source: string,
  dateChecked: Date,
  entriesFound: number,
  changesDetected: number,
  newSuggestions: number,
  rawLog?: Record<string, unknown>,
): Promise<void> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const { error } = await db
      .from('cadin_sentinel_logs')
      .insert({
        gabinete_id: gabineteId,
        source,
        date_checked: dateChecked.toISOString(),
        entries_found: entriesFound,
        changes_detected: changesDetected,
        new_suggestions: newSuggestions,
        raw_log: rawLog || {},
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[sentinel:updater] logSentinelRun error:', error);
    }
  } catch (err) {
    console.error('[sentinel:updater] Unexpected error logging run:', err);
  }
}
