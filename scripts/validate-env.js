#!/usr/bin/env node
/**
 * validate-env.js — Compara .env.local (ou .env) com .env.example
 * Reporta variáveis obrigatórias faltantes.
 *
 * Uso: npm run env:validate
 * Exit code 1 se alguma obrigatória faltar.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const examplePath = path.join(root, '.env.example');
const localPath = fs.existsSync(path.join(root, '.env.local'))
  ? path.join(root, '.env.local')
  : path.join(root, '.env');

if (!fs.existsSync(examplePath)) {
  console.log('⚠ .env.example não encontrado — pulando validação.');
  process.exit(0);
}

if (!fs.existsSync(localPath)) {
  console.error('✗ Nenhum .env.local ou .env encontrado!');
  process.exit(1);
}

function parseEnvKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const keys = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

// Variáveis opcionais (legacy, fallback, ou não críticas para dev)
const OPTIONAL = new Set([
  'FALA_CIDADAO_API_URL', 'FALA_CIDADAO_APP_KEY',
  'FALA_CIDADAO_LOGIN', 'FALA_CIDADAO_PASSWORD',
  'ALIA_NOTIFY_NUMBERS', 'STRIPE_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY', 'SAPL_API_TOKEN', 'SAPL_USUARIO_ENVIO_ID',
]);

const exampleKeys = parseEnvKeys(examplePath);
const localKeys = new Set(parseEnvKeys(localPath));

let missing = 0;
let optional = 0;

console.log(`\n🔍 Validando ${path.basename(localPath)} contra .env.example\n`);

for (const key of exampleKeys) {
  if (localKeys.has(key)) {
    // OK
  } else if (OPTIONAL.has(key)) {
    console.log(`  ⚪ ${key} — opcional, ausente`);
    optional++;
  } else {
    console.log(`  ✗ ${key} — OBRIGATÓRIA, faltando!`);
    missing++;
  }
}

const total = exampleKeys.length;
const present = total - missing - optional;

console.log(`\n📊 Resultado: ${present}/${total} presentes, ${optional} opcionais ausentes, ${missing} obrigatórias faltando\n`);

if (missing > 0) {
  console.error('❌ Existem variáveis obrigatórias faltando! Corrija o .env.local.\n');
  process.exit(1);
} else {
  console.log('✅ Todas as variáveis obrigatórias estão presentes.\n');
  process.exit(0);
}
