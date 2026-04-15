// POST /api/agenda/gcal/push
// Empurra um evento do Gabinete Virtual → Google Calendar da conta vinculada.
// Salva o google_event_id de volta no evento para sincronização futura.
//
// Body: { evento_id: string }
// Response: { ok, google_event_id, google_link }

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: 'Credenciais Google OAuth2 não configuradas.' }, { status: 503 });
  }

  let body: { evento_id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 }); }

  if (!body.evento_id) {
    return NextResponse.json({ error: '"evento_id" é obrigatório' }, { status: 400 });
  }

  const db = supabase();

  // Busca o evento no Supabase
  const { data: evento, error: evtError } = await db
    .from('eventos')
    .select('id, titulo, descricao, data_inicio, data_fim, local, google_event_id')
    .eq('id', body.evento_id)
    .eq('gabinete_id', GABINETE_ID)
    .single();

  if (evtError || !evento) {
    return NextResponse.json({ error: 'Evento não encontrado' }, { status: 404 });
  }

  // Busca o primeiro token OAuth2 do gabinete
  const { data: tokenRow } = await db
    .from('google_calendar_tokens')
    .select('email, access_token, refresh_token, expires_at, calendar_id')
    .eq('gabinete_id', GABINETE_ID)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (!tokenRow) {
    return NextResponse.json({ error: 'Nenhuma conta Google vinculada.' }, { status: 400 });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({
      access_token:  tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
      expiry_date:   tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : undefined,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calId = tokenRow.calendar_id || 'primary';

    const gcalEvent = {
      summary:     evento.titulo,
      description: evento.descricao ?? undefined,
      location:    evento.local ?? undefined,
      start: { dateTime: evento.data_inicio, timeZone: 'America/Boa_Vista' },
      end:   { dateTime: evento.data_fim ?? evento.data_inicio, timeZone: 'America/Boa_Vista' },
    };

    let googleEventId: string;
    let htmlLink: string | undefined;

    if (evento.google_event_id) {
      // Evento já existe no GCal — atualiza
      const { data } = await calendar.events.update({
        calendarId: calId,
        eventId: evento.google_event_id,
        requestBody: gcalEvent,
      });
      googleEventId = data.id!;
      htmlLink = data.htmlLink ?? undefined;
    } else {
      // Cria novo evento no GCal
      const { data } = await calendar.events.insert({
        calendarId: calId,
        requestBody: gcalEvent,
      });
      googleEventId = data.id!;
      htmlLink = data.htmlLink ?? undefined;
    }

    // Salva google_event_id de volta no evento do GV
    await db.from('eventos').update({
      google_event_id:    googleEventId,
      google_calendar_id: calId,
      sync_source:        'gv',
    }).eq('id', evento.id);

    return NextResponse.json({ ok: true, google_event_id: googleEventId, google_link: htmlLink });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao chamar Google Calendar API';
    console.error('[gcal/push] Erro:', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
