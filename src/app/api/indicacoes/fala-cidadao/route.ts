// POST /api/indicacoes/fala-cidadao
// ──────────────────────────────────────────────────────────────
// Importação ÚNICA dos dados históricos do Fala Cidadão para
// o nosso Supabase. Após rodar, o Fala Cidadão não é mais
// necessário — nossa solução substitui completamente.
//
// Auth: Bearer SYNC_SECRET
// Body: { dry_run?: boolean }  — se true, apenas conta sem inserir
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAllSolicitacoes, type SolicitacaoFC } from '@/lib/fala-cidadao/client';

const GABINETE_ID = process.env.GABINETE_ID!;

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // TODO: Adicionar checagem de RLS/Session real baseada no usuário logado
    // Por enquanto filtra pelo GABINETE_ID do .env
    const { data, error } = await supabase
      .from('indicacoes')
      .select('id, titulo, logradouro, bairro, setores, classificacao, descricao, status, created_at, responsavel_nome')
      .eq('fonte', 'fala_cidadao')
      .eq('gabinete_id', GABINETE_ID)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Transformar para o formato que a UI de FalaCidadaoInbox espera
    const mapped = (data || []).map(d => ({
      id: d.id,
      autor: d.responsavel_nome || 'Cidadão',
      canal: 'fala_cidadao',
      assunto: d.titulo,
      corpo: d.descricao || 'Sem descrição detalhada',
      data: d.created_at,
      spamScore: 0,
      status: d.status === 'pendente' ? 'caixa_entrada' : (d.status === 'arquivada' ? 'rejeitado' : 'enviado_alia')
    }));

    return NextResponse.json(mapped);
  } catch (err) {
    console.error('[FC GET]', err);
    return NextResponse.json({ error: 'Erro ao listar Fala Cidadão' }, { status: 500 });
  }
}

// Mapeia status do Fala Cidadão para nosso status interno
function mapStatus(fcStatus: SolicitacaoFC['status']): string {
  const map: Record<string, string> = {
    PENDING: 'pendente',
    INVESTIGATING: 'em_andamento',
    ACCEPTED: 'atendida',
    REJECTED: 'arquivada',
  };
  return map[fcStatus] ?? 'pendente';
}

// Normaliza classificação
function mapClassificacao(raw: string | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes('urgên') || lower.includes('urgenc')) return 'urgencia';
  if (lower.includes('priorid')) return 'prioridade';
  if (lower.includes('necessid')) return 'necessidade';
  return lower;
}

export async function POST(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get('authorization') ?? '';
  const secret = process.env.SYNC_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  // Verificar vars necessárias
  const missingVars = ['FALA_CIDADAO_API_URL', 'FALA_CIDADAO_APP_KEY', 'FALA_CIDADAO_LOGIN', 'FALA_CIDADAO_PASSWORD']
    .filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    return NextResponse.json({
      error: 'Variáveis de ambiente não configuradas',
      missing: missingVars,
      instrucao: 'Adicionar ao .env: FALA_CIDADAO_API_URL, FALA_CIDADAO_APP_KEY, FALA_CIDADAO_LOGIN, FALA_CIDADAO_PASSWORD',
    }, { status: 503 });
  }

  let body: { dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* body vazio é ok */ }
  const isDryRun = body.dry_run === true;

  const started = Date.now();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    console.log('[FC Import] Buscando todas as solicitações do Fala Cidadão...');
    const solicitacoes = await getAllSolicitacoes();
    console.log(`[FC Import] ${solicitacoes.length} solicitações encontradas`);

    if (isDryRun) {
      return NextResponse.json({
        dry_run: true,
        total_fala_cidadao: solicitacoes.length,
        message: 'dry_run=true: nenhum dado foi inserido. Remova dry_run para importar.',
        amostra: solicitacoes.slice(0, 3).map(s => ({
          id: s.id,
          status: s.status,
          requester: s.requester_name,
          bairro: s._bairro,
          logradouro: s._logradouro,
          setores: s._setores,
          classificacao: s._classificacao,
        })),
      });
    }

    let created = 0;
    let updated = 0;
    let errors = 0;
    const errorList: string[] = [];

    // Processar em lotes de 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < solicitacoes.length; i += BATCH_SIZE) {
      const batch = solicitacoes.slice(i, i + BATCH_SIZE);

      const rows = batch.map(s => ({
        gabinete_id: GABINETE_ID,
        fala_cidadao_id: s.id,
        fala_cidadao_status: s.status,
        fala_cidadao_slug: s.slug,
        titulo: s._bairro
          ? `${(s._setores ?? []).slice(0, 2).join(', ')} — ${s._bairro}`
          : (s.service_name ?? 'Indicação importada'),
        descricao: s._observacoes ?? null,
        bairro: s._bairro ?? null,
        logradouro: s._logradouro ?? null,
        setores: s._setores ?? [],
        responsavel_nome: s._responsavel ?? null,
        classificacao: mapClassificacao(s._classificacao),
        status: mapStatus(s.status as SolicitacaoFC['status']),
        fonte: 'fala_cidadao',
        created_at: s.created_at,
      }));

      const { data, error } = await supabase
        .from('indicacoes')
        .insert(rows)
        .select('id, fala_cidadao_id');

      if (error) {
        console.error(`[FC Import] Erro no lote ${i / BATCH_SIZE + 1}:`, error);
        errors += batch.length;
        errorList.push(`Lote ${i}-${i + BATCH_SIZE}: ${error.message}`);
      } else {
        created += (data ?? []).length;
      }
    }

    const duration = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[FC Import] Concluído: ${created} criados, ${updated} atualizados, ${errors} erros em ${duration}s`);

    return NextResponse.json({
      ok: true,
      total_fala_cidadao: solicitacoes.length,
      created,
      updated,
      errors,
      error_details: errorList.length > 0 ? errorList : undefined,
      duration_s: parseFloat(duration),
      mensagem: `Importação concluída. ${solicitacoes.length} registros do Fala Cidadão importados para o Gabinete Virtual. O Fala Cidadão não é mais necessário.`,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[FC Import] Falha crítica:', err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
