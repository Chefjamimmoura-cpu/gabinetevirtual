import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Cliente Supabase com SERVICE_ROLE_KEY — bypassa RLS.
 * Use APENAS em código server-side (route handlers, server actions, lib).
 * Nunca exporte/use isso em código client-side: a chave é privilegiada.
 *
 * Singleton: reusa a mesma conexão entre invocações pra reduzir overhead.
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL não configurada');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
