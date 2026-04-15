// POST /api/pls/aprovar
// Registra aprovação humana e gera DOCX oficial (RN-01, RN-02)
// Recebe: { pl_id, texto_aprovado, justificativa, emeta }
// Retorna: { ok, pl_id, docx_url, aprovado_em }

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Verifica sessão do usuário (RN-01: aprovação exige usuário autenticado)
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  let body: {
    pl_id?: string;
    texto_aprovado?: string;
    ementa?: string;
    justificativa?: string;
    status?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { pl_id, texto_aprovado, ementa, justificativa, status: reqStatus } = body;
  if (!pl_id) {
    return NextResponse.json({ error: 'Campo "pl_id" é obrigatório' }, { status: 400 });
  }

  // Modo rascunho: apenas confirma salvamento sem exigir texto
  if (reqStatus === 'RASCUNHO') {
    try {
      const { error: updateErr } = await supabase
        .from('pl_proposicoes')
        .update({ status: 'RASCUNHO', updated_at: new Date().toISOString() })
        .eq('id', pl_id);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, pl_id, mensagem: 'Rascunho salvo.' });
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
    }
  }

  if (!texto_aprovado) {
    return NextResponse.json({ error: 'Campo "texto_aprovado" é obrigatório (RN-02: aprovação exige texto)' }, { status: 400 });
  }

  try {
    // Busca o PL para validar que pertence ao gabinete do usuário (RLS garante)
    const { data: pl, error: fetchError } = await supabase
      .from('pl_proposicoes')
      .select('id, status, aprovado_por, ementa, tipo')
      .eq('id', pl_id)
      .single();

    if (fetchError || !pl) {
      return NextResponse.json({ error: 'PL não encontrado' }, { status: 404 });
    }

    if (pl.aprovado_por) {
      return NextResponse.json({
        error: 'PL já aprovado',
        aprovado_por: pl.aprovado_por,
      }, { status: 409 });
    }

    const agora = new Date().toISOString();

    // Registra aprovação humana (RN-01, RN-02)
    const { error: updateError } = await supabase
      .from('pl_proposicoes')
      .update({
        status: 'TRAMITANDO',
        aprovado_por: user.id,
        aprovado_em: agora,
        texto_aprovado,
        texto_pl: texto_aprovado,
        ementa: ementa || pl.ementa,
        justificativa: justificativa || undefined,
      })
      .eq('id', pl_id);

    if (updateError) {
      console.error('[pls/aprovar] Update error:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Cria entrada no histórico de tramitação
    await supabase.from('pl_historico_tramitacao').insert({
      pl_id,
      gabinete_id: (await supabase.from('profiles').select('gabinete_id').eq('id', user.id).single()).data?.gabinete_id,
      data_evento: new Date().toISOString().split('T')[0],
      status_novo: 'APROVADO_INTERNO',
      descricao: `PL aprovado para protocolamento pela assessora. Texto versão final registrado.`,
      fonte: 'interno',
    });

    // Gera DOCX — chama a lib docx existente no projeto
    let docxUrl: string | null = null;
    try {
      const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
      const docxRes = await fetch(`${baseUrl}/api/pls/gerar-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pl_id, texto_aprovado, ementa: ementa || pl.ementa }),
      });
      if (docxRes.ok) {
        const docxData = await docxRes.json();
        docxUrl = docxData.url ?? null;
      }
    } catch (docxErr) {
      console.warn('[pls/aprovar] DOCX generation failed (non-blocking):', docxErr);
    }

    return NextResponse.json({
      ok: true,
      pl_id,
      aprovado_em: agora,
      aprovado_por: user.id,
      docx_url: docxUrl,
      mensagem: 'PL aprovado com sucesso. Pronto para protocolamento.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[pls/aprovar] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
