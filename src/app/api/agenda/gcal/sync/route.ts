// POST /api/agenda/gcal/sync
// Sincroniza eventos do Google Calendar → Supabase (GCal → GV).
//
// Fluxo:
//   1. Busca todos os google_calendar_tokens do gabinete
//   2. Para cada token: refresh do access_token via googleapis
//   3. Lista eventos do GCal (janela: -30 dias até +90 dias)
//   4. Upsert em `eventos` pelo (gabinete_id, google_event_id)
//      - sync_source = 'gcal'
//      - NÃO sobrescreve eventos com sync_source = 'sapl'
// Response: { ok, criados, atualizados, erros }
//
// Auth: Bearer SYNC_SECRET (cron) OU chamada interna (botão manual)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Mapeia tipo de evento do Google Calendar para tipo interno do GV */
function mapEventType(summary: string): string {
  const s = (summary || '').toLowerCase();
  if (s.includes('sessão') || s.includes('sessao') || s.includes('plenária') || s.includes('plenaria')) return 'sessao_plenaria';
  if (s.includes('comissão') || s.includes('comissao') || s.includes('reunião') || s.includes('reuniao')) return 'reuniao_comissao';
  return 'agenda_externa';
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: 'Credenciais Google OAuth2 não configuradas.' }, { status: 503 });
  }

  const db = supabase();

  // Busca tokens OAuth2 do gabinete
  const { data: tokens, error: tokenError } = await db
    .from('google_calendar_tokens')
    .select('email, access_token, refresh_token, expires_at, calendar_id')
    .eq('gabinete_id', GABINETE_ID);

  if (tokenError || !tokens || tokens.length === 0) {
    return NextResponse.json({ error: 'Nenhuma conta Google vinculada. Conecte em /agenda → Configurações.' }, { status: 400 });
  }

  const stats = { criados: 0, atualizados: 0, erros: 0 };

  // Janela de sincronização: 30 dias atrás até 90 dias à frente
  const timeMin = new Date(); timeMin.setDate(timeMin.getDate() - 30);
  const timeMax = new Date(); timeMax.setDate(timeMax.getDate() + 90);

  for (const tokenRow of tokens) {
    try {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      oauth2Client.setCredentials({
        access_token:  tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expiry_date:   tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : undefined,
      });

      // Refresh automático se o token estiver expirado
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      // Persiste o novo access_token se foi renovado
      if (credentials.access_token && credentials.access_token !== tokenRow.access_token) {
        await db.from('google_calendar_tokens').update({
          access_token: credentials.access_token,
          expires_at:   credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
          updated_at:   new Date().toISOString(),
        }).eq('gabinete_id', GABINETE_ID).eq('email', tokenRow.email);
      }

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const calId = tokenRow.calendar_id || 'primary';

      // Busca eventos do Google Calendar (máx. 500 por conta)
      const { data } = await calendar.events.list({
        calendarId: calId,
        timeMin:    timeMin.toISOString(),
        timeMax:    timeMax.toISOString(),
        maxResults: 500,
        singleEvents: true,
        orderBy:    'startTime',
      });

      const gcalEvents = data.items ?? [];

      for (const evt of gcalEvents) {
        if (!evt.id || !evt.summary) continue;
        if (evt.status === 'cancelled') continue;

        const dataInicio = evt.start?.dateTime ?? (evt.start?.date ? `${evt.start.date}T00:00:00` : null);
        const dataFim    = evt.end?.dateTime   ?? (evt.end?.date   ? `${evt.end.date}T23:59:59`   : null);
        if (!dataInicio) continue;

        const upsertPayload = {
          gabinete_id:        GABINETE_ID,
          google_event_id:    evt.id,
          google_calendar_id: calId,
          sync_source:        'gcal',
          titulo:             evt.summary,
          descricao:          evt.description ?? null,
          data_inicio:        dataInicio,
          data_fim:           dataFim ?? null,
          local:              evt.location ?? null,
          tipo:               mapEventType(evt.summary),
          cor:                '#4285F4', // azul Google
        };

        // Verifica se já existe (para não sobrescrever eventos do SAPL)
        const { data: existing } = await db
          .from('eventos')
          .select('id, sync_source')
          .eq('gabinete_id', GABINETE_ID)
          .eq('google_event_id', evt.id)
          .maybeSingle();

        if (existing) {
          if (existing.sync_source === 'sapl') continue; // nunca sobrescreve eventos do SAPL
          await db.from('eventos').update(upsertPayload).eq('id', existing.id);
          stats.atualizados++;
        } else {
          await db.from('eventos').insert(upsertPayload);
          stats.criados++;
        }
      }
    } catch (err) {
      console.error(`[gcal/sync] Erro na conta ${tokenRow.email}:`, err);
      stats.erros++;
    }
  }

  return NextResponse.json({ ok: true, ...stats });
}
