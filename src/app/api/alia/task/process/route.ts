// POST /api/alia/task/process
// ──────────────────────────────────────────────────────────────
// Processa a próxima tarefa pendente na fila alia_task_queue.
// Autenticado com CRON_SECRET via Bearer token.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppMessage } from '@/lib/alia/adapters/whatsapp';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://gabinete.wonetechnology.cloud';

// ── Supabase ──────────────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Tipos internos ────────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  tipo: string;
  payload: Record<string, unknown>;
  gabinete_id: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── 1. Autenticação ────────────────────────────────────────────────────────
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 });
  }

  const supabase = db();

  // ── 2. Buscar próxima tarefa pendente ──────────────────────────────────────
  const { data: task, error: selectError } = await supabase
    .from('alia_task_queue')
    .select('id, tipo, payload, gabinete_id')
    .eq('status', 'pendente')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    console.error('[task/process] erro ao buscar tarefa:', selectError);
    return NextResponse.json({ ok: false, error: String(selectError.message) }, { status: 500 });
  }

  // ── 3. Nenhuma tarefa pendente ─────────────────────────────────────────────
  if (!task) {
    return NextResponse.json({ ok: true, message: 'Nenhuma tarefa pendente' });
  }

  const row = task as TaskRow;

  // ── 4. Marcar como processando ─────────────────────────────────────────────
  await supabase
    .from('alia_task_queue')
    .update({ status: 'processando', started_at: new Date().toISOString() })
    .eq('id', row.id);

  // ── 5. Executar a tarefa ───────────────────────────────────────────────────
  try {
    if (row.tipo === 'gerar_parecer_ordem_dia') {
      await processGerarParecer(supabase, row);
    } else {
      // Tipo desconhecido — marcar como erro
      await supabase
        .from('alia_task_queue')
        .update({
          status: 'erro',
          completed_at: new Date().toISOString(),
          erro: `Tipo de tarefa desconhecido: ${row.tipo}`,
        })
        .eq('id', row.id);

      return NextResponse.json({ ok: false, task_id: row.id, error: `Tipo desconhecido: ${row.tipo}` });
    }

    return NextResponse.json({ ok: true, task_id: row.id, tipo: row.tipo });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[task/process] erro ao processar tarefa:', msg);

    await supabase
      .from('alia_task_queue')
      .update({
        status: 'erro',
        completed_at: new Date().toISOString(),
        erro: msg,
      })
      .eq('id', row.id);

    // Notificar solicitante sobre o erro
    const solicitantePhone = row.payload.solicitante_phone as string | undefined;
    if (solicitantePhone) {
      const errMsg = `⚠️ *ALIA — Erro ao gerar pareceres*\n\nOcorreu um erro ao processar sua solicitação: ${msg}\n\nTente novamente ou acesse ${APP_URL}/pareceres\n\n_ALIA_`;
      await sendWhatsAppMessage(solicitantePhone, errMsg).catch(() => null);
    }

    return NextResponse.json({ ok: false, task_id: row.id, error: msg }, { status: 500 });
  }
}

// ── Processador: gerar_parecer_ordem_dia ──────────────────────────────────────

async function processGerarParecer(
  supabase: ReturnType<typeof db>,
  row: TaskRow,
): Promise<void> {
  const materiaIds: string[] = Array.isArray(row.payload.materia_ids)
    ? (row.payload.materia_ids as string[])
    : [];
  const modelo = (row.payload.modelo as string | undefined) ?? 'gemini-2.0-flash';
  const solicitantePhone = row.payload.solicitante_phone as string | undefined;
  const solicitanteNome  = (row.payload.solicitante_nome as string | undefined) ?? 'Assessora';
  const gabineteId = row.gabinete_id;

  // Chamar o endpoint interno de geração de pareceres
  const gerarRes = await fetch(`${INTERNAL_BASE}/api/pareceres/gerar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Header interno para autenticação service-to-service
      'x-internal-call': '1',
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      materia_ids: materiaIds,
      modelo,
      gabinete_id: gabineteId,
    }),
  });

  if (!gerarRes.ok) {
    const errBody = await gerarRes.text();
    throw new Error(`/api/pareceres/gerar respondeu ${gerarRes.status}: ${errBody}`);
  }

  const resultado = await gerarRes.json() as Record<string, unknown>;

  // Marcar como concluído
  await supabase
    .from('alia_task_queue')
    .update({
      status: 'concluido',
      completed_at: new Date().toISOString(),
      resultado,
    })
    .eq('id', row.id);

  // Notificar solicitante via WhatsApp
  if (solicitantePhone) {
    const total = materiaIds.length;
    const successMsg =
      `✅ *ALIA — Pareceres gerados com sucesso!*\n\n` +
      `Olá, ${solicitanteNome}! Os pareceres de *${total} matéria${total !== 1 ? 's' : ''}* da Ordem do Dia foram gerados.\n\n` +
      `📄 Acesse em: ${APP_URL}/pareceres\n\n_ALIA_`;
    await sendWhatsAppMessage(solicitantePhone, successMsg).catch(() => null);
  }
}
