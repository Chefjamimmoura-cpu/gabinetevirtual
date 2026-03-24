// PATCH /api/cadin/pending-updates/[id]
// Aprova ou rejeita uma sugestão de atualização do monitoramento de DOs.
//
// Body: { action: 'aprovar' | 'rejeitar', review_notes?: string }
//
// Se action === 'aprovar':
//   - Aplica as suggested_changes na cadin_persons / cadin_organizations
//   - Marca status como 'aplicado'
// Se action === 'rejeitar':
//   - Marca status como 'rejeitado'

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = supabase();
  const { id } = await params;

  let body: { action: 'aprovar' | 'rejeitar'; review_notes?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 }); }

  if (!['aprovar', 'rejeitar'].includes(body.action)) {
    return NextResponse.json({ error: 'action deve ser "aprovar" ou "rejeitar"' }, { status: 400 });
  }

  try {
    // Busca o registro
    const { data: update, error: fetchErr } = await db
      .from('cadin_pending_updates')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !update) {
      return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 });
    }

    if (update.status !== 'pendente') {
      return NextResponse.json({ error: 'Registro já foi revisado' }, { status: 409 });
    }

    if (body.action === 'rejeitar') {
      const { error } = await db
        .from('cadin_pending_updates')
        .update({ status: 'rejeitado', reviewed_at: new Date().toISOString(), review_notes: body.review_notes || null })
        .eq('id', id);
      if (error) throw error;

      return NextResponse.json({ success: true, status: 'rejeitado' });
    }

    // ── Aprovar: aplicar suggested_changes ────────────────────────────────
    const changes = update.suggested_changes as Record<string, string> | null;

    if (changes && update.person_id) {
      const personFields: Record<string, string> = {};
      const allowedPersonFields = ['full_name', 'phone', 'email', 'party', 'birthday', 'chefe_gabinete', 'nome_parlamentar'];
      for (const [k, v] of Object.entries(changes)) {
        if (allowedPersonFields.includes(k) && v) personFields[k] = v;
      }

      // Sincroniza notes se alterou birthday ou chefe_gabinete
      if (personFields.birthday || personFields.chefe_gabinete) {
        const { data: current } = await db
          .from('cadin_persons')
          .select('notes, birthday, chefe_gabinete, nome_parlamentar')
          .eq('id', update.person_id)
          .single();

        const bd  = personFields.birthday        ?? current?.birthday;
        const cg  = personFields.chefe_gabinete  ?? current?.chefe_gabinete;
        const npm = personFields.nome_parlamentar ?? current?.nome_parlamentar;
        const noteParts: string[] = [];
        if (bd)  noteParts.push(`Aniversário: ${bd}`);
        if (npm) noteParts.push(`Nome parlamentar: ${npm}`);
        if (cg)  noteParts.push(`Chefe de Gabinete: ${cg}`);
        personFields.notes = noteParts.join('; ');
      }

      if (Object.keys(personFields).length > 0) {
        const { error } = await db
          .from('cadin_persons')
          .update(personFields)
          .eq('id', update.person_id);
        if (error) throw error;
      }
    }

    if (changes && update.organization_id) {
      const orgFields: Record<string, string> = {};
      const allowedOrgFields = ['name', 'acronym', 'type', 'sphere', 'phone', 'email', 'address'];
      for (const [k, v] of Object.entries(changes)) {
        if (allowedOrgFields.includes(k) && v) orgFields[k] = v;
      }
      if (Object.keys(orgFields).length > 0) {
        const { error } = await db
          .from('cadin_organizations')
          .update(orgFields)
          .eq('id', update.organization_id);
        if (error) throw error;
      }
    }

    // Marca como aplicado
    const { error: finalErr } = await db
      .from('cadin_pending_updates')
      .update({ status: 'aplicado', reviewed_at: new Date().toISOString(), review_notes: body.review_notes || null })
      .eq('id', id);
    if (finalErr) throw finalErr;

    return NextResponse.json({ success: true, status: 'aplicado' });
  } catch (error) {
    console.error('[PATCH /api/cadin/pending-updates/[id]]', error);
    return NextResponse.json({ error: 'Falha ao processar ação' }, { status: 500 });
  }
}
