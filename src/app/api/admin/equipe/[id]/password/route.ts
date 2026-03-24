import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
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
      return NextResponse.json({ error: 'Permissão negada' }, { status: 403 });
    }

    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('gabinete_id')
      .eq('id', id)
      .single();
      
    if (!targetProfile || targetProfile.gabinete_id !== callerProfile.gabinete_id) {
        return NextResponse.json({ error: 'O usuário não está vinculado ao Gabinete' }, { status: 403 });
    }

    const body = await req.json();
    const { password } = body;

    if (!password || password.length < 6) {
        return NextResponse.json({ error: 'A senha deve possuir pelo menos 6 caracteres' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Substitui a senha (o usuário sofrerá logout se tentar usar a antiga)
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(id, {
        password: password
    });

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Senha atualizada' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
