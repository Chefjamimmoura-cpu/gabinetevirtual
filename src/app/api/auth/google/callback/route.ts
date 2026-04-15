// GET /api/auth/google/callback
// Recebe ?code=... do Google após o usuário autorizar o acesso.
// Troca o código por access_token + refresh_token e salva em google_calendar_tokens.
// Redireciona para /agenda?sync=ok em caso de sucesso.

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const error = searchParams.get('error');

  const appBase = process.env.GOOGLE_REDIRECT_URI?.replace('/api/auth/google/callback', '') || '';

  if (error) {
    console.error('[OAuth2 callback] Usuário negou acesso:', error);
    return NextResponse.redirect(`${appBase}/agenda?sync=denied`);
  }

  if (!code) {
    return NextResponse.redirect(`${appBase}/agenda?sync=error&msg=no_code`);
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(`${appBase}/agenda?sync=error&msg=no_credentials`);
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // Pode acontecer se o usuário já autorizou antes e não houve re-consent.
      // O prompt: 'consent' no /api/auth/google previne isso, mas por segurança:
      console.warn('[OAuth2 callback] Refresh token não recebido. Usuário pode precisar reconectar.');
      return NextResponse.redirect(`${appBase}/agenda?sync=error&msg=no_refresh_token`);
    }

    // Obtém o e-mail da conta autorizada
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const email = userInfo.email;

    if (!email) {
      return NextResponse.redirect(`${appBase}/agenda?sync=error&msg=no_email`);
    }

    // Upsert em google_calendar_tokens (1 registro por gabinete + email)
    const db = supabase();
    const { error: dbError } = await db
      .from('google_calendar_tokens')
      .upsert(
        {
          gabinete_id:   GABINETE_ID,
          email,
          access_token:  tokens.access_token  ?? null,
          refresh_token: tokens.refresh_token,
          expires_at:    tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          calendar_id:  'primary',
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'gabinete_id,email' },
      );

    if (dbError) {
      console.error('[OAuth2 callback] Erro ao salvar token:', dbError);
      return NextResponse.redirect(`${appBase}/agenda?sync=error&msg=db_error`);
    }

    console.log(`[OAuth2 callback] Conta Google vinculada com sucesso: ${email}`);
    return NextResponse.redirect(`${appBase}/agenda?sync=ok&email=${encodeURIComponent(email)}`);
  } catch (err) {
    console.error('[OAuth2 callback] Erro inesperado:', err);
    return NextResponse.redirect(`${appBase}/agenda?sync=error&msg=exception`);
  }
}
