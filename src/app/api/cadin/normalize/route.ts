// POST /api/cadin/normalize
// Normaliza os dados do CADIN: migra informações que ficaram presas no campo
// legado "notes" (texto livre) para as colunas estruturadas corretas (v2).
//
// Campos migrados das notas → colunas dedicadas:
//   "Aniversário: MM-DD"       → birthday (MM-DD)
//   "Chefe de Gabinete: Nome"  → chefe_gabinete
//
// Idempotente: só atualiza registros onde a coluna de destino está NULL.
// Seguro para rodar múltiplas vezes.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;

function supa() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Parsers de campos legados ─────────────────────────────────────────────────

function parseBirthday(notes: string): string | null {
  // Formatos aceitos nas notas: "Aniversário: MM-DD" ou "Aniversário: DD/MM"
  const m1 = notes.match(/Aniversário:\s*(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}`; // já está MM-DD

  const m2 = notes.match(/Aniversário:\s*(\d{2})\/(\d{2})/);
  if (m2) return `${m2[2]}-${m2[1]}`; // DD/MM → MM-DD

  return null;
}

function parseChefeGab(notes: string): string | null {
  const m = notes.match(/Chefe de Gabinete:\s*([^;\n]+)/);
  return m ? m[1].trim() : null;
}

// ── Normalização do nome parlamentar ─────────────────────────────────────────
// Extrai abreviação/apelido parlamentar se estiver em notas como:
// "Nome Parlamentar: Fulano" ou "Apelido: Beltrano"

function parseNomeParlamentar(notes: string): string | null {
  const m = notes.match(/(?:Nome Parlamentar|Apelido):\s*([^;\n]+)/i);
  return m ? m[1].trim() : null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const db = supa();

  // 1. Busca todos os registros do gabinete que têm notes preenchido
  const { data: persons, error } = await db
    .from('cadin_persons')
    .select('id, notes, birthday, chefe_gabinete, nome_parlamentar')
    .eq('gabinete_id', GABINETE_ID)
    .not('notes', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stats = {
    total: persons?.length ?? 0,
    birthday_migrated: 0,
    chefe_gab_migrated: 0,
    nome_parlamentar_migrated: 0,
    skipped: 0,
    errors: 0,
  };

  // 2. Para cada registro, extrai campos das notas e atualiza colunas
  for (const p of persons ?? []) {
    const notes = p.notes as string;
    const patch: Record<string, string> = {};

    // Birthday: só migra se a coluna ainda está vazia
    if (!p.birthday) {
      const bd = parseBirthday(notes);
      if (bd) { patch.birthday = bd; stats.birthday_migrated++; }
    }

    // Chefe de gabinete: só migra se vazio
    if (!p.chefe_gabinete) {
      const cg = parseChefeGab(notes);
      if (cg) { patch.chefe_gabinete = cg; stats.chefe_gab_migrated++; }
    }

    // Nome parlamentar: só migra se vazio
    if (!p.nome_parlamentar) {
      const np = parseNomeParlamentar(notes);
      if (np) { patch.nome_parlamentar = np; stats.nome_parlamentar_migrated++; }
    }

    if (Object.keys(patch).length === 0) {
      stats.skipped++;
      continue;
    }

    const { error: updateErr } = await db
      .from('cadin_persons')
      .update(patch)
      .eq('id', p.id);

    if (updateErr) {
      console.error(`[normalize] erro ao atualizar ${p.id}:`, updateErr.message);
      stats.errors++;
    }
  }

  return NextResponse.json({
    message: 'Normalização concluída',
    ...stats,
  });
}

// GET: retorna prévia do que seria migrado (dry-run, sem alterar dados)
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const db = supa();

  const { data: persons, error } = await db
    .from('cadin_persons')
    .select('id, full_name, notes, birthday, chefe_gabinete, nome_parlamentar')
    .eq('gabinete_id', GABINETE_ID)
    .not('notes', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const preview = (persons ?? [])
    .map(p => {
      const notes = p.notes as string;
      const bd = !p.birthday ? parseBirthday(notes) : null;
      const cg = !p.chefe_gabinete ? parseChefeGab(notes) : null;
      const np = !p.nome_parlamentar ? parseNomeParlamentar(notes) : null;
      if (!bd && !cg && !np) return null;
      return {
        id: p.id,
        nome: p.full_name,
        migracao: {
          ...(bd ? { birthday: bd } : {}),
          ...(cg ? { chefe_gabinete: cg } : {}),
          ...(np ? { nome_parlamentar: np } : {}),
        },
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    dry_run: true,
    total_com_notes: persons?.length ?? 0,
    pendentes_migracao: preview.length,
    registros: preview,
  });
}
