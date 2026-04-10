// src/lib/alia/cadin-ingestor.ts
// CADIN Ingestor — importa documentos PDF/DOCX de autoridades para curadoria.
// Usa Gemini Vision para extração de texto (PDF) e Gemini Flash para análise estruturada.
// Gera registros na fila cadin_pending_updates para revisão humana.

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Lazy singletons (evita avaliação no build do Next.js) ──────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function getGenAI() {
  return new GoogleGenerativeAI(
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY!,
  );
}

// ── Tipos exportados ───────────────────────────────────────────────────────────

export interface CadinIngestRecord {
  nome: string;
  nome_social?: string;
  cargo: string;
  orgao: string;
  esfera: 'municipal' | 'estadual' | 'federal' | 'judiciario' | 'legislativo';
  tipo: 'titular' | 'adjunto' | 'interino' | 'substituto';
  telefone_orgao?: string;
  telefone_pessoal?: string;
  email_institucional?: string;
  email_pessoal?: string;
  endereco_orgao?: string;
  partido?: string;
  data_nomeacao?: string;
  data_nascimento?: string;
  confidence: number;
  trecho_original: string;
  pagina?: number;
  notas_extracao?: string;
}

export interface IngestResult {
  job_id: string;
  records_found: number;
  records_new: number;
  records_update: number;
  records_ambiguous: number;
}

// ── Tipos internos ─────────────────────────────────────────────────────────────

interface GeminiAutoridade {
  nome?: string;
  cargo?: string;
  orgao?: string;
  esfera?: string;
  tipo?: string;
  telefone_orgao?: string;
  telefone_pessoal?: string;
  email_institucional?: string;
  email_pessoal?: string;
  endereco_orgao?: string;
  partido?: string;
  data_nomeacao?: string;
  data_nascimento?: string;
  confidence?: number;
  trecho_original?: string;
  pagina?: number;
  notas_extracao?: string;
}

// Tipo mínimo para dedup contra cadin_persons
interface PersonRow {
  id: string;
  full_name: string;
}

// Resultado da dedup de um registro individual
type DedupClass = 'novo' | 'atualiza' | 'ambiguo';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Remove markdown code fences que o Gemini às vezes inclui. */
function stripCodeFences(raw: string): string {
  return raw.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
}

/** Divide texto em chunks de no máximo maxChars caracteres, quebrando em linhas. */
function chunkText(text: string, maxChars = 3000): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Normaliza nome para comparação fuzzy (remove acentos, maiúsculas, espaços extras). */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Passo 1: criar job ─────────────────────────────────────────────────────────

async function createJob(
  gabineteId: string,
  fileUrl: string,
  filename: string,
): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cadin_ingest_jobs')
    .insert({
      gabinete_id: gabineteId,
      file_url: fileUrl,
      filename,
      status: 'processando',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Falha ao criar cadin_ingest_job: ${error?.message ?? 'sem retorno'}`);
  }
  return data.id as string;
}

// ── Passo 2: extração de texto ─────────────────────────────────────────────────

async function extractTextFromPdf(fileUrl: string): Promise<string> {
  const genai = getGenAI();
  // gemini-2.0-flash suporta input de URL via fileData
  const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent([
    {
      fileData: {
        mimeType: 'application/pdf',
        fileUri: fileUrl,
      },
    },
    {
      text: 'Extraia todo o texto deste documento, preservando a estrutura.',
    },
  ]);

  return result.response.text().trim();
}

async function extractText(filename: string, fileUrl: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'pdf') {
    return extractTextFromPdf(fileUrl);
  }

  if (ext === 'docx') {
    // Integração com mammoth pode ser adicionada futuramente
    console.log('[cadin-ingestor] DOCX parsing requires mammoth — returning raw');
    return '';
  }

  // Tenta tratar como PDF por padrão
  return extractTextFromPdf(fileUrl);
}

// ── Passo 3: análise estruturada com Gemini ────────────────────────────────────

const ANALISE_PROMPT = `Você é um agente especializado em extrair dados de autoridades governamentais de documentos oficiais brasileiros.

Extraia TODAS as autoridades mencionadas no texto abaixo. Para cada uma, retorne JSON:
{
  "autoridades": [
    {
      "nome": "nome completo",
      "cargo": "cargo completo desabreviado",
      "orgao": "órgão/secretaria",
      "esfera": "municipal|estadual|federal|judiciario|legislativo",
      "tipo": "titular|adjunto|interino|substituto",
      "telefone_orgao": "se disponível",
      "telefone_pessoal": "se disponível",
      "email_institucional": "se disponível",
      "email_pessoal": "se disponível",
      "endereco_orgao": "se disponível",
      "partido": "se disponível",
      "data_nomeacao": "YYYY-MM-DD se disponível",
      "data_nascimento": "YYYY-MM-DD se disponível",
      "confidence": 0.0,
      "trecho_original": "trecho exato do documento",
      "notas_extracao": "observações sobre interpretações feitas"
    }
  ]
}

REGRAS:
- Desabrevie TODOS os cargos (Sec. → Secretário, Adj. → Adjunto)
- Se cargo ambíguo, use notas_extracao
- Confidence baixo (< 0.6) quando inferir dados não explícitos
- NUNCA invente dados — deixe vazio o que não constar

TEXTO:`;

async function analyzeChunk(
  chunk: string,
  esferaHint?: string,
): Promise<CadinIngestRecord[]> {
  const genai = getGenAI();
  const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const hint = esferaHint
    ? `\n\nDica de contexto: a esfera predominante neste documento é "${esferaHint}".`
    : '';

  const resp = await model.generateContent(`${ANALISE_PROMPT}${hint}\n\n${chunk}`);
  const raw = stripCodeFences(resp.response.text());

  let parsed: { autoridades?: GeminiAutoridade[] } = {};
  try {
    parsed = JSON.parse(raw) as { autoridades?: GeminiAutoridade[] };
  } catch {
    console.warn('[cadin-ingestor] Falha ao parsear resposta do Gemini:', raw.slice(0, 200));
    return [];
  }

  const autoridades = parsed.autoridades ?? [];

  return autoridades
    .filter((a): a is GeminiAutoridade & { nome: string; cargo: string; orgao: string } =>
      Boolean(a.nome && a.cargo && a.orgao),
    )
    .map((a) => ({
      nome: a.nome,
      cargo: a.cargo,
      orgao: a.orgao,
      esfera: (['municipal', 'estadual', 'federal', 'judiciario', 'legislativo'].includes(a.esfera ?? '')
        ? a.esfera
        : 'municipal') as CadinIngestRecord['esfera'],
      tipo: (['titular', 'adjunto', 'interino', 'substituto'].includes(a.tipo ?? '')
        ? a.tipo
        : 'titular') as CadinIngestRecord['tipo'],
      telefone_orgao: a.telefone_orgao || undefined,
      telefone_pessoal: a.telefone_pessoal || undefined,
      email_institucional: a.email_institucional || undefined,
      email_pessoal: a.email_pessoal || undefined,
      endereco_orgao: a.endereco_orgao || undefined,
      partido: a.partido || undefined,
      data_nomeacao: a.data_nomeacao || undefined,
      data_nascimento: a.data_nascimento || undefined,
      confidence: typeof a.confidence === 'number' ? a.confidence : 0.7,
      trecho_original: a.trecho_original ?? '',
      pagina: typeof a.pagina === 'number' ? a.pagina : undefined,
      notas_extracao: a.notas_extracao || undefined,
    }));
}

async function analyzeText(
  text: string,
  esfera?: string,
): Promise<CadinIngestRecord[]> {
  if (!text.trim()) return [];

  const chunks = chunkText(text, 3000);
  const results: CadinIngestRecord[] = [];

  for (const chunk of chunks) {
    try {
      const records = await analyzeChunk(chunk, esfera);
      results.push(...records);
    } catch (err) {
      console.error('[cadin-ingestor] Erro ao analisar chunk:', err);
      // Continua com os próximos chunks
    }
  }

  return results;
}

// ── Passo 4: dedup contra cadin_persons ───────────────────────────────────────

async function classifyRecord(
  gabineteId: string,
  record: CadinIngestRecord,
): Promise<{ classification: DedupClass; personId: string | null }> {
  const supabase = getSupabase();

  const palavras = record.nome.split(' ').filter((w) => w.length >= 3).slice(0, 3);
  if (palavras.length === 0) {
    return { classification: 'novo', personId: null };
  }

  // Busca por ilike no primeiro sobrenome significativo
  const { data: persons } = await supabase
    .from('cadin_persons')
    .select('id, full_name')
    .eq('gabinete_id', gabineteId)
    .ilike('full_name', `%${palavras[palavras.length - 1]}%`)
    .limit(10);

  if (!persons || persons.length === 0) {
    return { classification: 'novo', personId: null };
  }

  const normalizedTarget = normalizeName(record.nome);
  const exactMatch = (persons as PersonRow[]).find(
    (p) => normalizeName(p.full_name) === normalizedTarget,
  );

  if (exactMatch) {
    return { classification: 'atualiza', personId: exactMatch.id };
  }

  // Verifica correspondência parcial (nome começa igual — possível apelido ou nome social)
  const partialMatch = (persons as PersonRow[]).find((p) => {
    const norm = normalizeName(p.full_name);
    return (
      norm.startsWith(normalizedTarget.split(' ')[0]) &&
      norm.includes(normalizedTarget.split(' ').pop()!)
    );
  });

  if (partialMatch) {
    return { classification: 'ambiguo', personId: partialMatch.id };
  }

  return { classification: 'novo', personId: null };
}

// ── Passo 5: inserir pending_updates ──────────────────────────────────────────

async function insertPendingUpdate(
  gabineteId: string,
  jobId: string,
  record: CadinIngestRecord,
  classification: DedupClass,
  personId: string | null,
  fileUrl: string,
): Promise<void> {
  const supabase = getSupabase();

  const updateTypeMap: Record<DedupClass, string> = {
    novo: 'importacao_novo',
    atualiza: 'importacao_atualiza',
    ambiguo: 'importacao_ambiguo',
  };

  const suggestedChanges = {
    full_name: record.nome,
    nome_social: record.nome_social ?? '',
    title: record.cargo,
    organization_name: record.orgao,
    sphere: record.esfera,
    tipo: record.tipo,
    phone: record.telefone_pessoal ?? record.telefone_orgao ?? '',
    email: record.email_pessoal ?? record.email_institucional ?? '',
    party: record.partido ?? '',
    start_date: record.data_nomeacao ?? '',
    birthday: record.data_nascimento ?? '',
    address: record.endereco_orgao ?? '',
  };

  const geminiSummary =
    `${updateTypeMap[classification].toUpperCase()}: ${record.nome} → ${record.cargo} (${record.orgao})` +
    (record.notas_extracao ? ` | ${record.notas_extracao}` : '');

  const { error } = await supabase.from('cadin_pending_updates').insert({
    gabinete_id: gabineteId,
    person_id: personId,
    organization_id: null, // será resolvido na curadoria
    update_type: updateTypeMap[classification],
    extracted_text: record.trecho_original,
    source_url: fileUrl,
    source_date: record.data_nomeacao ?? null,
    gemini_summary: geminiSummary,
    suggested_changes: suggestedChanges,
    confidence: record.confidence,
    status: 'pendente',
    ingest_job_id: jobId,
  });

  if (error) {
    console.error('[cadin-ingestor] Erro ao inserir pending_update:', error.message);
  }
}

// ── Função principal exportada ─────────────────────────────────────────────────

export async function ingestDocument(
  gabineteId: string,
  fileUrl: string,
  filename: string,
  esfera?: string,
): Promise<IngestResult> {
  const supabase = getSupabase();

  // ── 1. Criar job ────────────────────────────────────────────────────────────
  let jobId: string;
  try {
    jobId = await createJob(gabineteId, fileUrl, filename);
  } catch (err) {
    console.error('[cadin-ingestor] Falha ao criar job:', err);
    // Retorna resultado vazio sem job_id real
    return {
      job_id: 'erro-criacao-job',
      records_found: 0,
      records_new: 0,
      records_update: 0,
      records_ambiguous: 0,
    };
  }

  const partialResult: IngestResult = {
    job_id: jobId,
    records_found: 0,
    records_new: 0,
    records_update: 0,
    records_ambiguous: 0,
  };

  // ── 2. Extração de texto ────────────────────────────────────────────────────
  let extractedText = '';
  try {
    extractedText = await extractText(filename, fileUrl);
  } catch (err) {
    console.error('[cadin-ingestor] Falha na extração de texto:', err);
    await supabase
      .from('cadin_ingest_jobs')
      .update({
        status: 'erro',
        error_log: `Falha na extração de texto: ${String(err)}`,
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    return partialResult;
  }

  if (!extractedText.trim()) {
    await supabase
      .from('cadin_ingest_jobs')
      .update({
        status: 'erro',
        error_log: 'Texto extraído vazio — formato não suportado ou documento sem conteúdo.',
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    return partialResult;
  }

  // ── 3. Análise com Gemini ───────────────────────────────────────────────────
  let records: CadinIngestRecord[] = [];
  try {
    records = await analyzeText(extractedText, esfera);
  } catch (err) {
    console.error('[cadin-ingestor] Falha na análise Gemini:', err);
    await supabase
      .from('cadin_ingest_jobs')
      .update({
        status: 'erro',
        error_log: `Falha na análise Gemini: ${String(err)}`,
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    return partialResult;
  }

  partialResult.records_found = records.length;

  // ── 4 + 5. Dedup e inserção de pending_updates ──────────────────────────────
  for (const record of records) {
    try {
      const { classification, personId } = await classifyRecord(gabineteId, record);

      await insertPendingUpdate(gabineteId, jobId, record, classification, personId, fileUrl);

      if (classification === 'novo') partialResult.records_new++;
      else if (classification === 'atualiza') partialResult.records_update++;
      else partialResult.records_ambiguous++;
    } catch (err) {
      console.error(`[cadin-ingestor] Erro ao processar registro "${record.nome}":`, err);
      // Continua com os demais registros
    }
  }

  // ── 6. Atualizar job com resultado final ────────────────────────────────────
  await supabase
    .from('cadin_ingest_jobs')
    .update({
      status: 'concluido',
      records_found: partialResult.records_found,
      records_new: partialResult.records_new,
      records_update: partialResult.records_update,
      records_ambiguous: partialResult.records_ambiguous,
      finished_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  // ── 7. Retornar resultado ───────────────────────────────────────────────────
  return partialResult;
}
