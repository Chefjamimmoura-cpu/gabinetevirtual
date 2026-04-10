// src/lib/alia/sentinel/analyzer.ts

import { DiarioEntry } from './collector.interface';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

export interface AuthorityChange {
  tipo: 'nomeacao' | 'exoneracao' | 'posse' | 'substituicao' | 'aposentadoria';
  nome: string;
  cargo_anterior?: string;
  cargo_novo?: string;
  orgao: string;
  esfera: 'municipal' | 'estadual' | 'federal' | 'judiciario';
  data_efeito: string;
  fonte_url: string;
  trecho_original: string;
  confidence: number;
  matched_person_id?: string;
}

interface RawAto {
  tipo: string;
  nome: string;
  cargo_anterior?: string;
  cargo_novo?: string;
  orgao: string;
  data_efeito: string;
  trecho: string;
}

interface CadinPerson {
  id: string;
  name: string;
  cargo?: string;
  orgao?: string;
}

function resolveEsfera(source: string): AuthorityChange['esfera'] {
  switch (source) {
    case 'dou':  return 'federal';
    case 'tse':  return 'federal';
    case 'doerr': return 'estadual';
    case 'dombv': return 'municipal';
    case 'dje':  return 'judiciario';
    default:     return 'municipal';
  }
}

function nameSimilarity(a: string, b: string): number {
  const wordsA = a.toLowerCase().split(/\s+/).filter(Boolean);
  const wordsB = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const setB = new Set(wordsB);
  const overlap = wordsA.filter(w => setB.has(w)).length;
  return overlap / Math.max(wordsA.length, wordsB.length);
}

const EXTRACTION_PROMPT = `Extraia TODAS as nomeações, exonerações, posses, substituições e aposentadorias do texto abaixo.
Para cada ato, retorne JSON:
{
  "atos": [
    {
      "tipo": "nomeacao|exoneracao|posse|substituicao|aposentadoria",
      "nome": "nome completo da pessoa",
      "cargo_anterior": "cargo anterior (se exoneração/substituição)",
      "cargo_novo": "cargo novo (se nomeação/posse)",
      "orgao": "órgão/secretaria",
      "data_efeito": "YYYY-MM-DD",
      "trecho": "trecho exato do diário que comprova o ato"
    }
  ]
}
Se nenhum ato encontrado, retorne {"atos": []}.
Texto do diário:
{rawText}`;

export async function analyzeEntries(
  entries: DiarioEntry[],
  gabineteId: string,
): Promise<AuthorityChange[]> {
  if (entries.length === 0) return [];

  const geminiKey = process.env.GEMINI_API_KEY ?? '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  // ------------------------------------------------------------------
  // Pass 1: Broad extraction — one Gemini call per DiarioEntry
  // ------------------------------------------------------------------
  const rawChanges: Array<{ ato: RawAto; entry: DiarioEntry }> = [];

  for (const entry of entries) {
    try {
      const prompt = EXTRACTION_PROMPT.replace('{rawText}', entry.rawText);
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      // Strip markdown code fences if present
      const jsonText = text.replace(/```(?:json)?\n?/g, '').trim();

      let parsed: { atos: RawAto[] };
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        // Try to extract JSON object from the response
        const match = jsonText.match(/\{[\s\S]*\}/);
        if (!match) continue;
        parsed = JSON.parse(match[0]);
      }

      if (!Array.isArray(parsed.atos)) continue;

      for (const ato of parsed.atos) {
        rawChanges.push({ ato, entry });
      }
    } catch {
      // Skip failed entry and continue with others
      continue;
    }
  }

  if (rawChanges.length === 0) return [];

  // ------------------------------------------------------------------
  // Pass 2: Match against CADIN authorities
  // ------------------------------------------------------------------
  let cadinPersons: CadinPerson[] = [];

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data } = await supabase
      .from('cadin_persons')
      .select('id, name, cargo, orgao')
      .eq('gabinete_id', gabineteId);

    if (data) cadinPersons = data as CadinPerson[];
  } catch {
    // If CADIN fetch fails, continue without matching
  }

  const changes: AuthorityChange[] = rawChanges.map(({ ato, entry }) => {
    const esfera = resolveEsfera(entry.source);

    // Default: no match
    let confidence = 0.7;
    let matched_person_id: string | undefined;

    const normalizedAtoName = ato.nome.toLowerCase().trim();

    for (const person of cadinPersons) {
      const normalizedPersonName = person.name.toLowerCase().trim();

      // Exact name match
      if (normalizedAtoName === normalizedPersonName) {
        confidence = 0.95;
        matched_person_id = person.id;
        break;
      }

      // Partial match: >70% similarity + same orgao
      const sim = nameSimilarity(normalizedAtoName, normalizedPersonName);
      if (sim > 0.7) {
        const sameOrgao =
          !person.orgao ||
          !ato.orgao ||
          ato.orgao.toLowerCase().includes(person.orgao.toLowerCase()) ||
          person.orgao.toLowerCase().includes(ato.orgao.toLowerCase());

        if (sameOrgao) {
          confidence = 0.8;
          matched_person_id = person.id;
          // Do not break — keep looking for an exact match
        }
      }
    }

    const change: AuthorityChange = {
      tipo: ato.tipo as AuthorityChange['tipo'],
      nome: ato.nome,
      orgao: ato.orgao,
      esfera,
      data_efeito: ato.data_efeito,
      fonte_url: entry.url,
      trecho_original: ato.trecho,
      confidence,
    };

    if (ato.cargo_anterior) change.cargo_anterior = ato.cargo_anterior;
    if (ato.cargo_novo) change.cargo_novo = ato.cargo_novo;
    if (matched_person_id) change.matched_person_id = matched_person_id;

    return change;
  });

  return changes;
}
