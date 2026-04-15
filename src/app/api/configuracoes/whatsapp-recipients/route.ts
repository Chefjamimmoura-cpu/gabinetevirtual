// src/app/api/configuracoes/whatsapp-recipients/route.ts
// GET: lista todos os recipients do gabinete
// POST: cria um novo recipient (máximo 5 ativos, validado por trigger no DB)

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

function db() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function getProfile(userId: string) {
  const supabase = await createServerClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, gabinete_id, role')
    .eq('id', userId)
    .single();

  return profile;
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const profile = await getProfile(auth.user.id);
  if (!profile?.gabinete_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await db()
    .from('gabinete_whatsapp_recipients')
    .select('*')
    .eq('gabinete_id', profile.gabinete_id)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ recipients: data ?? [] });
}

// ── POST ─────────────────────────────────────────────────────────────────────

interface CreateBody {
  nome: string;
  cargo?: string;
  telefone: string;
  event_types_allowed?: string[];
  quiet_start?: string | null;
  quiet_end?: string | null;
  max_daily?: number;
  digest_enabled?: boolean;
  enabled?: boolean;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const profile = await getProfile(auth.user.id);
  if (!profile?.gabinete_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (profile.role !== 'admin' && profile.role !== 'vereador') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.nome?.trim() || !body.telefone?.trim()) {
    return NextResponse.json(
      { error: 'nome e telefone são obrigatórios' },
      { status: 400 },
    );
  }

  const telefone = body.telefone.replace(/\D/g, '');
  if (telefone.length < 10 || telefone.length > 15) {
    return NextResponse.json(
      { error: 'Telefone inválido. Use formato E.164 (ex: 5595991234567)' },
      { status: 400 },
    );
  }

  const { data, error } = await db()
    .from('gabinete_whatsapp_recipients')
    .insert({
      gabinete_id: profile.gabinete_id,
      nome: body.nome.trim(),
      cargo: body.cargo?.trim() || null,
      telefone,
      event_types_allowed: body.event_types_allowed ?? [],
      quiet_start: body.quiet_start || null,
      quiet_end: body.quiet_end || null,
      max_daily: body.max_daily ?? 20,
      digest_enabled: body.digest_enabled ?? true,
      enabled: body.enabled ?? true,
      created_by: profile.id,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes('Limite de 5 recipients')) {
      return NextResponse.json(
        { error: 'Limite de 5 recipients ativos atingido. Desative algum antes de adicionar outro.' },
        { status: 400 },
      );
    }
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Este telefone já está cadastrado neste gabinete.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ recipient: data });
}
