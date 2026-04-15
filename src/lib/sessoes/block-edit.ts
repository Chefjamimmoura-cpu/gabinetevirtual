// ══════════════════════════════════════════════════════════
// Block Edit Utilities — operações de split/merge/rename em blocos de transcrição
// Usadas pelo frontend (CTRL+Click, ALT+Click, SHIFT+Click)
// ══════════════════════════════════════════════════════════

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
  speaker: string;
  speakerId: string;
  speakerColor: string;
  isUnclear: boolean;
  segmentIds?: number[];
  words?: TranscriptWord[];
}

// Paleta de cores (mesma do speaker-detector)
const SPEAKER_COLORS = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
  '#fb923c', '#2dd4bf', '#e879f9', '#84cc16', '#f87171',
  '#38bdf8', '#c084fc', '#4ade80', '#facc15', '#fb7185',
  '#22d3ee', '#818cf8', '#65a30d', '#ea580c', '#db2777',
];

/**
 * Gera próximo speakerId único não usado nos blocos.
 */
function nextSpeakerId(blocks: SpeakerBlock[]): string {
  const usados = new Set(blocks.map(b => b.speakerId));
  let n = 1;
  while (usados.has(`spk_${n}`)) n++;
  return `spk_${n}`;
}

/**
 * Divide um bloco em dois a partir do índice de palavra (inclusive = início do 2º bloco).
 * A segunda parte recebe um NOVO speakerId (locutor diferente).
 *
 * Exemplo: bloco "A B C D E" com wordIdx=2 → ["A B", "C D E"]
 */
export function splitBlock(
  blocks: SpeakerBlock[],
  blockIdx: number,
  wordIdx: number,
): SpeakerBlock[] {
  const block = blocks[blockIdx];
  if (!block || !block.words || block.words.length === 0) return blocks;
  if (wordIdx < 0 || wordIdx >= block.words.length) return blocks;

  // wordIdx === 0: promove o bloco inteiro a novo locutor (não há o que dividir antes)
  if (wordIdx === 0) {
    const newSpeakerId = nextSpeakerId(blocks);
    const promoted: SpeakerBlock = {
      ...block,
      speakerId: newSpeakerId,
      speaker: '',
      speakerColor: '',
    };
    const result = [
      ...blocks.slice(0, blockIdx),
      promoted,
      ...blocks.slice(blockIdx + 1),
    ];
    return renameAllLocutors(result);
  }

  const wordsBefore = block.words.slice(0, wordIdx);
  const wordsAfter = block.words.slice(wordIdx);

  if (wordsBefore.length === 0 || wordsAfter.length === 0) return blocks;

  const textBefore = wordsBefore.map(w => w.word).join(' ').trim();
  const textAfter = wordsAfter.map(w => w.word).join(' ').trim();

  const newSpeakerId = nextSpeakerId(blocks);

  const blockBefore: SpeakerBlock = {
    ...block,
    end: wordsBefore[wordsBefore.length - 1].end,
    text: textBefore,
    words: wordsBefore,
  };

  const blockAfter: SpeakerBlock = {
    ...block,
    id: block.id + 0.5, // temporário, será reindexado
    start: wordsAfter[0].start,
    end: wordsAfter[wordsAfter.length - 1].end,
    text: textAfter,
    words: wordsAfter,
    speakerId: newSpeakerId,
    speaker: '', // será reatribuído
    speakerColor: '',
  };

  const result = [
    ...blocks.slice(0, blockIdx),
    blockBefore,
    blockAfter,
    ...blocks.slice(blockIdx + 1),
  ];

  return renameAllLocutors(reindexBlocks(result));
}

/**
 * Junta um bloco com o ANTERIOR, forçando o mesmo speakerId do anterior.
 */
export function mergeWithPrevious(
  blocks: SpeakerBlock[],
  blockIdx: number,
): SpeakerBlock[] {
  if (blockIdx <= 0 || blockIdx >= blocks.length) return blocks;

  const prev = blocks[blockIdx - 1];
  const curr = blocks[blockIdx];

  const merged: SpeakerBlock = {
    ...prev,
    end: curr.end,
    text: (prev.text + ' ' + curr.text).trim(),
    words: [...(prev.words || []), ...(curr.words || [])],
    isUnclear: prev.isUnclear || curr.isUnclear,
    segmentIds: [...(prev.segmentIds || []), ...(curr.segmentIds || [])],
  };

  const result = [
    ...blocks.slice(0, blockIdx - 1),
    merged,
    ...blocks.slice(blockIdx + 1),
  ];

  return renameAllLocutors(reindexBlocks(result));
}

/**
 * Mescla um locutor em outro: todos os blocos que tinham `sourceId`
 * passam a ter `targetId`. Reindexa nomes via renameAllLocutors
 * (que preserva nomes próprios do target).
 */
export function mergeLocutors(
  blocks: SpeakerBlock[],
  sourceId: string,
  targetId: string,
): SpeakerBlock[] {
  if (!sourceId || !targetId || sourceId === targetId) return blocks;

  const result = blocks.map(b => {
    if (b.speakerId === sourceId) {
      return { ...b, speakerId: targetId, speaker: '', speakerColor: '' };
    }
    return b;
  });

  return renameAllLocutors(result);
}

/**
 * Renomeia um locutor: aplica o novo nome a TODOS os blocos do mesmo speakerId.
 * Se novoNome começar com "Locutor " remove o override (volta pro auto).
 */
export function renameLocutor(
  blocks: SpeakerBlock[],
  speakerId: string,
  novoNome: string,
): SpeakerBlock[] {
  const nome = novoNome.trim();
  if (!nome) return blocks;

  return blocks.map(b => {
    if (b.speakerId === speakerId) {
      return { ...b, speaker: nome };
    }
    return b;
  });
}

/**
 * Reindexa IDs sequenciais após split/merge.
 */
function reindexBlocks(blocks: SpeakerBlock[]): SpeakerBlock[] {
  return blocks.map((b, i) => ({ ...b, id: i }));
}

/**
 * Atribui "Locutor 1", "Locutor 2", ... preservando nomes manuais que não são "Locutor N".
 * Isso preserva renames feitos pelo usuário (ex: "Carol Dantas").
 */
function renameAllLocutors(blocks: SpeakerBlock[]): SpeakerBlock[] {
  // Mapa: speakerId → nome atual (preserva manuais)
  const idToName = new Map<string, string>();
  for (const b of blocks) {
    if (!idToName.has(b.speakerId) && b.speaker && !b.speaker.match(/^Locutor \d+$/)) {
      idToName.set(b.speakerId, b.speaker);
    }
  }

  // Atribuir números sequenciais apenas aos que não têm nome manual
  const idToNumber = new Map<string, number>();
  let nextN = 1;
  for (const b of blocks) {
    if (idToName.has(b.speakerId)) continue;
    if (!idToNumber.has(b.speakerId)) {
      idToNumber.set(b.speakerId, nextN++);
    }
  }

  return blocks.map(b => {
    const manualName = idToName.get(b.speakerId);
    if (manualName) {
      return { ...b, speaker: manualName, speakerColor: colorForId(b.speakerId, idToNumber) };
    }
    const n = idToNumber.get(b.speakerId) || 1;
    return {
      ...b,
      speaker: `Locutor ${n}`,
      speakerColor: SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length],
    };
  });
}

function colorForId(speakerId: string, idToNumber: Map<string, number>): string {
  // Se for nome manual, cor baseada em hash do speakerId
  if (idToNumber.has(speakerId)) {
    const n = idToNumber.get(speakerId)!;
    return SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length];
  }
  // Hash simples para nomes manuais
  let hash = 0;
  for (let i = 0; i < speakerId.length; i++) {
    hash = ((hash << 5) - hash) + speakerId.charCodeAt(i);
    hash |= 0;
  }
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}
