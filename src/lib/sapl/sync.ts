// ══════════════════════════════════════════════════════════════
// SAPL SYNC — Mirroring Passivo (V3-F1)
// ──────────────────────────────────────────────────────────────
// Chamado pelo endpoint protegido POST /api/admin/sync-sapl.
// Espelha sessões e matérias do SAPL no Supabase para servir
// o frontend sem depender do servidor da câmara em tempo real.
//
// Usa as tabelas da migration 006 + extras da 007:
//   sapl_sessoes_cache  — sessões plenárias
//   sapl_materias_cache — matérias (enriquecimento leve)
//   sapl_sync_logs      — auditoria de cada execução
// ══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { inflateSync, inflateRawSync } from 'zlib';
import { extractMateriaIdsViaOcr } from './ocr';
import {
  SAPL_BASE,
  fetchRecentSessions,
  fetchMateria,
  lightEnrichMateria,
  fetchOrdemDiaMateriaIds,
  type SaplSessao,
} from './client';

// ID do Gabinete Carol Dantas — único gabinete ativo no sistema.
// Será necessário parametrizar quando houver multi-tenancy.
const GABINETE_ID =
  process.env.GABINETE_ID || 'f25299db-1c33-45b9-830f-82f6d2d666ef';

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Extração de IDs do PDF da pauta ────────────────────────────
// Mesma estratégia dual usada em /api/pareceres/ordem-dia:
// 1. Busca direta no buffer bruto (URI annotations plaintext)
// 2. Descompressão FlateDecode de streams PDF
async function extractMateriaIdsFromPdf(pdfUrl: string): Promise<number[]> {
  // Normaliza URL relativa para absoluta (SAPL retorna paths relativos em upload_pauta)
  const absoluteUrl = pdfUrl.startsWith('http') ? pdfUrl : `${SAPL_BASE}${pdfUrl}`;
  try {
    const res = await fetch(absoluteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 CMBV-Gabinete/2.0' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];

    const buf = Buffer.from(await res.arrayBuffer());
    const ids = new Set<number>();
    const urlRegex = /sapl\.boavista\.rr\.leg\.br\/materia\/(\d+)/g;
    const relRegex = /\/materia\/(\d{4,6})\b/g;

    function scanText(text: string) {
      let m: RegExpExecArray | null;
      urlRegex.lastIndex = 0;
      while ((m = urlRegex.exec(text)) !== null) ids.add(parseInt(m[1], 10));
      relRegex.lastIndex = 0;
      while ((m = relRegex.exec(text)) !== null) ids.add(parseInt(m[1], 10));
    }

    // PDF hex string: /URI <hex> — URL codificada em hexadecimal (ObjStm PDF 1.5+)
    function scanHexUris(text: string) {
      const hexRegex = /\/URI\s*<([0-9A-Fa-f\s]+)>/g;
      let m: RegExpExecArray | null;
      while ((m = hexRegex.exec(text)) !== null) {
        try {
          scanText(Buffer.from(m[1].replace(/\s/g, ''), 'hex').toString('latin1'));
        } catch { /* hex inválido */ }
      }
    }

    // Estratégia 1: buffer bruto (PDFs com URI annotations plaintext ou hex)
    const rawText = buf.toString('latin1');
    scanText(rawText);
    scanHexUris(rawText);

    // Estratégia 2: streams FlateDecode comprimidos (conteúdo e ObjStm)
    let pos = 0;
    while (pos < buf.length) {
      let streamStart = buf.indexOf(Buffer.from('stream\n'), pos);
      const streamStartCRLF = buf.indexOf(Buffer.from('stream\r\n'), pos);
      let headerLen = 7;
      if (streamStartCRLF !== -1 && (streamStart === -1 || streamStartCRLF < streamStart)) {
        streamStart = streamStartCRLF;
        headerLen = 8;
      }
      if (streamStart === -1) break;
      const endstream = buf.indexOf(Buffer.from('endstream'), streamStart + headerLen);
      if (endstream === -1) break;
      const compressed = buf.slice(streamStart + headerLen, endstream);
      for (const inflate of [inflateSync, inflateRawSync]) {
        try {
          const decompressed = inflate(compressed).toString('latin1');
          scanText(decompressed);
          scanHexUris(decompressed);
          break;
        } catch { /* não é FlateDecode */ }
      }
      pos = endstream + 9;
    }

    // Estratégia 3: OCR (PDFs baseados em imagem — CMBV usa JPEG embutido)
    if (ids.size === 0) {
      const ocrIds = await extractMateriaIdsViaOcr(buf);
      ocrIds.forEach(id => ids.add(id));
    }

    return Array.from(ids);
  } catch {
    return [];
  }
}

// ── Tipos de retorno ──────────────────────────────────────────

export interface SyncResult {
  sessoes_synced: number;
  sessoes_pdfs_processed: number;
  materias_synced: number;
  errors: string[];
  duration_ms: number;
}

// ── Sync principal ────────────────────────────────────────────

export async function syncSapl(): Promise<SyncResult> {
  const supabase = createServiceClient();
  const startedAt = Date.now();
  const errors: string[] = [];
  let sessoes_synced = 0;
  let sessoes_pdfs_processed = 0;
  let materias_synced = 0;

  // Log de início
  const { data: logRow } = await supabase
    .from('sapl_sync_logs')
    .insert({
      gabinete_id: GABINETE_ID,
      target_table: 'sessoes',
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  const logId = logRow?.id;

  try {
    // ── 1. Busca sessões recentes do SAPL ──────────────────────
    const { results: sessions } = await fetchRecentSessions(100);
    sessoes_synced = sessions.length;

    // Mapeia para o schema da migration 006 + cols extras da 007
    const sessaoRows = sessions.map((s: SaplSessao) => ({
      id: s.id,
      gabinete_id: GABINETE_ID,
      tipo_sessao: typeof s.tipo === 'object' ? s.tipo?.nome : null,
      data_sessao: s.data_inicio || null,
      hora_inicio: s.hora_inicio || null,
      numero: s.numero || null,
      upload_pauta: s.upload_pauta || null,
      upload_ata: s.upload_ata || null,
      str_repr: s.__str__ || null,
      ativa: true,
      last_synced_at: new Date().toISOString(),
    }));

    // Upsert: atualiza campos básicos, mas NÃO sobrescreve pdf_processado/materia_ids
    // (essas colunas só são atualizadas na etapa de processamento de PDF abaixo).
    // Supabase upsert atualiza apenas as colunas presentes no objeto.
    const { error: sessErr } = await supabase
      .from('sapl_sessoes_cache')
      .upsert(sessaoRows, { onConflict: 'id' });
    if (sessErr) errors.push(`Upsert sessoes: ${sessErr.message}`);

    // Se upload_pauta mudou em uma sessão já processada, reprocessar
    // (Ex: câmara substitui a pauta por versão corrigida)
    if (sessions.length > 0) {
      const { data: processadas } = await supabase
        .from('sapl_sessoes_cache')
        .select('id, upload_pauta')
        .eq('pdf_processado', true)
        .in('id', sessions.map(s => s.id));

      const processadasMap = new Map((processadas || []).map(p => [p.id, p.upload_pauta]));
      const idsParaReprocessar = sessions
        .filter(s => {
          const cached = processadasMap.get(s.id);
          return cached !== undefined && cached !== (s.upload_pauta || null);
        })
        .map(s => s.id);

      if (idsParaReprocessar.length > 0) {
        await supabase
          .from('sapl_sessoes_cache')
          .update({ pdf_processado: false, materia_ids: [] })
          .in('id', idsParaReprocessar);
      }
    }

    // ── 2. Processa PDFs das sessões pendentes ─────────────────
    const { data: pendentes } = await supabase
      .from('sapl_sessoes_cache')
      .select('id, upload_pauta, data_sessao, str_repr')
      .or('pdf_processado.eq.false,materia_ids.eq.{}')
      .not('upload_pauta', 'is', null)
      .limit(20); // Máx 20 PDFs por execução (evita timeout)

    for (const s of (pendentes || [])) {
      let ids = await extractMateriaIdsFromPdf(s.upload_pauta);
      // Fallback: PDF sem links embutidos (ex: pauta visual sem hyperlinks)
      // Usa tramitações AVPP (status 57) ou vinculadas à sessão por FK
      if (ids.length === 0) {
        const sessaoFake: SaplSessao = { id: s.id, data_inicio: s.data_sessao ?? undefined };
        ids = await fetchOrdemDiaMateriaIds(sessaoFake).catch(() => []);
      }
      await supabase
        .from('sapl_sessoes_cache')
        .update({ materia_ids: ids, pdf_processado: ids.length > 0 })
        .eq('id', s.id);
      sessoes_pdfs_processed++;
    }

    // ── 3. Coleta todos os materia_ids de sessões processadas ──
    const { data: todasProcessadas } = await supabase
      .from('sapl_sessoes_cache')
      .select('materia_ids')
      .eq('pdf_processado', true)
      .not('materia_ids', 'eq', '{}');

    const allMateriaIds = new Set<number>();
    (todasProcessadas || []).forEach(s => {
      (s.materia_ids || []).forEach((id: number) => allMateriaIds.add(id));
    });

    // ── 4. Identifica matérias ainda não cacheadas ─────────────
    const idsArr = Array.from(allMateriaIds);
    if (idsArr.length > 0) {
      const { data: existing } = await supabase
        .from('sapl_materias_cache')
        .select('id')
        .in('id', idsArr);

      const existingSet = new Set((existing || []).map((r: { id: number }) => r.id));
      const missing = idsArr.filter(id => !existingSet.has(id));

      // ── 5. Busca e upserta matérias ausentes em lotes ─────────
      // Usa o ID da sessão mais recente que contém a matéria como sessao_id FK
      const { data: sessaoMaisRecente } = await supabase
        .from('sapl_sessoes_cache')
        .select('id, materia_ids, data_sessao')
        .eq('pdf_processado', true)
        .order('data_sessao', { ascending: false })
        .limit(50);

      // Mapa materia_id → sessao_id (da sessão mais recente)
      const materiaToSessao = new Map<number, number>();
      (sessaoMaisRecente || []).forEach(s => {
        (s.materia_ids || []).forEach((mid: number) => {
          if (!materiaToSessao.has(mid)) materiaToSessao.set(mid, s.id);
        });
      });

      for (let i = 0; i < missing.length; i += 10) {
        const batch = missing.slice(i, i + 10);
        const enriched = await Promise.all(
          batch.map(async (id) => {
            try {
              const mat = await fetchMateria(id);
              const rich = await lightEnrichMateria(mat);
              return {
                id: rich.id,
                sessao_id: materiaToSessao.get(rich.id) || null,
                gabinete_id: GABINETE_ID,
                tipo_sigla: rich.tipo_sigla || null,
                numero: rich.numero,
                ano: rich.ano,
                ementa: rich.ementa || null,
                autores: rich.autor_nome || null,
                last_synced_at: new Date().toISOString(),
              };
            } catch {
              return null;
            }
          }),
        );

        const validRows = enriched.filter(Boolean);
        if (validRows.length > 0) {
          const { error: matErr } = await supabase
            .from('sapl_materias_cache')
            .upsert(validRows, { onConflict: 'id' });
          if (matErr) errors.push(`Upsert materias batch ${i}: ${matErr.message}`);
          else materias_synced += validRows.length;
        }

        // Throttle para respeitar rate limit do SAPL
        if (i + 10 < missing.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }

    // ── 6. Trigger Assíncrono de Pareceres (D+1) ─────────────
    if (pendentes && pendentes.length > 0) {
      const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('supabase.co', 'vercel.app') ?? 'http://localhost:3000';
      for (const s of pendentes) {
        const { data: sData } = await supabase.from('sapl_sessoes_cache').select('materia_ids').eq('id', s.id).single();
        if (sData && sData.materia_ids && sData.materia_ids.length > 0) {
          fetch(`${baseUrl}/api/pareceres/gerar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              materia_ids: sData.materia_ids,
              data_sessao: s.data_sessao,
              sessao_str: s.str_repr,
              folha_votacao_url: s.upload_pauta,
              model: 'flash'
            })
          }).catch(err => console.error('[SYNC] D+1 Trigger Error:', err));
        }
      }
    }

    // Atualiza log com sucesso
    if (logId) {
      await supabase
        .from('sapl_sync_logs')
        .update({
          status: errors.length === 0 ? 'success' : 'error',
          records_synced: sessoes_synced + materias_synced,
          error_message: errors.length > 0 ? errors.join(' | ') : null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', logId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido no sync';
    errors.push(msg);
    if (logId) {
      await supabase
        .from('sapl_sync_logs')
        .update({ status: 'error', error_message: msg, completed_at: new Date().toISOString() })
        .eq('id', logId);
    }
  }

  return {
    sessoes_synced,
    sessoes_pdfs_processed,
    materias_synced,
    errors,
    duration_ms: Date.now() - startedAt,
  };
}

// ── Helpers de leitura do cache ───────────────────────────────

/**
 * Retorna sessões do cache (format compatível com SaplSessao[]).
 * Retorna null se o cache estiver vazio (fallback para SAPL ao vivo).
 */
export async function getCachedSessoes(): Promise<null | {
  count: number;
  results: Array<{
    id: number;
    data_inicio: string | null;
    numero: number | null;
    upload_pauta: string | null;
    __str__: string | null;
    finalizada: boolean;
  }>;
}> {
  const supabase = createServiceClient();
  const currentYear = new Date().getFullYear();

  const { data, error } = await supabase
    .from('sapl_sessoes_cache')
    .select('id, data_sessao, numero, upload_pauta, str_repr, ativa')
    .gte('data_sessao', `${currentYear}-01-01`)
    .order('data_sessao', { ascending: false })
    .limit(100);

  if (error || !data || data.length === 0) return null;

  return {
    count: data.length,
    results: data.map(s => ({
      id: s.id,
      data_inicio: s.data_sessao,
      numero: s.numero,
      upload_pauta: s.upload_pauta,
      __str__: s.str_repr,
      finalizada: !s.ativa,
    })),
  };
}

/**
 * Retorna ordem do dia de uma sessão a partir do cache.
 * Retorna null se a sessão não estiver cacheada/processada.
 */
export async function getCachedOrdemDia(sessaoId: number): Promise<null | {
  sessao: {
    id: number;
    str_repr: string | null;
    data_sessao: string | null;
    upload_pauta: string | null;
    materia_ids: number[];
  };
  materias: Array<{
    id: number;
    numero: number;
    ano: number;
    ementa: string | null;
    tipo_sigla: string | null;
    autores: string | null;
  }>;
}> {
  const supabase = createServiceClient();

  const { data: sessao, error: sErr } = await supabase
    .from('sapl_sessoes_cache')
    .select('id, str_repr, data_sessao, upload_pauta, materia_ids, pdf_processado')
    .eq('id', sessaoId)
    .single();

  if (sErr || !sessao || !sessao.pdf_processado || !sessao.materia_ids?.length) {
    return null;
  }

  // Rejeita cache de sessões futuras com matérias demais (indica AVPP sem filtro de data).
  // Sessões normais têm 5-50 matérias; >100 provavelmente veio de query AVPP irrestrita.
  const today = new Date().toISOString().slice(0, 10);
  const isFuture = (sessao.data_sessao ?? '') > today;
  if (isFuture && sessao.materia_ids.length > 100) {
    return null;
  }

  const { data: materias, error: mErr } = await supabase
    .from('sapl_materias_cache')
    .select('id, numero, ano, ementa, tipo_sigla, autores')
    .in('id', sessao.materia_ids);

  if (mErr || !materias || materias.length === 0) return null;

  // Mantém a ordem original do PDF (materia_ids está na ordem da pauta)
  const materiasMap = new Map(materias.map(m => [m.id, m]));
  const materiasOrdenadas = sessao.materia_ids
    .map((id: number) => materiasMap.get(id))
    .filter(Boolean) as typeof materias;

  return { sessao, materias: materiasOrdenadas };
}
