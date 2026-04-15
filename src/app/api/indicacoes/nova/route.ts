// POST /api/indicacoes/nova
// ──────────────────────────────────────────────────────────────
// Cria uma nova indicação no sistema (sem Fala Cidadão).
// Usado pelo formulário de campo próprio, pelo dashboard,
// e pelos comandos WhatsApp (!nova via ALIA).
//
// Body:
//   titulo?:           string  — se vazio, gerado automaticamente
//   bairro:            string  — obrigatório
//   logradouro:        string  — obrigatório
//   setores:           string[] — ex: ['Asfalto','Limpeza']
//   classificacao?:    'necessidade' | 'prioridade' | 'urgencia'
//   responsavel_nome?: string
//   descricao?:        string
//   observacoes?:      string
//   fotos_urls?:       string[]
//   geo_lat?:          number
//   geo_lng?:          number
//
// Response: { ok, id, titulo, status }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/supabase/auth-guard';

const GABINETE_ID = process.env.GABINETE_ID!;

interface NovaIndicacaoBody {
  titulo?: string;
  bairro: string;
  logradouro: string;
  setores?: string[];
  classificacao?: 'necessidade' | 'prioridade' | 'urgencia';
  responsavel_nome?: string;
  descricao?: string;
  observacoes?: string;
  fotos_urls?: string[];
  geo_lat?: number;
  geo_lng?: number;
}

function gerarTitulo(body: NovaIndicacaoBody): string {
  const setoresStr = (body.setores ?? []).slice(0, 3).join(', ');
  const bairro = body.bairro ?? '';
  const logradouro = body.logradouro ?? '';
  if (setoresStr) return `${setoresStr} — ${logradouro}, ${bairro}`;
  return `Indicação — ${logradouro}, ${bairro}`;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let body: NovaIndicacaoBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  if (!body.bairro?.trim()) {
    return NextResponse.json({ error: 'bairro é obrigatório' }, { status: 400 });
  }
  if (!body.logradouro?.trim()) {
    return NextResponse.json({ error: 'logradouro é obrigatório' }, { status: 400 });
  }

  const titulo = body.titulo?.trim() || gerarTitulo(body);

  const { data, error } = await supabase
    .from('indicacoes')
    .insert({
      gabinete_id: GABINETE_ID,
      titulo,
      descricao: body.descricao ?? null,
      bairro: body.bairro.trim(),
      logradouro: body.logradouro.trim(),
      setores: body.setores ?? [],
      classificacao: body.classificacao ?? null,
      responsavel_nome: body.responsavel_nome ?? null,
      observacoes: body.observacoes ?? null,
      fotos_urls: body.fotos_urls ?? [],
      geo_lat: body.geo_lat ?? null,
      geo_lng: body.geo_lng ?? null,
      status: 'pendente',
      fonte: 'manual',
    })
    .select('id, titulo, status, bairro, logradouro, setores, classificacao')
    .single();

  if (error) {
    console.error('[nova indicação]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: data.id,
    titulo: data.titulo,
    status: data.status,
    bairro: data.bairro,
    logradouro: data.logradouro,
    setores: data.setores,
    classificacao: data.classificacao,
    mensagem: `Indicação criada: ${titulo}`,
  }, { status: 201 });
}
