// ══════════════════════════════════════════════════════════
// Reset de senha administrativo — destranca conta sem email
//
// Quando usar:
//   - Usuária perdeu a senha e o fluxo "Esqueci minha senha" não funciona
//     (ex: allowlist de Redirect URLs do Supabase sem localhost).
//   - Conta bloqueada e é preciso destravar sem depender de email.
//
// Estratégia:
//   1. Busca o UUID do usuário em public.profiles via PostgREST (pelo email)
//   2. Atualiza a senha direto no endpoint /auth/v1/admin/users/{id}
//
// Usa apenas fetch nativo do Node — sem SDK, sem listUsers (que falha em
// instalações com hooks custom em auth.users).
//
// Requer: SUPABASE_SERVICE_ROLE_KEY e NEXT_PUBLIC_SUPABASE_URL em .env.local
//
// Uso:
//   node scripts/reset-password.mjs <email> <nova-senha>
// ══════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Carrega .env.local sem depender de dotenv ──
const __filename = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(__filename), '..');
const envPath = resolve(projectRoot, '.env.local');

try {
  const envText = readFileSync(envPath, 'utf-8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) {
      const [, key, rawValue] = match;
      const value = rawValue.replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch (err) {
  console.error(`[ERRO] Não foi possível ler ${envPath}:`, err.message);
  process.exit(1);
}

// ── Parse argumentos ──
const [, , email, password] = process.argv;

if (!email || !password) {
  console.error('Uso: node scripts/reset-password.mjs <email> <nova-senha>');
  process.exit(1);
}
if (password.length < 6) {
  console.error('[ERRO] A senha deve ter pelo menos 6 caracteres.');
  process.exit(1);
}

// ── Valida env ──
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('[ERRO] Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.local');
  process.exit(1);
}

const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function main() {
  // ── 1. Busca UUID do usuário via public.profiles (pelo email) ──
  const profileUrl = `${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,email,full_name`;

  let profiles;
  try {
    const res = await fetch(profileUrl, { headers: adminHeaders });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[ERRO] GET /rest/v1/profiles retornou ${res.status}:`, body);
      return 1;
    }
    profiles = await res.json();
  } catch (err) {
    console.error('[ERRO] Falha na requisição GET /profiles:', err.message);
    return 1;
  }

  if (!Array.isArray(profiles) || profiles.length === 0) {
    console.error(`[ERRO] Nenhum profile encontrado com email "${email}".`);
    console.error('       Verifique se o email está correto (case-insensitive já considerado pelo PostgREST ilike se precisar).');
    return 1;
  }

  if (profiles.length > 1) {
    console.error(`[ERRO] Múltiplos profiles encontrados para "${email}":`);
    for (const p of profiles) console.error(`       - ${p.id} (${p.full_name || 'sem nome'})`);
    return 1;
  }

  const userId = profiles[0].id;
  const fullName = profiles[0].full_name || '(sem nome)';
  console.log(`[INFO] Usuário encontrado: ${fullName} — ${userId}`);

  // ── 2. Atualiza senha via endpoint admin do GoTrue ──
  const adminUrl = `${supabaseUrl}/auth/v1/admin/users/${userId}`;

  let updateRes;
  try {
    updateRes = await fetch(adminUrl, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ password }),
    });
  } catch (err) {
    console.error('[ERRO] Falha na requisição PUT /auth/v1/admin/users:', err.message);
    return 1;
  }

  if (!updateRes.ok) {
    const body = await updateRes.text();
    console.error(`[ERRO] PUT /auth/v1/admin/users/${userId} retornou ${updateRes.status}:`);
    console.error(body);
    return 1;
  }

  console.log(`[OK] Senha atualizada para ${email}`);
  console.log('     Pode fazer login agora com a nova senha.');
  return 0;
}

const code = await main();
process.exit(code);
