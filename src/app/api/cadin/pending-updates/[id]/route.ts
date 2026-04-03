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
import { requireAuth } from '@/lib/supabase/auth-guard';

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
  const authCheck = await requireAuth(req);
  if (authCheck.error) return authCheck.error;

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
    let targetPersonId = update.person_id;
    let targetOrgId = update.organization_id;
    const gabineteId = update.gabinete_id || process.env.GABINETE_ID!;

    if (changes) {
      // 1. Criar novo Person se não existir
      if (!targetPersonId && changes.full_name) {
        const { data: newPerson, error: pErr } = await db
          .from('cadin_persons')
          .insert({ gabinete_id: gabineteId, full_name: changes.full_name })
          .select('id')
          .single();
        if (pErr) throw pErr;
        targetPersonId = newPerson.id;
      }

      // 2. Atualizar Person existente/recém-criado (Campos ALIA ou DO)
      if (targetPersonId) {
        const personFields: Record<string, string> = {};
        const allowedPersonFields = ['full_name', 'phone', 'email', 'party', 'birthday', 'chefe_gabinete', 'nome_parlamentar'];
        for (const [k, v] of Object.entries(changes)) {
          if (allowedPersonFields.includes(k) && v) personFields[k] = v;
        }

        if (personFields.birthday || personFields.chefe_gabinete) {
          const { data: current } = await db
            .from('cadin_persons')
            .select('notes, birthday, chefe_gabinete, nome_parlamentar')
            .eq('id', targetPersonId)
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
            .eq('id', targetPersonId);
          if (error) throw error;
        }
      }

      // 3. Criar novo Organization se não existir
      if (!targetOrgId && changes.organization_name) {
        const { data: newOrg, error: oErr } = await db
          .from('cadin_organizations')
          .insert({ 
            gabinete_id: gabineteId, 
            name: changes.organization_name, 
            sphere: changes.sphere || 'estadual' 
          })
          .select('id')
          .single();
        if (oErr) throw oErr;
        targetOrgId = newOrg.id;
      }

      // 4. Atualizar Organization existente/recém-criado
      if (targetOrgId) {
        const orgFields: Record<string, string> = {};
        const allowedOrgFields = ['name', 'organization_name', 'acronym', 'type', 'sphere', 'phone', 'email', 'address'];
        for (const [k, v] of Object.entries(changes)) {
          if (allowedOrgFields.includes(k) && v) {
            orgFields[k === 'organization_name' ? 'name' : k] = v;
          }
        }
        if (Object.keys(orgFields).length > 0) {
          const { error } = await db
            .from('cadin_organizations')
            .update(orgFields)
            .eq('id', targetOrgId);
          if (error) throw error;
        }
      }

      // 5. Injetar Appointment se vier do Diário Oficial (Monitoramento D.O.)
      if (['nomeacao', 'exoneracao', 'designacao'].includes(update.update_type)) {
        if (targetPersonId && targetOrgId) {
          const { error: apptErr } = await db
            .from('cadin_appointments')
            .insert({
              gabinete_id: gabineteId,
              person_id: targetPersonId,
              organization_id: targetOrgId,
              title: changes.title || 'Cargo não especificado',
              active: changes.active === 'true',
              start_date: changes.start_date || null,
              do_source_url: update.source_url,
              do_raw_text: update.extracted_text,
              notes: `Auto-aprovado via Monitoramento D.O. (${update.source_date || ''})`,
            });
          if (apptErr) throw apptErr;
        }
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
