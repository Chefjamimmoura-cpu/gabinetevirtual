// POST /api/sapl/auth
// ──────────────────────────────────────────────────────────────
// Obtém o Token DRF do SAPL usando credenciais de usuário.
// Usar UMA VEZ para gerar o token e salvar em SAPL_API_TOKEN no .env.
//
// ⚠️ Esta rota só funciona em localhost (bloqueada em produção).
//    Nunca expor credenciais SAPL em produção.
//
// Body: { username: string, password: string }
// Response: { token, instrucao }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';

const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';

export async function POST(req: NextRequest) {
  // Bloqueia em produção — usar apenas em dev para obter o token
  const host = req.headers.get('host') || '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');

  if (!isLocal && process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Esta rota só está disponível em desenvolvimento local.' },
      { status: 403 },
    );
  }

  let body: { username: string; password: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json({ error: 'username e password obrigatórios' }, { status: 400 });
  }

  // Tenta obtenção via endpoint padrão DRF Token
  const endpoints = [
    '/api-token-auth/',
    '/api/auth/login/',
    '/auth/token/',
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${SAPL_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        const data = await res.json() as { token?: string };
        if (data.token) {
          return NextResponse.json({
            ok: true,
            token: data.token,
            instrucao: `Adicione ao .env da VPS: SAPL_API_TOKEN=${data.token}`,
            endpoint_usado: endpoint,
          });
        }
      }
    } catch {
      // tenta o próximo
    }
  }

  // Fallback: Session auth para obter CSRF + token via Django admin
  try {
    // Tenta login via sessão Django
    const loginPage = await fetch(`${SAPL_BASE}/accounts/login/`, { redirect: 'manual' });
    const cookies = loginPage.headers.get('set-cookie') || '';
    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch?.[1] || '';

    if (csrfToken) {
      const loginRes = await fetch(`${SAPL_BASE}/accounts/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookies,
          'X-CSRFToken': csrfToken,
          Referer: `${SAPL_BASE}/accounts/login/`,
        },
        body: new URLSearchParams({ username, password, csrfmiddlewaretoken: csrfToken }),
        redirect: 'manual',
      });

      if (loginRes.status === 302) {
        return NextResponse.json({
          ok: true,
          aviso: 'Login via sessão bem-sucedido, mas token DRF não obtido automaticamente.',
          instrucao: 'Peça ao TI da CMBV para gerar um Token DRF para o usuário da vereadora em: ' +
            `${SAPL_BASE}/admin/authtoken/token/`,
          alternativa: 'Ou acesse o Django Shell na VPS da CMBV: python manage.py drf_create_token <username>',
        });
      }
    }
  } catch {
    // ignora
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'Não foi possível obter token automaticamente.',
      instrucao: [
        `1. Solicitar ao TI da CMBV: acesse ${SAPL_BASE}/admin/authtoken/token/`,
        '2. Ou: python manage.py drf_create_token <username_da_carol> (no servidor da câmara)',
        '3. Salvar em /opt/gabinete-carol/.env: SAPL_API_TOKEN=<token>',
        '4. Também adicionar: SAPL_AUTOR_ID=127 e SAPL_USUARIO_ENVIO_ID=<id_do_usuario>',
      ],
    },
    { status: 422 },
  );
}
