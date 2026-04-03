/**
 * Guard de autenticação para API routes.
 *
 * Uso:
 *   const auth = await requireAuth(req);
 *   if (auth.error) return auth.error;
 *   // auth.user disponível
 */

import { NextRequest, NextResponse } from 'next/server';
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
 * Aceita token via cookie (browser) ou header Authorization: Bearer (API).
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  // Tenta extrair token do header Authorization ou do cookie de sessão
  const authHeader = req.headers.get('authorization');
  const accessToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies.get('sb-drrzyitmlgeozxwubsyl-auth-token')?.value;

  if (!accessToken) {
    // Fallback: tenta via createClient com cookies (SSR pattern)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: authHeader ?? '' },
        },
      },
    );

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        user: null,
        error: NextResponse.json(
          { error: 'Não autenticado' },
          { status: 401 },
        ),
      };
    }

    return { user: { id: user.id, email: user.email }, error: null };
  }

  // Valida o token diretamente
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    },
  );

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      error: NextResponse.json(
        { error: 'Não autenticado' },
        { status: 401 },
      ),
    };
  }

  return { user: { id: user.id, email: user.email }, error: null };
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
