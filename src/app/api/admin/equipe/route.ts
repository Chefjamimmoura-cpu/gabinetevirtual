import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user: callingUser }, error: authErr } = await supabase.auth.getUser();

    if (authErr || !callingUser) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', callingUser.id)
      .single();

    if (!callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'vereador')) {
      return NextResponse.json({ error: 'Permissão negada. Apenas Admin pode criar contas.' }, { status: 403 });
    }

    const body = await req.json();
    const { email, password, full_name, role } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Cria o usuário na tabela Auth pulando verificação de email
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name }
    });

    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    // A trigger no DB já criou a row vazia em Profiles. Vamos injetar o nome, cargo e gabinete
    if (newUser.user) {
      await supabaseAdmin.from('profiles').update({
        full_name,
        role: role || 'assessor',
        gabinete_id: callerProfile.gabinete_id
      }).eq('id', newUser.user.id);
    }

    return NextResponse.json({ success: true, user: newUser.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
