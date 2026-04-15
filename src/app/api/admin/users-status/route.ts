import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

/**
 * GET /api/admin/users-status
 * Retorna last_sign_in_at de cada user (via admin API).
 * Apenas acessível por superadmin.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();

  if (!profile || profile.role !== 'superadmin') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }

  // Usa service role para acessar auth.users
  const supabaseAdmin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: authUsers, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Retorna mapa userId → last_sign_in_at
  const statusMap: Record<string, string | null> = {};
  for (const u of authUsers.users) {
    statusMap[u.id] = u.last_sign_in_at || null;
  }

  return NextResponse.json(statusMap);
}
