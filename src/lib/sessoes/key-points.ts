// ══════════════════════════════════════════════════════════
// Key Points Detector — Portado de CyaVox keyPointsDetector.js
// Adaptado com keywords legislativas da CMBV
// ══════════════════════════════════════════════════════════

import type { SpeakerBlock } from './speaker-detector';

export interface KeyPoint {
  id: string;
  segmentId: number;
  start: number;
  end: number;
  title: string;
  description: string;
  score: number;
  reasons: string[];
}

const TOPIC_INDICATORS = [
  // Legislativo
  'requerimento', 'votação', 'aprovado', 'rejeitado', 'emenda', 'parecer',
  'ordem do dia', 'expediente', 'tribuna', 'projeto de lei', 'indicação',
  'comissão', 'plenário', 'discussão', 'primeira discussão', 'segunda discussão',
  'matéria', 'proposição', 'voto', 'favorável', 'contrário',
  'senhor presidente', 'senhora presidente', 'nobre vereador', 'nobre vereadora',
  // Genérico
  'então', 'portanto', 'agora', 'primeiro', 'segundo', 'terceiro',
  'importante', 'conclusão', 'resumindo', 'outro ponto', 'além disso',
  'por outro lado', 'em relação', 'a questão é', 'o problema é',
];

function generateTitle(text: string): string {
  const clean = text.replace(/###/g, '').trim();
  const firstSentence = clean.split(/[.!?]/)[0]?.trim() || clean;
  if (firstSentence.length <= 60) return firstSentence;
  return firstSentence.substring(0, 57) + '...';
}

export function detectKeyPoints(segments: SpeakerBlock[]): KeyPoint[] {
  if (!segments || segments.length === 0) return [];

  const keyPoints: KeyPoint[] = [];
  const avgLength = segments.reduce((sum, s) => sum + s.text.length, 0) / segments.length;

  segments.forEach((segment, idx) => {
    let score = 0;
    const reasons: string[] = [];

    if (idx > 0) {
      const pause = segment.start - segments[idx - 1].end;
      if (pause > 3) { score += 3; reasons.push('pausa longa'); }
      else if (pause > 1.5) score += 1;
    }

    if (idx === 0) { score += 4; reasons.push('início da sessão'); }

    if (segment.text.length > avgLength * 1.8) { score += 2; reasons.push('fala extensa'); }

    const textLower = segment.text.toLowerCase();
    for (const indicator of TOPIC_INDICATORS) {
      if (textLower.includes(indicator)) { score += 2; reasons.push(`tema: ${indicator}`); break; }
    }

    if (segment.text.includes('?')) { score += 1; reasons.push('pergunta'); }

    if (score >= 3) {
      keyPoints.push({
        id: `kp-${idx}`,
        segmentId: segment.id,
        start: segment.start,
        end: segment.end,
        title: generateTitle(segment.text),
        description: segment.text.substring(0, 150),
        score,
        reasons,
      });
    }
  });

  if (keyPoints.length < 3 && segments.length > 10) {
    const sectionSize = Math.ceil(segments.length / 5);
    return segments
      .filter((_, i) => i % sectionSize === 0)
      .slice(0, 8)
      .map((seg, i) => ({
        id: `kp-${i}`, segmentId: seg.id, start: seg.start, end: seg.end,
        title: generateTitle(seg.text), description: seg.text.substring(0, 150),
        score: 2, reasons: ['seção automática'],
      }));
  }

  if (keyPoints.length > 15) {
    keyPoints.sort((a, b) => b.score - a.score);
    return keyPoints.slice(0, 15).sort((a, b) => a.start - b.start);
  }

  return keyPoints;
}
