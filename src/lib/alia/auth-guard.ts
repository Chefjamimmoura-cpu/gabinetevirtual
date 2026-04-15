// src/lib/alia/auth-guard.ts
// Valida se um remetente WhatsApp tem permissão para executar uma ação ALIA.

import { createClient } from '@supabase/supabase-js';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ActionPermission =
  | 'receber_notificacoes'
  | 'consultar_materias'
  | 'gerar_pareceres'
  | 'configurar_automacao';

export interface AuthResult {
  allowed: boolean;
  reason?: string;
  recipientName?: string;
}

// ── Mapa ação → permissão necessária ─────────────────────────────────────────

const INTENT_PERMISSIONS: Record<string, ActionPermission> = {
  gerar_parecer_ordem_dia: 'gerar_pareceres',
  gerar_parecer_comissao:  'gerar_pareceres',
  configurar_automacao:    'configurar_automacao',
};

// ── Supabase ──────────────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Verificação de permissão ──────────────────────────────────────────────────

/**
 * Verifica se o remetente tem permissão para executar a intenção solicitada.
 *
 * @param phone        - Número WhatsApp do remetente (pode ter @s.whatsapp.net)
 * @param gabineteId   - ID do gabinete em questão
 * @param intentAction - Ação da intenção detectada (ex: 'gerar_parecer_ordem_dia')
 * @returns AuthResult indicando se a ação é permitida
 */
export async function checkActionPermission(
  phone: string,
  gabineteId: string,
  intentAction: string,
): Promise<AuthResult> {
  // 1. Se a ação não está no mapa, não exige restrição
  const requiredPermission = INTENT_PERMISSIONS[intentAction];
  if (!requiredPermission) {
    return { allowed: true };
  }

  // 2. Limpar o número — remover @s.whatsapp.net e caracteres não numéricos
  const cleanPhone = phone
    .replace('@s.whatsapp.net', '')
    .replace(/\D/g, '');

  // Usar os últimos 11 dígitos para comparação (DDD + número)
  const last11 = cleanPhone.slice(-11);

  if (!last11) {
    return {
      allowed: false,
      reason: 'Número de telefone inválido. Não foi possível verificar sua permissão.',
    };
  }

  // 3. Buscar destinatário habilitado no banco
  const { data: recipient, error } = await db()
    .from('gabinete_whatsapp_recipients')
    .select('id, nome, telefone, action_permissions')
    .eq('gabinete_id', gabineteId)
    .eq('enabled', true)
    .ilike('telefone', `%${last11}`)
    .maybeSingle();

  if (error) {
    console.error('[auth-guard] erro ao consultar destinatários:', error);
  }

  // 4. Destinatário não encontrado
  if (!recipient) {
    return {
      allowed: false,
      reason: 'Seu número não está autorizado a executar ações avançadas neste gabinete. Entre em contato com a assessoria.',
    };
  }

  // 5. Verificar se a permissão específica está na lista
  const permissions: ActionPermission[] = Array.isArray(recipient.action_permissions)
    ? (recipient.action_permissions as ActionPermission[])
    : [];

  if (!permissions.includes(requiredPermission)) {
    return {
      allowed: false,
      reason: `Você não tem permissão para *${intentAction.replace(/_/g, ' ')}*. Solicite ao administrador do gabinete a permissão _${requiredPermission}_.`,
      recipientName: recipient.nome as string | undefined,
    };
  }

  return {
    allowed: true,
    recipientName: recipient.nome as string | undefined,
  };
}
