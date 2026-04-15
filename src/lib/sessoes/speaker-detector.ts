// ══════════════════════════════════════════════════════════
// Speaker Detection — Diarização heurística para sessões plenárias
//
// Estratégia: criar um novo speakerId a cada troca detectada.
// Erra para MAIS separações — o usuário junta manualmente com ALT+Click.
// Nunca atribui nomes automaticamente — sempre "Locutor N".
// ══════════════════════════════════════════════════════════

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  avgLogprob?: number;
  noSpeechProb?: number;
  isUnclear?: boolean;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface SpeakerBlock {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker: string;       // "Locutor N" (nunca nome de vereador)
  speakerId: string;     // ID único estável: "spk_1", "spk_2", ...
  speakerColor: string;
  isUnclear: boolean;
  segmentIds: number[];
  words?: TranscriptWord[]; // palavras com timestamps (para CTRL+Click split)
}

// Paleta de cores para locutores (suficiente para 20+ distintos)
const SPEAKER_COLORS = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
  '#fb923c', '#2dd4bf', '#e879f9', '#84cc16', '#f87171',
  '#38bdf8', '#c084fc', '#4ade80', '#facc15', '#fb7185',
  '#22d3ee', '#818cf8', '#65a30d', '#ea580c', '#db2777',
];

export function detectSpeakers(
  segments: TranscriptSegment[],
  words: TranscriptWord[],
  _mode: 'dialog' | 'plenario' = 'plenario',
): SpeakerBlock[] {
  if (!segments || segments.length === 0) return [];

  const micros = buildMicroSegments(segments, words || []);
  const splitMicros = splitAtSentences(micros);
  const labeled = assignSpeakers(splitMicros);
  const blocks = mergeBlocks(labeled, words || []);
  return detectSpeakerNamesByMention(blocks);
}

function buildMicroSegments(segments: TranscriptSegment[], words: TranscriptWord[]) {
  if (!words || words.length === 0) {
    return segments.map((s, i) => ({ ...s, id: i }));
  }

  const PAUSE_THRESHOLD = 0.25;
  const micros: TranscriptSegment[] = [];
  let currentWords: TranscriptWord[] = [];

  const flushBlock = () => {
    if (currentWords.length === 0) return;
    micros.push({
      id: micros.length,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: currentWords.map(w => w.word).join(' ').trim(),
    });
    currentWords = [];
  };

  const sortedWords = [...words].sort((a, b) => a.start - b.start);
  sortedWords.forEach((word, i) => {
    if (i > 0) {
      const gap = word.start - sortedWords[i - 1].end;
      if (gap >= PAUSE_THRESHOLD) flushBlock();
    }
    currentWords.push(word);
  });
  flushBlock();

  micros.forEach(micro => {
    const origSeg = segments.find(s => micro.start >= s.start - 0.1 && micro.end <= s.end + 0.1);
    if (origSeg) {
      micro.isUnclear = origSeg.isUnclear;
      micro.avgLogprob = origSeg.avgLogprob;
      micro.noSpeechProb = origSeg.noSpeechProb;
    }
  });

  return micros;
}

function splitAtSentences(micros: TranscriptSegment[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];

  for (const micro of micros) {
    const text = micro.text || '';
    const parts = text.split(/([.?!])\s+/);

    if (parts.length <= 1 || text.length < 60) {
      result.push(micro);
      continue;
    }

    const sentences: string[] = [];
    let current = '';
    for (let i = 0; i < parts.length; i++) {
      current += parts[i];
      if (i % 2 === 1) { sentences.push(current.trim()); current = ''; }
    }
    if (current.trim()) sentences.push(current.trim());
    if (sentences.length <= 1) { result.push(micro); continue; }

    const totalChars = sentences.reduce((s, sent) => s + sent.length, 0);
    const totalDuration = micro.end - micro.start;
    let timeOffset = micro.start;

    for (const sent of sentences) {
      const ratio = sent.length / totalChars;
      const duration = totalDuration * ratio;
      result.push({
        id: result.length, start: timeOffset, end: timeOffset + duration,
        text: sent, isUnclear: micro.isUnclear,
      });
      timeOffset += duration;
    }
  }

  return result.map((s, i) => ({ ...s, id: i }));
}

/**
 * Atribui speakerIds criando um novo ID a cada troca detectada.
 * Estratégia: errar para MAIS separações.
 * O usuário junta manualmente com ALT+Click blocos separados incorretamente.
 */
function assignSpeakers(micros: TranscriptSegment[]): (TranscriptSegment & { speakerId: string })[] {
  if (micros.length === 0) return [];

  // Threshold adaptativo baseado na mediana das pausas
  const pauses: number[] = [];
  for (let i = 1; i < micros.length; i++) {
    const gap = micros[i].start - micros[i - 1].end;
    if (gap > 0) pauses.push(gap);
  }

  let pauseThreshold = 0.4;
  if (pauses.length >= 2) {
    const sorted = [...pauses].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length * 0.5)];
    // Agressivo: threshold é 80% da mediana
    pauseThreshold = Math.max(0.25, median * 0.8);
  }

  let speakerCount = 1;
  let currentSpkId = `spk_${speakerCount}`;

  return micros.map((seg, i) => {
    if (i > 0) {
      const pause = seg.start - micros[i - 1].end;
      const prevText = (micros[i - 1].text || '').trim();
      const prevDur = micros[i - 1].end - micros[i - 1].start;
      const currDur = seg.end - seg.start;

      let change = false;

      // Pausa longa → troca forte
      if (pause >= 1.0) change = true;
      // Pausa acima do threshold adaptativo
      if (pause >= pauseThreshold) change = true;
      // Pergunta/exclamação seguida de pausa → fim de turno
      if (pause > 0.15 && (prevText.endsWith('?') || prevText.endsWith('!'))) change = true;
      // Mudança brusca de ritmo (duração)
      if (pause > 0.15) {
        const ratio = currDur / (prevDur || 0.1);
        if (ratio > 2.5 || ratio < 0.4) change = true;
      }
      // Fragmento curto seguido de fala longa → mudança de turno típica
      if (pause > 0.1 && prevDur < 1.5 && currDur > 4) change = true;

      if (change) {
        speakerCount++;
        currentSpkId = `spk_${speakerCount}`;
      }
    }
    return { ...seg, speakerId: currentSpkId };
  });
}

function mergeBlocks(
  segments: (TranscriptSegment & { speakerId: string })[],
  allWords: TranscriptWord[],
): SpeakerBlock[] {
  if (segments.length === 0) return [];

  const blocks: SpeakerBlock[] = [];
  let cur: SpeakerBlock | null = null;

  for (const seg of segments) {
    if (!cur || cur.speakerId !== seg.speakerId) {
      if (cur) blocks.push(cur);
      cur = {
        id: blocks.length,
        start: seg.start,
        end: seg.end,
        text: seg.text || '',
        speaker: '',        // preenchido por assignLocutorNames
        speakerId: seg.speakerId,
        speakerColor: '',   // preenchido por assignLocutorNames
        isUnclear: seg.isUnclear || false,
        segmentIds: [seg.id],
      };
    } else {
      cur.end = seg.end;
      cur.text += ' ' + (seg.text || '');
      cur.segmentIds.push(seg.id);
      if (seg.isUnclear) cur.isUnclear = true;
    }
  }
  if (cur) blocks.push(cur);

  // Normalizar texto e anexar palavras (para CTRL+Click split na UI)
  for (const b of blocks) {
    b.text = b.text.replace(/\s+/g, ' ').trim();
    if (allWords.length > 0) {
      b.words = allWords.filter(w => w.start >= b.start - 0.05 && w.end <= b.end + 0.05);
    }
  }

  return assignLocutorNames(blocks);
}

/**
 * Atribui nomes "Locutor 1", "Locutor 2", ... baseado na ordem de aparição
 * de cada speakerId único. Nunca usa nomes de vereadores.
 */
function assignLocutorNames(blocks: SpeakerBlock[]): SpeakerBlock[] {
  const idToNumber: Record<string, number> = {};
  let nextNumber = 1;

  for (const block of blocks) {
    if (!(block.speakerId in idToNumber)) {
      idToNumber[block.speakerId] = nextNumber++;
    }
    const n = idToNumber[block.speakerId];
    block.speaker = `Locutor ${n}`;
    block.speakerColor = SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length];
  }

  return blocks;
}

// ══════════════════════════════════════════════════════════
// Detecção heurística de nome por MENÇÃO EXPLÍCITA
//
// Em sessão plenária é padrão anunciar quem recebe a palavra:
//   "Concedo a palavra ao vereador João da Silva"
//   "Com a palavra a vereadora Maria Souza"
//   "Convido o nobre colega Pedro Lima"
//
// Estratégia: quando um bloco contém essa fórmula, o NOME capturado é
// atribuído ao PRÓXIMO bloco (próxima troca de speakerId), não ao bloco
// que faz a menção. Adicionalmente, quem concede a palavra duas ou mais
// vezes é rotulado como "Presidente" — heurística típica de plenário.
//
// É BEST-EFFORT: erra pra NÃO rotular quando em dúvida. Usuária corrige
// pela canetinha ao lado do nome. Nomes manuais preexistentes são
// preservados por renameAllLocutors() em block-edit.ts.
// ══════════════════════════════════════════════════════════

const NAME_TOKEN = "[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõçA-ZÁÉÍÓÚÂÊÔÃÕÇ']+";
// Até 4 palavras de nome próprio, com conectivos opcionais (da, do, de, das, dos)
const FULL_NAME = `${NAME_TOKEN}(?:\\s+(?:da|do|de|das|dos)\\s+${NAME_TOKEN}|\\s+${NAME_TOKEN}){0,3}`;

// Âncoras de título parlamentar (case insensitive)
const TITLE = "(?:vereador(?:a)?|nobre\\s+colega|colega|senhor(?:a)?|sr\\.?a?\\.?|dr\\.?a?\\.?|deputad[oa]|excelent[íi]ssimo(?:a)?)";

// Padrões que indicam concessão/atribuição de palavra a alguém
// O grupo 1 captura o nome próprio subsequente.
const MENTION_PATTERNS: RegExp[] = [
  // "concedo/passo/dou/repasso/transfiro a palavra ao(à) [vereador] Nome"
  new RegExp(
    `(?:[Cc]oncedo|[Pp]asso|[Dd]ou|[Rr]epasso|[Tt]ransfiro)\\s+(?:a\\s+)?palavra\\s+(?:ao|à|para\\s+(?:o|a))\\s+(?:${TITLE}\\s+)?(${FULL_NAME})`,
  ),
  // "com a palavra o(a) [vereador] Nome" / "com a palavra, [vereador] Nome"
  new RegExp(
    `[Cc]om\\s+a\\s+palavra[,]?\\s+(?:o|a)\\s+(?:${TITLE}\\s+)?(${FULL_NAME})`,
  ),
  // "tem a palavra o(a) [vereador] Nome"
  new RegExp(
    `[Tt]em\\s+a\\s+palavra[,]?\\s+(?:o|a)\\s+(?:${TITLE}\\s+)?(${FULL_NAME})`,
  ),
  // "convido o(a) [vereador] Nome"
  new RegExp(
    `[Cc]onvido\\s+(?:o|a)\\s+(?:${TITLE}\\s+)?(${FULL_NAME})`,
  ),
  // "chamo o(a) [vereador] Nome"
  new RegExp(
    `[Cc]hamo\\s+(?:o|a)\\s+(?:${TITLE}\\s+)?(${FULL_NAME})`,
  ),
  // "palavra franqueada ao(à) [vereador] Nome"
  new RegExp(
    `palavra\\s+franqueada\\s+(?:ao|à)\\s+(?:${TITLE}\\s+)?(${FULL_NAME})`,
  ),
];

// Padrões que indicam APENAS que o bloco atual está concedendo a palavra
// (usado para identificar o Presidente, independentemente de capturar o nome)
const GRANT_PATTERNS: RegExp[] = [
  /(?:[Cc]oncedo|[Pp]asso|[Dd]ou|[Rr]epasso|[Tt]ransfiro)\s+(?:a\s+)?palavra/,
  /[Tt]em\s+a\s+palavra/,
  /[Cc]om\s+a\s+palavra/,
  /palavra\s+franqueada/,
];

// Palavras que nunca devem ser tratadas como nome próprio, mesmo capitalizadas
const NAME_BLOCKLIST = new Set([
  'Câmara', 'Casa', 'Plenário', 'Mesa', 'Regimento', 'Projeto', 'Lei',
  'Presidente', 'Presidência', 'Secretaria', 'Ordem', 'Brasil', 'Município',
  'Vereador', 'Vereadora', 'Senhor', 'Senhora', 'Nobre', 'Colega',
]);

function cleanCapturedName(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[.,;:!?]+$/, '');
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/);
  // Rejeita se a primeira palavra está na blocklist (provável falso positivo)
  if (NAME_BLOCKLIST.has(parts[0])) return null;
  // Exige pelo menos 1 palavra com inicial maiúscula (redundante, mas seguro)
  if (!/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(parts[0])) return null;
  // Limita a 4 palavras para evitar capturar o resto da frase
  return parts.slice(0, 4).join(' ');
}

function detectSpeakerNamesByMention(blocks: SpeakerBlock[]): SpeakerBlock[] {
  if (blocks.length < 2) return blocks;

  // speakerId → nome detectado (primeira detecção vence)
  const detected = new Map<string, string>();
  // speakerId → quantas vezes concedeu a palavra
  const grantCounts = new Map<string, number>();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = block.text || '';

    // Conta se este bloco concedeu a palavra (para detectar Presidente)
    const didGrant = GRANT_PATTERNS.some(p => p.test(text));
    if (didGrant) {
      grantCounts.set(block.speakerId, (grantCounts.get(block.speakerId) || 0) + 1);
    }

    // Tenta capturar o nome do próximo locutor (só se houver próximo)
    if (i >= blocks.length - 1) continue;
    const nextBlock = blocks[i + 1];
    if (nextBlock.speakerId === block.speakerId) continue;
    if (detected.has(nextBlock.speakerId)) continue;

    for (const pattern of MENTION_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = cleanCapturedName(match[1]);
        if (name) {
          detected.set(nextBlock.speakerId, name);
          break;
        }
      }
    }
  }

  // Heurística do Presidente: quem mais concedeu a palavra (mínimo 2x)
  // e que ainda não tem nome detectado.
  if (grantCounts.size > 0) {
    const sorted = [...grantCounts.entries()].sort((a, b) => b[1] - a[1]);
    const [presId, count] = sorted[0];
    if (count >= 2 && !detected.has(presId)) {
      detected.set(presId, 'Presidente');
    }
  }

  if (detected.size === 0) return blocks;

  // Aplica nomes detectados, evitando colisões (dois speakerIds diferentes
  // não podem receber o mesmo nome — se acontecer, só o primeiro fica).
  const usedNames = new Set<string>();
  return blocks.map(b => {
    const name = detected.get(b.speakerId);
    if (!name) return b;
    if (usedNames.has(name) && b.speaker && b.speaker !== name) {
      // Já usado por outro speakerId; mantém "Locutor N"
      return b;
    }
    usedNames.add(name);
    return { ...b, speaker: name };
  });
}
