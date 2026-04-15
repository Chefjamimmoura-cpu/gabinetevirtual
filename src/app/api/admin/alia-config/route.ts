import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Defaults retornados quando não há config cadastrada */
const CONFIG_DEFAULTS = {
  auto_parecer_on_ordem_dia: false,
  notify_ordem_dia: true,
  notify_materia_comissao: true,
  parecer_model: 'gemini-2.0-flash',
};

// GET /api/admin/alia-config
// Retorna a configuração ALIA do gabinete autenticado.
// Se não existir registro, retorna os valores padrão.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const db = supabase();
    const { data, error } = await db
      .from('gabinete_alia_config')
      .select('auto_parecer_on_ordem_dia, notify_ordem_dia, notify_materia_comissao, parecer_model')
      .eq('gabinete_id', GABINETE_ID)
      .maybeSingle();

    if (error) {
      console.warn('[GET /api/admin/alia-config] erro no DB, retornando padrão:', error.message);
      return NextResponse.json(CONFIG_DEFAULTS);
    }

    if (!data) {
      return NextResponse.json(CONFIG_DEFAULTS);
    }

    return NextResponse.json({
      auto_parecer_on_ordem_dia: data.auto_parecer_on_ordem_dia ?? CONFIG_DEFAULTS.auto_parecer_on_ordem_dia,
      notify_ordem_dia:          data.notify_ordem_dia          ?? CONFIG_DEFAULTS.notify_ordem_dia,
      notify_materia_comissao:   data.notify_materia_comissao   ?? CONFIG_DEFAULTS.notify_materia_comissao,
      parecer_model:             (data.parecer_model as string | undefined) ?? CONFIG_DEFAULTS.parecer_model,
    });
  } catch (err) {
    console.error('[GET /api/admin/alia-config]', err);
    return NextResponse.json(CONFIG_DEFAULTS);
  }
}

// PATCH /api/admin/alia-config
// Atualiza a configuração ALIA do gabinete. Restrito a superadmin.
// Body aceito: { auto_parecer_on_ordem_dia?, notify_ordem_dia?, notify_materia_comissao?, parecer_model? }
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  // Verificar se o usuário é superadmin
  const db = supabase();
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 403 });
  }

  if (profile.role !== 'superadmin') {
    return NextResponse.json(
      { error: 'Acesso negado. Apenas superadmin pode alterar as configurações da ALIA.' },
      { status: 403 },
    );
  }

  let body: {
    auto_parecer_on_ordem_dia?: boolean;
    notify_ordem_dia?: boolean;
    notify_materia_comissao?: boolean;
    parecer_model?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  // Somente os campos permitidos
  const updates: Record<string, unknown> = {};

  if ('auto_parecer_on_ordem_dia' in body && typeof body.auto_parecer_on_ordem_dia === 'boolean') {
    updates.auto_parecer_on_ordem_dia = body.auto_parecer_on_ordem_dia;
  }
  if ('notify_ordem_dia' in body && typeof body.notify_ordem_dia === 'boolean') {
    updates.notify_ordem_dia = body.notify_ordem_dia;
  }
  if ('notify_materia_comissao' in body && typeof body.notify_materia_comissao === 'boolean') {
    updates.notify_materia_comissao = body.notify_materia_comissao;
  }
  if ('parecer_model' in body && typeof body.parecer_model === 'string' && body.parecer_model.trim()) {
    updates.parecer_model = body.parecer_model.trim();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo válido para atualizar' }, { status: 400 });
  }

  try {
    const { error } = await db
      .from('gabinete_alia_config')
      .upsert(
        {
          gabinete_id: GABINETE_ID,
          ...updates,
          updated_at: new Date().toISOString(),
          updated_by: auth.user.id,
        },
        { onConflict: 'gabinete_id' },
      );

    if (error) throw error;

    // Busca a config atualizada para retornar estado completo
    const { data: updatedData } = await db
      .from('gabinete_alia_config')
      .select('auto_parecer_on_ordem_dia, notify_ordem_dia, notify_materia_comissao, parecer_model')
      .eq('gabinete_id', GABINETE_ID)
      .single();

    return NextResponse.json(updatedData ?? { ...CONFIG_DEFAULTS, ...updates });
  } catch (err) {
    console.error('[PATCH /api/admin/alia-config]', err);
    return NextResponse.json({ error: 'Falha ao salvar configuração ALIA' }, { status: 500 });
  }
}
