import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;

    const { id } = await params;

    const supabase = await createServerClient();
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', auth.user.id)
      .single();

    if (!callerProfile || !['admin', 'vereador', 'superadmin'].includes(callerProfile.role)) {
      return NextResponse.json({ error: 'Permissão negada' }, { status: 403 });
    }

    // Impede autodeleção por essa rota
    if (id === auth.user.id) {
       return NextResponse.json({ error: 'Você não pode deletar a própria conta' }, { status: 400 });
    }

    // Proteção de SandBox: O usuário a ser deletado precisa obrigatoriamente
    // estar vinculado ao mesmo Gabinete do Admin (ou sem gabinete, se estiver solto).
    // Mas não deixamos deletar de outro gabinete.
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('gabinete_id')
      .eq('id', id)
      .single();
      
    if (!targetProfile || (targetProfile.gabinete_id && targetProfile.gabinete_id !== callerProfile.gabinete_id)) {
        return NextResponse.json({ error: 'Alvo inválido ou pertencente a outro gabinete' }, { status: 403 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Hard Delete: O Auth.Admin remove pra sempre. 
    // A chave FK ON DELETE CASCADE apagará o perfil se configurado.
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(id);

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
