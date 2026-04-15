// POST /api/agenda/sync-emails
// Sincroniza emails de todas as contas configuradas via IMAP.
// Usa o pacote `imapflow` (adicionar: npm install imapflow).
// Para Gmail: requer App Password (myaccount.google.com/apppasswords)
// Para Hotmail/Outlook: senha normal ou App Password com 2FA ativo.
//
// Vars de ambiente necessárias (contas não configuradas são silenciosamente ignoradas):
//   EMAIL_OFICIAL_PASS   — caroldantasrr@gmail.com
//   EMAIL_AGENDA_PASS    — agendacaroldantas@gmail.com
//   EMAIL_COMISSAO_PASS  — comissaocasp1@gmail.com
//   EMAIL_CANAIS_PASS    — canalcaroldantas@gmail.com
//   EMAIL_PESSOAL_PASS   — carolinydantas@hotmail.com

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GABINETE_ID = process.env.GABINETE_ID!;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface ContaConfig {
  nome: 'oficial' | 'agenda' | 'pessoal' | 'canais' | 'comissao';
  email: string;
  host: string;
  port: number;
  password: string | undefined;
}

const CONTAS: ContaConfig[] = [
  { nome: 'oficial',   email: 'caroldantasrr@gmail.com',      host: 'imap.gmail.com',             port: 993, password: process.env.EMAIL_OFICIAL_PASS },
  { nome: 'agenda',    email: 'agendacaroldantas@gmail.com',  host: 'imap.gmail.com',             port: 993, password: process.env.EMAIL_AGENDA_PASS },
  { nome: 'comissao',  email: 'comissaocasp1@gmail.com',      host: 'imap.gmail.com',             port: 993, password: process.env.EMAIL_COMISSAO_PASS },
  { nome: 'canais',    email: 'canalcaroldantas@gmail.com',   host: 'imap.gmail.com',             port: 993, password: process.env.EMAIL_CANAIS_PASS },
  { nome: 'pessoal',   email: 'carolinydantas@hotmail.com',   host: 'outlook.office365.com',      port: 993, password: process.env.EMAIL_PESSOAL_PASS },
];

interface SyncResult {
  conta: string;
  sincronizados: number;
  erro?: string;
}

async function syncConta(conta: ContaConfig): Promise<SyncResult> {
  if (!conta.password) {
    return { conta: conta.nome, sincronizados: 0, erro: 'Senha não configurada (ignorado)' };
  }

  try {
    // Importação dinâmica do imapflow (evita erros de build se o pacote não estiver instalado)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImapFlow } = require('imapflow');

    const client = new ImapFlow({
      host: conta.host,
      port: conta.port,
      secure: true,
      auth: { user: conta.email, pass: conta.password },
      logger: false,
      // Security fix: validar certificado TLS (Gmail/Outlook têm certs válidos).
      // rejectUnauthorized:false permitia MITM capturar senhas IMAP.
      tls: { rejectUnauthorized: true },
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Buscar as últimas 50 mensagens
      const mailbox = client.mailbox;
      const total: number = mailbox?.exists ?? 0;
      if (total === 0) {
        await lock.release();
        await client.logout();
        return { conta: conta.nome, sincronizados: 0 };
      }

      const from = Math.max(1, total - 49);
      const messages: Array<{
        uid: number;
        envelope: { from?: Array<{ name?: string; address?: string }>; subject?: string; date?: Date };
        bodyStructure?: unknown;
      }> = [];

      for await (const msg of client.fetch(`${from}:${total}`, { uid: true, envelope: true })) {
        messages.push(msg as typeof messages[0]);
      }

      const db = supabase();
      let sincronizados = 0;

      for (const msg of messages) {
        const uid = String(msg.uid);
        const env = msg.envelope;
        const remetente = env.from?.[0]
          ? `${env.from[0].name ?? ''} <${env.from[0].address ?? ''}>`.trim().replace(/^<(.*)>$/, '$1')
          : 'Desconhecido';
        const assunto = env.subject ?? '(sem assunto)';
        const data_recebimento = env.date?.toISOString() ?? new Date().toISOString();
        const preview = assunto.substring(0, 200);

        const { error } = await db
          .from('agenda_emails')
          .upsert(
            {
              gabinete_id: GABINETE_ID,
              conta: conta.nome,
              uid,
              remetente,
              assunto,
              preview,
              data_recebimento,
              lido: false,
              raw_headers: { from: env.from, date: env.date },
            },
            { onConflict: 'gabinete_id,conta,uid', ignoreDuplicates: true },
          );

        if (!error) sincronizados++;
      }

      await lock.release();
      await client.logout();

      return { conta: conta.nome, sincronizados };
    } catch (innerErr) {
      await lock.release();
      await client.logout();
      throw innerErr;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sync-emails] ${conta.nome}:`, msg);
    return { conta: conta.nome, sincronizados: 0, erro: msg };
  }
}

export async function POST() {
  const resultados: SyncResult[] = [];

  // Processar contas em paralelo
  const promises = CONTAS.map(conta => syncConta(conta));
  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      resultados.push(result.value);
    } else {
      resultados.push({ conta: 'desconhecida', sincronizados: 0, erro: String(result.reason) });
    }
  }

  const totalSincronizados = resultados.reduce((acc, r) => acc + r.sincronizados, 0);
  const contasComErro = resultados.filter(r => r.erro && !r.erro.includes('ignorado'));

  return NextResponse.json({
    ok: true,
    total_sincronizados: totalSincronizados,
    contas_com_erro: contasComErro.length,
    detalhes: resultados,
  });
}
