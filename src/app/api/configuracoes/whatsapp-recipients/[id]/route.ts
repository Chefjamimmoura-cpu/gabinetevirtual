// src/app/api/configuracoes/whatsapp-recipients/[id]/route.ts
// PATCH: atualiza um recipient
// DELETE: remove um recipient

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

// ── PATCH ────────────────────────────────────────────────────────────────────

interface UpdateBody {
  nome?: string;
  cargo?: string | null;
  telefone?: string;
  event_types_allowed?: string[];
  quiet_start?: string | null;
  quiet_end?: string | null;
  max_daily?: number;
  digest_enabled?: boolean;
  enabled?: boolean;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { id } = await ctx.params;
  const profile = await getProfile(auth.user.id);
  if (!profile?.gabinete_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (profile.role !== 'admin' && profile.role !== 'vereador') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: UpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Verify recipient belongs to user's gabinete
  const { data: existing } = await db()
    .from('gabinete_whatsapp_recipients')
    .select('id, gabinete_id')
    .eq('id', id)
    .maybeSingle();

  if (!existing || existing.gabinete_id !== profile.gabinete_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Build update payload (only fields that were provided)
  const update: Record<string, unknown> = {};
  if (body.nome !== undefined) update.nome = body.nome.trim();
  if (body.cargo !== undefined) update.cargo = body.cargo?.trim() || null;
  if (body.telefone !== undefined) {
    const telefone = body.telefone.replace(/\D/g, '');
    if (telefone.length < 10 || telefone.length > 15) {
      return NextResponse.json({ error: 'Telefone inválido' }, { status: 400 });
    }
    update.telefone = telefone;
  }
  if (body.event_types_allowed !== undefined) update.event_types_allowed = body.event_types_allowed;
  if (body.quiet_start !== undefined) update.quiet_start = body.quiet_start || null;
  if (body.quiet_end !== undefined) update.quiet_end = body.quiet_end || null;
  if (body.max_daily !== undefined) update.max_daily = body.max_daily;
  if (body.digest_enabled !== undefined) update.digest_enabled = body.digest_enabled;
  if (body.enabled !== undefined) update.enabled = body.enabled;

  const { data, error } = await db()
    .from('gabinete_whatsapp_recipients')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.message.includes('Limite de 5 recipients')) {
      return NextResponse.json(
        { error: 'Limite de 5 recipients ativos atingido.' },
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

// ── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { id } = await ctx.params;
  const profile = await getProfile(auth.user.id);
  if (!profile?.gabinete_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (profile.role !== 'admin' && profile.role !== 'vereador') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Verify recipient belongs to user's gabinete
  const { data: existing } = await db()
    .from('gabinete_whatsapp_recipients')
    .select('id, gabinete_id')
    .eq('id', id)
    .maybeSingle();

  if (!existing || existing.gabinete_id !== profile.gabinete_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error } = await db()
    .from('gabinete_whatsapp_recipients')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
