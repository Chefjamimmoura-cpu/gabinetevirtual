// GET /api/pareceres/relatoria/buscar
// Busca uma matéria por identificador legível (ex: "PLL 32/2026" ou "32/2026")
// ou por ID numérico direto do SAPL.
//
// Query params:
//   q — identificador da matéria. Aceita:
//       - ID puro: "12345"
//       - Número/Ano: "32/2026"
//       - Tipo+Número/Ano: "PLL 32/2026", "PL 15/2026"
//
// Retorna o id SAPL numérico da matéria encontrada + dados básicos.
// Se não encontrado na cache, tenta busca live no SAPL.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth-guard';
import { createClient } from '@supabase/supabase-js';
import { fetchMateria } from '@/lib/sapl/client';

const GABINETE_ID = process.env.GABINETE_ID!;
const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface ParsedQuery {
  tipo: string | null;
  numero: number | null;
  ano: number | null;
  rawId: number | null;
}

/**
 * Parseia o input do usuário:
 * - "12345"          → rawId = 12345
 * - "32/2026"        → numero = 32, ano = 2026, tipo = null
 * - "PLL 32/2026"    → tipo = 'PLL', numero = 32, ano = 2026
 * - "PL 15/2026"     → tipo = 'PL', numero = 15, ano = 2026
 */
function parseQuery(q: string): ParsedQuery {
  const trimmed = q.trim().toUpperCase();

  // Apenas número — SAPL ID direto
  if (/^\d+$/.test(trimmed)) {
    return { rawId: parseInt(trimmed), tipo: null, numero: null, ano: null };
  }

  // Padrão tipo + número/ano: "PLL 32/2026" ou "PLL32/2026"
  const fullMatch = trimmed.match(/^([A-Z]+)\s*(\d+)\s*\/\s*(\d{4})$/);
  if (fullMatch) {
    return {
      rawId: null,
      tipo: fullMatch[1],
      numero: parseInt(fullMatch[2]),
      ano: parseInt(fullMatch[3]),
    };
  }

  // Apenas número/ano: "32/2026"
  const shortMatch = trimmed.match(/^(\d+)\s*\/\s*(\d{4})$/);
  if (shortMatch) {
    return {
      rawId: null,
      tipo: null,
      numero: parseInt(shortMatch[1]),
      ano: parseInt(shortMatch[2]),
    };
  }

  return { rawId: null, tipo: null, numero: null, ano: null };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ error: 'Parâmetro "q" é obrigatório (ex: PLL 32/2026 ou ID numérico)' }, { status: 400 });
  }

  const parsed = parseQuery(q);

  // 1. Se for ID puro, tenta direto no SAPL (live)
  if (parsed.rawId) {
    try {
      const materia = await fetchMateria(parsed.rawId);
      return NextResponse.json({
        found: true,
        source: 'sapl_live',
        materia: {
          id: materia.id,
          tipo_sigla: (materia as { tipo_sigla?: string }).tipo_sigla || '',
          numero: materia.numero,
          ano: materia.ano,
          ementa: materia.ementa || '',
          sapl_url: `${SAPL_BASE}/materia/${materia.id}`,
        },
      });
    } catch {
      return NextResponse.json({ found: false, error: `Matéria ID ${parsed.rawId} não encontrada no SAPL` }, { status: 404 });
    }
  }

  if (!parsed.numero || !parsed.ano) {
    return NextResponse.json({
      found: false,
      error: 'Formato inválido. Use: "PLL 32/2026", "32/2026" ou o ID numérico do SAPL',
    }, { status: 400 });
  }

  // 2. Busca na cache por tipo_sigla + numero + ano
  const db = supabase();
  let query = db
    .from('sapl_materias_cache')
    .select('id, tipo_sigla, numero, ano, ementa, autores')
    .eq('gabinete_id', GABINETE_ID)
    .eq('numero', parsed.numero)
    .eq('ano', parsed.ano);

  if (parsed.tipo) {
    query = query.ilike('tipo_sigla', parsed.tipo);
  }

  const { data, error } = await query.limit(5);

  if (error) {
    console.error('[GET /api/pareceres/relatoria/buscar]', error);
    return NextResponse.json({ error: 'Falha ao buscar na cache' }, { status: 500 });
  }

  if (data && data.length > 0) {
    // Se múltiplos resultados (sem tipo filtrado), retorna todos para o usuário escolher
    return NextResponse.json({
      found: true,
      source: 'cache',
      materias: data.map(m => ({
        id: m.id,
        tipo_sigla: m.tipo_sigla,
        numero: m.numero,
        ano: m.ano,
        ementa: m.ementa || '',
        sapl_url: `${SAPL_BASE}/materia/${m.id}`,
      })),
      materia: data.length === 1 ? {
        id: data[0].id,
        tipo_sigla: data[0].tipo_sigla,
        numero: data[0].numero,
        ano: data[0].ano,
        ementa: data[0].ementa || '',
        sapl_url: `${SAPL_BASE}/materia/${data[0].id}`,
      } : null,
    });
  }

  // 3. Não encontrado na cache — tenta busca live no SAPL pela API de matérias
  try {
    const tipoParam = parsed.tipo ? `&tipo__sigla=${encodeURIComponent(parsed.tipo)}` : '';
    const saplUrl = `${SAPL_BASE}/api/materia/materia/?numero=${parsed.numero}&ano=${parsed.ano}${tipoParam}`;
    const resp = await fetch(saplUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });

    if (resp.ok) {
      const json = await resp.json() as { results?: { id: number; numero: number; ano: number; ementa?: string; tipo?: { sigla?: string } }[] };
      const results = json.results || [];
      if (results.length > 0) {
        const m = results[0];
        const tipoSigla = m.tipo?.sigla || parsed.tipo || '';
        return NextResponse.json({
          found: true,
          source: 'sapl_api',
          materias: results.map(r => ({
            id: r.id,
            tipo_sigla: r.tipo?.sigla || '',
            numero: r.numero,
            ano: r.ano,
            ementa: r.ementa || '',
            sapl_url: `${SAPL_BASE}/materia/${r.id}`,
          })),
          materia: {
            id: m.id,
            tipo_sigla: tipoSigla,
            numero: m.numero,
            ano: m.ano,
            ementa: m.ementa || '',
            sapl_url: `${SAPL_BASE}/materia/${m.id}`,
          },
        });
      }
    }
  } catch {
    // SAPL live indisponível — não bloqueia
  }

  return NextResponse.json({
    found: false,
    error: `Matéria "${q}" não encontrada na cache nem no SAPL. Verifique o número e o ano.`,
  }, { status: 404 });
}
