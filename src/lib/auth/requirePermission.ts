/**
 * Middleware de autorização granular para API routes.
 *
 * Combina `requireAuth` (validação de sessão Supabase) com checagem da
 * permissão específica solicitada. Carrega o profile (role + permissions)
 * via service_role para ignorar RLS — assim o middleware funciona em
 * qualquer rota independente das policies da tabela `profiles`.
 *
 * Regras de autorização (na ordem):
 *   1. Sem sessão válida          → 401
 *   2. Profile não encontrado     → 403
 *   3. `hasFullAccess(role)`      → libera (superadmin/admin/vereador/assessor)
 *   4. `hasPermission(perms, x)`  → libera apenas se a flag estiver `true`
 *   5. caso contrário             → 403
 *
 * Uso:
 *   export const POST = requirePermission(
 *     'alia.agent.edit_prompt',
 *     async (req, { auth }) => {
 *       // auth.user, auth.role, auth.permissions disponíveis
 *       return NextResponse.json({ ok: true });
 *     },
 *   );
 *
 * NOTA F0: hasFullAccess() bypassa as permissões granulares alia.* para todos
 * os papéis exceto 'visitante'. A matriz fina (admin pode editar prompt vs
 * assessor não, etc.) será aplicada em fase futura quando a UI de gestão de
 * permissões for construída. Para F0, este middleware bloqueia apenas
 * visitantes e usuários sem o módulo 'alia' habilitado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';
import {
  hasFullAccess,
  hasPermission,
  type Permissions,
  type PermissionKey,
} from '@/lib/permissions';

export interface AuthContext {
  user: { id: string; email?: string };
  role: string;
  permissions: Partial<Permissions>;
}

type Handler<TParams = unknown> = (
  req: NextRequest,
  ctx: { auth: AuthContext; params?: TParams },
) => Promise<Response> | Response;

/**
 * Cliente Supabase com service_role — usado para ler profiles ignorando RLS.
 * O service role NUNCA é exposto ao cliente; só roda em API routes server-side.
 */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export function requirePermission<TParams = unknown>(
  permission: PermissionKey | string,
  handler: Handler<TParams>,
) {
  return async (req: NextRequest, ctx: { params?: TParams } = {}) => {
    // 1. Autenticação
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;

    // 2. Carrega profile (role + permissions JSONB)
    const db = adminClient();
    const { data: profile, error: profileErr } = await db
      .from('profiles')
      .select('role, permissions')
      .eq('id', auth.user.id)
      .maybeSingle();

    if (profileErr || !profile) {
      return NextResponse.json(
        {
          error: 'profile_not_found',
          message: 'Perfil de usuário não encontrado. Contate o administrador.',
        },
        { status: 403 },
      );
    }

    const role: string = profile.role ?? 'visitante';
    const permissions: Partial<Permissions> = (profile.permissions as Partial<Permissions>) ?? {};

    // 3. Roles com acesso total ignoram a checagem granular
    const allowed =
      hasFullAccess(role) || hasPermission(permissions, permission);

    if (!allowed) {
      console.warn('[requirePermission] permission_denied', {
        user_id: auth.user.id,
        role: role ?? null,
        permission,
        path: req.nextUrl.pathname,
      });
      return NextResponse.json(
        {
          error: 'permission_denied',
          message: 'Você não tem permissão para realizar esta ação.',
        },
        { status: 403 },
      );
    }

    // 4. Handler recebe contexto enriquecido
    return handler(req, {
      auth: { user: auth.user, role, permissions },
      params: ctx.params,
    });
  };
}
