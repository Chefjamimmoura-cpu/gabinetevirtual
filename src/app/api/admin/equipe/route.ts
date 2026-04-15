import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { fullPermissions, emptyPermissions } from '@/lib/permissions';
import { requireAuth } from '@/lib/supabase/auth-guard';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;

    const supabase = await createServerClient();
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', auth.user.id)
      .single();

    if (!callerProfile || !['admin', 'vereador', 'superadmin'].includes(callerProfile.role)) {
      return NextResponse.json({ error: 'Permissão negada. Apenas Admin pode criar contas.' }, { status: 403 });
    }

    const body = await req.json();
    const { email, password, full_name, role } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const targetRole = role || 'assessor';

    // Cria o usuário na tabela Auth pulando verificação de email
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, _admin_created: true }
    });

    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    // A trigger no DB já criou a row. Atualizamos nome, cargo, gabinete, aprovação e permissões.
    if (newUser.user) {
      await supabaseAdmin.from('profiles').update({
        full_name,
        role: targetRole,
        gabinete_id: callerProfile.gabinete_id,
        approved: true,
        permissions: targetRole === 'visitante' ? emptyPermissions() : fullPermissions(),
      }).eq('id', newUser.user.id);
    }

    return NextResponse.json({ success: true, user: newUser.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
