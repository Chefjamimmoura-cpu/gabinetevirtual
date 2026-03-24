// GET /api/pareceres/ordem-dia?sessao=ID
// Retorna matérias da Ordem do Dia de uma sessão, enriquecidas com dados do SAPL.
//
// ESTRATÉGIA DB-first (V3-F1):
// 0. Tenta servir do cache Supabase (sapl_sessoes_cache + sapl_materias_cache) — ~50ms
//    Cache preenchido pelo cron POST /api/admin/sync-sapl.
// 1. Fallback: Download do PDF upload_pauta da sessão
// 2. Extração dos IDs de matéria dos links embutidos no PDF (/materia/NNNNN)
//    Os links de anotação em PDF são armazenados como texto não comprimido,
//    portanto acessíveis via regex no buffer bruto.
// 3. Fallback: tramitações por data + status de votação (para sessões sem PDF)

import { NextRequest, NextResponse } from 'next/server';
import { inflateSync, inflateRawSync } from 'zlib';
import {
  fetchMateria,
  lightEnrichMateria,
  extractDocumentosSessao,
  fetchOrdemDiaMateriaIds,
  SAPL_BASE,
  type SaplSessao,
} from '@/lib/sapl/client';
import { getCachedOrdemDia } from '@/lib/sapl/sync';
import { extractMateriaIdsViaOcr } from '@/lib/sapl/ocr';

// Listagem usa enriquecimento LEVE (tipo + autor apenas).
// Enriquecimento completo (docs, tramitações, pareceres) é feito na rota /gerar
// apenas para as matérias selecionadas pelo usuário.
const ENRICH_BATCH_SIZE = 10; // leve o suficiente para 10 em paralelo

async function fetchSessaoById(sessaoId: number): Promise<SaplSessao | null> {
  const url = `${SAPL_BASE}/api/sessao/sessaoplenaria/${sessaoId}/?format=json`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 CMBV-Gabinete/2.0' },
    });
    if (!res.ok) return null;
    return (await res.json()) as SaplSessao;
  } catch {
    return null;
  }
}

/**
 * Extrai IDs de matéria do PDF da pauta (upload_pauta).
 *
 * O PDF do SAPL exibe os links das matérias como texto visível:
 *   https://sapl.boavista.rr.leg.br/materia/NNNNN
 *
 * Estratégia: descompactar todos os streams FlateDecode do PDF usando
 * o módulo nativo `zlib` do Node.js — sem dependências externas.
 * A URL aparece como texto legível no stream de conteúdo após descompressão.
 */
async function extractMateriaIdsFromPdf(pdfUrl: string): Promise<number[]> {
  // Normaliza URL relativa para absoluta (SAPL retorna paths relativos em upload_pauta)
  const absoluteUrl = pdfUrl.startsWith('http') ? pdfUrl : `${SAPL_BASE}${pdfUrl}`;
  try {
    const res = await fetch(absoluteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 CMBV-Gabinete/2.0' },
    });
    if (!res.ok) return [];

    const buf = Buffer.from(await res.arrayBuffer());
    const ids = new Set<number>();

    // Regex 1: URL absoluta com domínio
    const urlRegex = /sapl\.boavista\.rr\.leg\.br\/materia\/(\d+)/g;
    // Regex 2: URL relativa /materia/NNNNN (PDFs mais novos do SAPL usam paths relativos)
    const relRegex = /\/materia\/(\d{4,6})\b/g;

    function scanText(text: string) {
      let m: RegExpExecArray | null;
      urlRegex.lastIndex = 0;
      while ((m = urlRegex.exec(text)) !== null) ids.add(parseInt(m[1], 10));
      relRegex.lastIndex = 0;
      while ((m = relRegex.exec(text)) !== null) ids.add(parseInt(m[1], 10));
    }

    // PDF hex string: /URI <hex> → decodifica e varre novamente.
    // Cobre PDFs com anotações URI em ObjStm (PDF 1.5+) onde a string da URL
    // é codificada em hexadecimal: /URI <68747470733A2F2F7361706C...>
    function scanHexUris(text: string) {
      const hexRegex = /\/URI\s*<([0-9A-Fa-f\s]+)>/g;
      let m: RegExpExecArray | null;
      while ((m = hexRegex.exec(text)) !== null) {
        try {
          scanText(Buffer.from(m[1].replace(/\s/g, ''), 'hex').toString('latin1'));
        } catch { /* ignora hex inválido */ }
      }
    }

    // Estratégia 1: busca direta no buffer bruto (latin1).
    // Cobre PDFs que armazenam URLs como anotações URI plaintext.
    const rawText = buf.toString('latin1');
    scanText(rawText);
    scanHexUris(rawText);

    // Estratégia 2: descomprime streams FlateDecode e busca nos conteúdos.
    // Cobre PDFs que embutem URLs em streams comprimidos (conteúdo e ObjStm).
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
        } catch {
          // stream não é FlateDecode — ignora
        }
      }
      pos = endstream + 9;
    }

    // Estratégia 3: OCR (PDFs baseados em imagem — CMBV usa JPEG embutido)
    // Silenciosamente ignorada se pdftoppm/tesseract não estiverem disponíveis.
    if (ids.size === 0) {
      const ocrIds = await extractMateriaIdsViaOcr(buf);
      ocrIds.forEach(id => ids.add(id));
    }

    return Array.from(ids);
  } catch {
    return [];
  }
}


export async function GET(req: NextRequest) {
  const sessaoId = req.nextUrl.searchParams.get('sessao');
  if (!sessaoId || isNaN(Number(sessaoId))) {
    return NextResponse.json({ error: 'Parâmetro ?sessao=ID obrigatório' }, { status: 400 });
  }

  const id = Number(sessaoId);

  try {
    // 0. DB-first: tenta cache Supabase (preenchido pelo cron sync-sapl)
    // Usa materia_ids[] da sessão — correto mesmo quando a mesma matéria
    // aparece em múltiplas sessões (diferente da abordagem por sessao_id FK).
    try {
      const cached = await getCachedOrdemDia(id);
      if (cached) {
        const { sessao: s, materias: mats } = cached;
        const sessaoFake: SaplSessao = {
          id: s.id,
          data_inicio: s.data_sessao ?? undefined,
          upload_pauta: s.upload_pauta ?? undefined,
        };
        const materias = mats.map(m => ({
          id: m.id,
          numero: m.numero,
          ano: m.ano,
          ementa: m.ementa,
          tipo_sigla: m.tipo_sigla,
          autor_nome: m.autores,
          _docs: [],
          _tramits: [],
          _pareceres: [],
          _autorias: [],
        }));
        return NextResponse.json({
          sessao_id: id,
          sessao_str: s.str_repr || `Sessão ${id}`,
          data_inicio: s.data_sessao,
          total: materias.length,
          materias,
          documentos_sessao: extractDocumentosSessao(sessaoFake),
          folha_votacao_url: s.upload_pauta || null,
          fonte: 'cache',
        });
      }
    } catch {
      // Cache indisponível — continua para SAPL ao vivo
    }

    // 1. Fallback ao vivo: busca dados da sessão no SAPL
    const sessao = await fetchSessaoById(id);
    if (!sessao) {
      return NextResponse.json({ error: `Sessão ${id} não encontrada no SAPL` }, { status: 404 });
    }

    const documentos_sessao = extractDocumentosSessao(sessao);
    const folha_votacao_url = sessao.upload_pauta || null;

    // 2. Identifica matérias: PDF primeiro, fallback por tramitação
    let materiaIds: number[] = [];
    let fonte = 'pdf';

    if (sessao.upload_pauta) {
      materiaIds = await extractMateriaIdsFromPdf(sessao.upload_pauta);
    }

    if (materiaIds.length === 0) {
      materiaIds = await fetchOrdemDiaMateriaIds(sessao);
      fonte = 'tramitacao';
    }

    if (materiaIds.length === 0) {
      return NextResponse.json({
        sessao_id: id,
        sessao_str: sessao.__str__ || `Sessão ${id}`,
        data_inicio: sessao.data_inicio,
        total: 0,
        materias: [],
        documentos_sessao,
        folha_votacao_url,
        fonte,
        aviso: sessao.upload_pauta
          ? 'PDF encontrado mas não contém links de matéria indexáveis.'
          : 'Nenhuma matéria identificada. A pauta pode não ter sido publicada ainda no SAPL.',
      });
    }

    // 3. Enriquecimento LEVE em lotes paralelos (tipo + autor apenas)
    const materias = [];
    for (let i = 0; i < materiaIds.length; i += ENRICH_BATCH_SIZE) {
      const batch = materiaIds.slice(i, i + ENRICH_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (materiaId) => {
          try {
            const materia = await fetchMateria(materiaId);
            return await lightEnrichMateria(materia);
          } catch {
            return null;
          }
        })
      );
      materias.push(...results.filter((m): m is NonNullable<typeof m> => m !== null));
    }

    return NextResponse.json({
      sessao_id: id,
      sessao_str: sessao.__str__ || `Sessão ${id}`,
      data_inicio: sessao.data_inicio,
      total: materias.length,
      materias,
      documentos_sessao,
      folha_votacao_url,
      fonte,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar ordem do dia';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
