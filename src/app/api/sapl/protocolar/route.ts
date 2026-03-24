// POST /api/sapl/protocolar
// ──────────────────────────────────────────────────────────────
// Auto-protocola uma Indicação ou Requerimento no SAPL da CMBV
// via API REST (Django REST Framework Token Auth).
//
// Pré-requisitos:
//   - SAPL_API_TOKEN: Token DRF do usuário da vereadora no SAPL
//     (obtido em: https://sapl.boavista.rr.leg.br/api-token-auth/ ou pelo TI da câmara)
//   - SAPL_AUTOR_ID: ID da Carol como Autor no SAPL (= 127)
//   - SAPL_USUARIO_ENVIO_ID: ID do usuário de envio no SAPL (pedir ao TI)
//
// Body:
//   descricao:   string  — texto da ementa/pedido
//   tipo_sigla:  'IND' | 'REQ' | 'PLL'  — tipo da proposição
//   pdf_base64?: string  — texto do documento em base64 (opcional: se não enviado, cria PDF simples)
//   observacao?: string  — observação interna
//
// Response: { ok, proposicao_id, numero_proposicao, sapl_url }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SAPL_BASE = 'https://sapl.boavista.rr.leg.br';

// Mapeamento de sigla → tipo_proposicao ID no SAPL da CMBV
// (confirmado via /api/materia/tipoproposicao/ — IND=4, REQ=5, PLL=2)
const TIPO_PROPOSICAO: Record<string, number> = {
  IND: 4,
  REQ: 5,
  PLL: 2,
  PDL: 3,
  PLC: 6,
};

export async function POST(req: NextRequest) {
  const token = process.env.SAPL_API_TOKEN;
  const autorId = parseInt(process.env.SAPL_AUTOR_ID || '127', 10);
  const usuarioEnvioId = parseInt(process.env.SAPL_USUARIO_ENVIO_ID || '0', 10);

  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: 'SAPL_API_TOKEN não configurado',
        instrucao: 'Solicitar Token DRF ao TI da CMBV ou gerar em /api-token-auth/ com credenciais da vereadora',
      },
      { status: 503 },
    );
  }

  let body: {
    descricao: string;
    tipo_sigla?: string;
    pdf_base64?: string;
    observacao?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 });
  }

  const { descricao, tipo_sigla = 'IND', pdf_base64, observacao = '' } = body;

  if (!descricao || descricao.trim().length < 10) {
    return NextResponse.json({ ok: false, error: 'descricao obrigatória (mínimo 10 caracteres)' }, { status: 400 });
  }

  const tipoId = TIPO_PROPOSICAO[tipo_sigla.toUpperCase()];
  if (!tipoId) {
    return NextResponse.json(
      { ok: false, error: `tipo_sigla inválido. Use: ${Object.keys(TIPO_PROPOSICAO).join(', ')}` },
      { status: 400 },
    );
  }

  // Monta o FormData para o SAPL (multipart/form-data quando tem PDF)
  let saplResponse: Response;

  try {
    if (pdf_base64) {
      // Submissão com PDF
      const pdfBuffer = Buffer.from(pdf_base64, 'base64');
      const formData = new FormData();
      formData.append('autor', String(autorId));
      formData.append('tipo', String(tipoId));
      formData.append('descricao', descricao.toUpperCase());
      formData.append('observacao', observacao);
      if (usuarioEnvioId) formData.append('usuario_envio', String(usuarioEnvioId));

      const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
      const nomePdf = `${tipo_sigla.toLowerCase()}_${Date.now()}.pdf`;
      formData.append('texto_original', pdfBlob, nomePdf);

      saplResponse = await fetch(`${SAPL_BASE}/api/materia/proposicao/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}` },
        body: formData,
      });
    } else {
      // Submissão sem PDF (texto puro — SAPL aceita proposições sem arquivo em alguns casos)
      saplResponse = await fetch(`${SAPL_BASE}/api/materia/proposicao/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          autor: autorId,
          tipo: tipoId,
          descricao: descricao.toUpperCase(),
          observacao,
          ...(usuarioEnvioId ? { usuario_envio: usuarioEnvioId } : {}),
        }),
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro de rede ao contactar SAPL';
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const responseText = await saplResponse.text();
  let responseJson: Record<string, unknown> = {};
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    // resposta não é JSON
  }

  if (!saplResponse.ok) {
    console.error('[SAPL protocolar] Erro SAPL:', saplResponse.status, responseText);
    return NextResponse.json(
      {
        ok: false,
        error: `SAPL retornou ${saplResponse.status}`,
        detalhe: responseJson,
      },
      { status: saplResponse.status === 401 ? 401 : 502 },
    );
  }

  const proposicaoId = responseJson.id as number;
  const numeroProposicao = responseJson.numero_proposicao as number;
  const saplUrl = `${SAPL_BASE}/proposicao/${proposicaoId}`;

  // Salva log no Supabase
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const gabineteId = process.env.GABINETE_ID;

      await supabase.from('cadin_rag_logs').insert({
        gabinete_id: gabineteId || null,
        source_url: saplUrl,
        source_type: 'sapl_protocolo',
        status: 'completed',
        metadata: {
          proposicao_id: proposicaoId,
          numero_proposicao: numeroProposicao,
          tipo_sigla,
          descricao: descricao.substring(0, 200),
        },
      });
    }
  } catch (logErr) {
    console.error('[SAPL protocolar] log error:', logErr);
  }

  return NextResponse.json({
    ok: true,
    proposicao_id: proposicaoId,
    numero_proposicao: numeroProposicao,
    tipo_sigla,
    sapl_url: saplUrl,
    mensagem: `${tipo_sigla} protocolada com sucesso no SAPL. Número: ${numeroProposicao}`,
  });
}
