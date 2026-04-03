// POST /api/cadin/persons — cria nova autoridade (pessoa + organização + nomeação)
// GET  /api/cadin/persons — busca rápida full-text (para autocomplete/search)

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

// ─── POST — criar autoridade ──────────────────────────────────────────────────

interface CreatePersonBody {
  // Dados da pessoa
  full_name: string;
  phone?: string;
  email?: string;
  party?: string;
  photo_url?: string;
  birthday?: string;       // MM-DD
  nome_parlamentar?: string;
  chefe_gabinete?: string;

  // Dados do cargo/nomeação
  cargo?: string;           // title do appointment
  org_id?: string;          // vincular a org existente
  org_name?: string;        // ou criar org nova
  org_acronym?: string;
  org_type?: string;        // 'secretaria'|'autarquia'|...
  org_sphere?: string;      // 'federal'|'estadual'|'municipal'
  org_phone?: string;
  org_email?: string;
  org_address?: string;
  dou_url?: string;         // link Diário Oficial da nomeação
  start_date?: string;      // data início do cargo
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const db = supabase();

  let body: CreatePersonBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 }); }

  if (!body.full_name?.trim()) {
    return NextResponse.json({ error: 'full_name é obrigatório' }, { status: 400 });
  }

  try {
    // 1. Monta campo notes para retrocompatibilidade
    const noteParts: string[] = [];
    if (body.birthday)          noteParts.push(`Aniversário: ${body.birthday}`);
    if (body.nome_parlamentar)  noteParts.push(`Nome parlamentar: ${body.nome_parlamentar}`);
    if (body.chefe_gabinete)    noteParts.push(`Chefe de Gabinete: ${body.chefe_gabinete}`);

    // 2. Cria pessoa
    const { data: person, error: personErr } = await db
      .from('cadin_persons')
      .insert({
        gabinete_id:      GABINETE_ID,
        full_name:        body.full_name.trim(),
        phone:            body.phone         || null,
        email:            body.email         || null,
        party:            body.party         || null,
        photo_url:        body.photo_url     || null,
        birthday:         body.birthday      || null,
        nome_parlamentar: body.nome_parlamentar || null,
        chefe_gabinete:   body.chefe_gabinete   || null,
        notes:            noteParts.length > 0 ? noteParts.join('; ') : null,
      })
      .select('id')
      .single();

    if (personErr) throw personErr;

    // 3. Cria ou localiza organização
    let orgId = body.org_id || null;

    if (!orgId && body.org_name) {
      const { data: newOrg, error: orgErr } = await db
        .from('cadin_organizations')
        .insert({
          gabinete_id: GABINETE_ID,
          name:        body.org_name.trim(),
          acronym:     body.org_acronym   || null,
          type:        body.org_type      || 'outros',
          sphere:      body.org_sphere    || 'municipal',
          phone:       body.org_phone     || null,
          email:       body.org_email     || null,
          address:     body.org_address   || null,
          active:      true,
        })
        .select('id')
        .single();

      if (orgErr) throw orgErr;
      orgId = newOrg.id;
    }

    // 4. Cria nomeação (appointment) se houver cargo ou org
    if (orgId || body.cargo) {
      const { error: apptErr } = await db
        .from('cadin_appointments')
        .insert({
          gabinete_id:     GABINETE_ID,
          person_id:       person.id,
          organization_id: orgId,
          title:           body.cargo     || null,
          start_date:      body.start_date || new Date().toISOString().split('T')[0],
          active:          true,
          dou_url:         body.dou_url   || null,
        });

      if (apptErr) throw apptErr;
    }

    return NextResponse.json({ id: person.id, success: true }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/cadin/persons]', error);
    return NextResponse.json({ error: 'Falha ao criar autoridade' }, { status: 500 });
  }
}

// ─── GET — busca full-text ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const db = supabase();
  const { searchParams } = new URL(req.url);

  const q       = searchParams.get('q')      ?? '';
  const sphere  = searchParams.get('sphere') ?? '';
  const tipo    = searchParams.get('tipo')   ?? '';
  const party   = searchParams.get('party')  ?? '';
  const limit   = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);
  const offset  = parseInt(searchParams.get('offset') ?? '0');

  try {
    let query = db
      .from('cadin_appointments')
      .select(`
        id,
        title,
        active,
        dou_url,
        start_date,
        cadin_persons!inner (
          id, full_name, phone, email, party, photo_url,
          birthday, nome_parlamentar, chefe_gabinete, notes
        ),
        cadin_organizations (
          id, name, acronym, type, sphere,
          phone, email, address
        )
      `, { count: 'exact' })
      .eq('cadin_persons.gabinete_id', GABINETE_ID)
      .eq('active', true)
      .range(offset, offset + limit - 1);

    if (sphere) query = query.eq('cadin_organizations.sphere', sphere);
    if (tipo)   query = query.eq('cadin_organizations.type', tipo);
    if (party)  query = query.eq('cadin_persons.party', party);

    if (q) {
      // Busca no nome, cargo, órgão e party
      query = query.or(
        `cadin_persons.full_name.ilike.%${q}%,` +
        `title.ilike.%${q}%,` +
        `cadin_organizations.name.ilike.%${q}%`
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const results = (data ?? []).map((a: Record<string, unknown>) => {
      const p   = a.cadin_persons   as Record<string, unknown>;
      const org = a.cadin_organizations as Record<string, unknown> | null;

      const birthdayRaw = (p?.birthday as string) || extractFromNotes(p?.notes as string, /Aniversário: (\d{2}-\d{2})/);
      const chefeGab    = (p?.chefe_gabinete as string) || extractFromNotes(p?.notes as string, /Chefe de Gabinete: ([^;]+)/);

      return {
        appointmentId: a.id,
        personId:      p?.id,
        orgId:         org?.id || null,
        titularNome:   p?.full_name,
        titularCargo:  a.title,
        phone:         p?.phone,
        email:         p?.email,
        party:         p?.party,
        photoUrl:      p?.photo_url,
        birthday:      birthdayRaw,
        chefeGab,
        nomeParlamentar: p?.nome_parlamentar,
        douUrl:        a.dou_url,
        startDate:     a.start_date,
        nomeOrgao:     org ? (org.acronym ? `${org.name} (${org.acronym})` : org.name) : null,
        orgAcronym:    org?.acronym,
        tipo:          org?.type   || 'outros',
        sphere:        org?.sphere || 'municipal',
        orgPhone:      org?.phone,
        orgEmail:      org?.email,
        orgAddress:    org?.address,
      };
    });

    return NextResponse.json({ total: count ?? 0, offset, limit, results });
  } catch (error) {
    console.error('[GET /api/cadin/persons]', error);
    return NextResponse.json({ error: 'Falha na busca' }, { status: 500 });
  }
}

function extractFromNotes(notes: string | null | undefined, pattern: RegExp): string | null {
  if (!notes) return null;
  const m = notes.match(pattern);
  return m ? m[1].trim() : null;
}
