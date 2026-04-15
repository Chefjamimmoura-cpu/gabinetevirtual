/**
 * Guard de autenticação para API routes.
 *
 * Uso:
 *   const auth = await requireAuth(req);
 *   if (auth.error) return auth.error;
 *   // auth.user disponível
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

interface AuthSuccess {
  user: { id: string; email?: string };
  error: null;
}

interface AuthFailure {
  user: null;
  error: NextResponse;
}

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Verifica se a request possui um usuário autenticado via Supabase.
 *
 * Aceita duas formas de autenticação:
 *  1. Cookie de sessão do navegador (padrão @supabase/ssr — lida com cookies chunked)
 *  2. Header `Authorization: Bearer <token>` (uso programático / API externa)
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization');

  // 1. Se veio Bearer token explícito, valida direto
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return fail();
    return { user: { id: user.id, email: user.email }, error: null };
  }

  // 2. Caso contrário, usa @supabase/ssr que lê cookies chunked automaticamente.
  //    Este é o caminho usado pelo navegador (dashboard).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {
          // no-op: API routes não precisam refrescar cookies na response
        },
      },
    },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return fail();
  return { user: { id: user.id, email: user.email }, error: null };
}

function fail(): AuthFailure {
  return {
    user: null,
    error: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }),
  };
}

/**
 * Verifica autenticação via Bearer token de cron (CRON_SECRET).
 * Retorna true se autenticado como cron, false caso contrário.
 */
export function isCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // Fail closed — sem secret = sem acesso
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}
