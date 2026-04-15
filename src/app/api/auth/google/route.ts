// GET /api/auth/google
// Gera a URL de autorização OAuth2 do Google e redireciona o usuário.
//
// Scopes solicitados:
//   - https://www.googleapis.com/auth/calendar.events   (criar/editar eventos)
//   - https://www.googleapis.com/auth/calendar.readonly  (listar eventos)
//   - https://www.googleapis.com/auth/userinfo.email     (identificar a conta)
//
// Vars de ambiente necessárias (Jamim cria no GCP Console):
//   GOOGLE_CLIENT_ID       — Client ID do OAuth2 Web Application
//   GOOGLE_CLIENT_SECRET   — Client Secret
//   GOOGLE_REDIRECT_URI    — https://gabinete.wonetechnology.cloud/api/auth/google/callback

import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: 'Credenciais Google OAuth2 não configuradas. Adicione GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI no .env da VPS.' },
      { status: 503 },
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',   // solicita refresh_token
    prompt: 'consent',         // força re-exibição do consent para garantir refresh_token
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });

  return NextResponse.redirect(authUrl);
}
