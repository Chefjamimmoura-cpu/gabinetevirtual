// POST /api/sessoes/youtube/auth  — Inicia OAuth device code do yt-dlp
// GET  /api/sessoes/youtube/auth  — Verifica se token OAuth existe

import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const YT_DLP_CACHE = path.join(os.homedir(), '.cache', 'yt-dlp');
const TOKEN_GLOB = 'youtube-oauth2-token.json';

function findToken(): string | null {
  try {
    // yt-dlp salva token em ~/.cache/yt-dlp/ com variações de nome
    const files = fs.readdirSync(YT_DLP_CACHE);
    const tokenFile = files.find(f => f.includes('oauth2') || f.includes('token'));
    if (tokenFile) {
      const fullPath = path.join(YT_DLP_CACHE, tokenFile);
      const stat = fs.statSync(fullPath);
      if (stat.size > 10) return fullPath;
    }
  } catch { /* dir não existe ainda */ }
  return null;
}

// ── GET: Verificar status da autenticação ────────────────────────────────────

export async function GET() {
  const tokenPath = findToken();
  if (tokenPath) {
    const stat = fs.statSync(tokenPath);
    return NextResponse.json({
      authenticated: true,
      updated_at: stat.mtime.toISOString(),
    });
  }
  return NextResponse.json({ authenticated: false, updated_at: null });
}

// ── POST: Iniciar fluxo device code ──────────────────────────────────────────

let activeProcess: ReturnType<typeof spawn> | null = null;

export async function POST() {
  // Se já há um processo ativo, matar antes de iniciar novo
  if (activeProcess) {
    try { activeProcess.kill(); } catch { /* ok */ }
    activeProcess = null;
  }

  return new Promise<NextResponse>((resolve) => {
    let output = '';
    let resolved = false;

    // Verificar se yt-dlp existe antes de tentar executar
    const ytDlpBin = 'yt-dlp';

    // yt-dlp com OAuth2: faz dry-run (-s) para apenas autenticar
    const proc = spawn(ytDlpBin, [
      '--username', 'oauth2',
      '--password', '',
      '-s',  // simulate / dry-run — não baixa nada
      '--verbose',
      'https://www.youtube.com/watch?v=jNQXAC9IVRw', // vídeo curto de teste
    ], {
      timeout: 180_000, // 3 min para o usuário completar
      env: { ...process.env, HOME: os.homedir() },
    });

    activeProcess = proc;

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      console.log('[yt-dlp oauth]', text.trim());

      // yt-dlp imprime algo como:
      // "Go to https://www.google.com/device, enter code XXX-XXX-XXX"
      // ou "To give yt-dlp access to your account, go to URL and enter code CODE"
      // ou "Enter the code XXXX-XXXX at https://www.google.com/device"
      // Formatos de código: ABC-DEF, ABCD-EFGH, ABC-DEF-GHI
      const codeMatch = output.match(
        /(?:enter\s+(?:the\s+)?code|code)[:\s]+([A-Z0-9]{3,5}(?:[- ][A-Z0-9]{3,5}){1,3})/i
      ) || output.match(
        /([A-Z0-9]{3,5}-[A-Z0-9]{3,5}(?:-[A-Z0-9]{3,5})?)\s/
      );
      const urlMatch = output.match(
        /(https?:\/\/\S*(?:google\.com\/device|youtube\.com\/activate)\S*)/i
      );

      if (codeMatch && !resolved) {
        resolved = true;
        resolve(NextResponse.json({
          ok: true,
          status: 'awaiting_user',
          user_code: codeMatch[1].trim(),
          verification_url: urlMatch ? urlMatch[1] : 'https://www.google.com/device',
          message: 'Acesse o link e digite o codigo para conectar sua conta YouTube.',
        }));
      }
    };

    proc.stdout.on('data', handleOutput);
    proc.stderr.on('data', handleOutput);

    proc.on('close', (code) => {
      activeProcess = null;

      if (!resolved) {
        // Processo encerrou sem mostrar device code
        const tokenPath = findToken();
        if (tokenPath) {
          // Token já existia — autenticação desnecessária
          resolved = true;
          resolve(NextResponse.json({
            ok: true,
            status: 'already_authenticated',
            message: 'YouTube ja esta conectado.',
          }));
        } else {
          resolved = true;
          console.error('[yt-dlp oauth] Processo encerrou sem device code. Exit code:', code);
          console.error('[yt-dlp oauth] Output completo:', output);
          resolve(NextResponse.json({
            ok: false,
            status: 'error',
            message: 'Nao foi possivel iniciar autenticacao. Verifique se yt-dlp esta atualizado.',
            debug: output.slice(-1000),
            exit_code: code,
          }, { status: 500 }));
        }
      }
    });

    proc.on('error', (err) => {
      activeProcess = null;
      if (!resolved) {
        resolved = true;
        resolve(NextResponse.json({
          ok: false,
          status: 'error',
          message: `Erro ao executar yt-dlp: ${err.message}`,
        }, { status: 500 }));
      }
    });

    // Timeout de segurança: se em 30s não capturou o code, retorna erro
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const tokenPath = findToken();
        if (tokenPath) {
          resolve(NextResponse.json({
            ok: true,
            status: 'already_authenticated',
            message: 'YouTube ja esta conectado.',
          }));
        } else {
          resolve(NextResponse.json({
            ok: false,
            status: 'timeout',
            message: 'Timeout aguardando codigo do device. Tente novamente.',
            debug: output.slice(-500),
          }, { status: 504 }));
        }
      }
    }, 30_000);
  });
}
