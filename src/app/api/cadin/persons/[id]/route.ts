import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * PATCH /api/cadin/persons/[id]
 * Atualiza pessoa + appointment ativo + org sphere/type.
 *
 * Body: {
 *   full_name?, phone?, email?, party?, photo_url?,
 *   birthday?,     // MM-DD
 *   chefeGab?,
 *   cargo?,        // title no appointment
 *   org_sphere?,   // 'federal'|'estadual'|'municipal'
 *   org_type?,     // 'secretaria'|'autarquia'|...
 *   org_name?,     // renomear organização
 *   appointment_id? // para mover para outro appointment
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const body = await request.json();
    const {
      full_name, phone, email, party, photo_url,
      birthday, chefeGab, cargo,
      org_sphere, org_type, org_name, org_address, appointment_id,
    } = body;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Atualiza person ────────────────────────────────────────────────────
    const personUpdate: Record<string, unknown> = {};
    if (full_name  !== undefined) personUpdate.full_name  = full_name;
    if (phone      !== undefined) personUpdate.phone      = phone      || null;
    if (email      !== undefined) personUpdate.email      = email      || null;
    if (party      !== undefined) personUpdate.party      = party      || null;
    if (photo_url  !== undefined) personUpdate.photo_url  = photo_url  || null;

    // Novos campos próprios (migration 017)
    if (birthday   !== undefined) personUpdate.birthday          = birthday          || null;
    if (chefeGab   !== undefined) personUpdate.chefe_gabinete     = chefeGab          || null;
    const { nomeParlamentar } = body;
    if (nomeParlamentar !== undefined) personUpdate.nome_parlamentar = nomeParlamentar || null;

    // Mantém notes sincronizado para compatibilidade com código legado
    const { data: currentPerson } = await supabase
      .from('cadin_persons')
      .select('notes, birthday, chefe_gabinete, nome_parlamentar')
      .eq('id', id)
      .single();

    const existingNotes = currentPerson?.notes || '';
    const noteParts: string[] = [];

    const effectiveBirthday  = birthday  !== undefined ? birthday  : currentPerson?.birthday;
    const effectiveChefeGab  = chefeGab  !== undefined ? chefeGab  : currentPerson?.chefe_gabinete;
    const effectiveNomeParl  = nomeParlamentar !== undefined ? nomeParlamentar : currentPerson?.nome_parlamentar;
    // preserva outros dados em notes que não gerenciamos como colunas
    const outraInfo = existingNotes.replace(/Aniversário: [\d\-]+;?\s*/g, '')
                                   .replace(/Chefe de Gabinete: [^;]+;?\s*/g, '')
                                   .replace(/Nome parlamentar: [^;]+;?\s*/g, '')
                                   .trim();

    if (effectiveBirthday) noteParts.push(`Aniversário: ${effectiveBirthday}`);
    if (effectiveNomeParl) noteParts.push(`Nome parlamentar: ${effectiveNomeParl}`);
    if (effectiveChefeGab) noteParts.push(`Chefe de Gabinete: ${effectiveChefeGab}`);
    if (outraInfo)         noteParts.push(outraInfo);

    personUpdate.notes = noteParts.length > 0 ? noteParts.join('; ') : null;

    if (Object.keys(personUpdate).length > 0) {
      const { error } = await supabase
        .from('cadin_persons')
        .update(personUpdate)
        .eq('id', id);
      if (error) throw error;
    }

    // ── Atualiza appointment ativo ─────────────────────────────────────────
    if (cargo !== undefined || org_sphere !== undefined || org_type !== undefined || org_name !== undefined) {
      const apptFilter = appointment_id
        ? supabase.from('cadin_appointments').select('id, organization_id').eq('id', appointment_id)
        : supabase.from('cadin_appointments').select('id, organization_id').eq('person_id', id).eq('active', true).limit(1);

      const { data: appts } = await apptFilter;
      const appt = appts?.[0];

      if (appt) {
        // Atualiza title do cargo
        if (cargo !== undefined) {
          const { error } = await supabase
            .from('cadin_appointments')
            .update({ title: cargo })
            .eq('id', appt.id);
          if (error) throw error;
        }

        // Atualiza sphere e/ou type da organização vinculada
        const orgUpdate: Record<string, unknown> = {};
        if (org_sphere) orgUpdate.sphere = org_sphere;
        if (org_type) orgUpdate.type = org_type;
        if (org_name) orgUpdate.name = org_name;
        if (org_address !== undefined) orgUpdate.address = org_address;

        if (Object.keys(orgUpdate).length > 0 && appt.organization_id) {
          const { error } = await supabase
            .from('cadin_organizations')
            .update(orgUpdate)
            .eq('id', appt.organization_id);
          if (error) throw error;
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao atualizar pessoa CADIN:', error);
    return NextResponse.json({ error: 'Falha ao salvar alterações' }, { status: 500 });
  }
}

/**
 * DELETE /api/cadin/persons/[id]
 * Remove pessoa + appointments vinculados.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Remove appointments primeiro (FK)
    const { error: apptErr } = await supabase
      .from('cadin_appointments')
      .delete()
      .eq('person_id', id);
    if (apptErr) throw apptErr;

    // Remove pessoa
    const { error: personErr } = await supabase
      .from('cadin_persons')
      .delete()
      .eq('id', id);
    if (personErr) throw personErr;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover pessoa CADIN:', error);
    return NextResponse.json({ error: 'Falha ao remover registro' }, { status: 500 });
  }
}

/**
 * GET /api/cadin/persons/[id]
 * Retorna detalhes completos de uma pessoa.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('cadin_persons')
      .select(`
        id,
        full_name,
        phone,
        email,
        party,
        photo_url,
        notes,
        birthday,
        nome_parlamentar,
        chefe_gabinete,
        cadin_appointments (
          id,
          title,
          active,
          dou_url,
          start_date,
          cadin_organizations ( id, name, acronym, type, sphere, phone, email, address )
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao buscar pessoa CADIN:', error);
    return NextResponse.json({ error: 'Pessoa não encontrada' }, { status: 404 });
  }
}
