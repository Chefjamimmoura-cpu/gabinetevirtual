// src/lib/alia/document-renderer.ts
// Renders GeneratedDocument in 3 modes: executive, standard, analytical.
// The document is always generated in full (analytical); modes filter visibility.

import type {
  GeneratedDocument,
  RenderedDocument,
  RenderMode,
  DocumentSection,
  DocumentSource,
  Visibility,
} from './types';

// ── Visibility Rules ─────────────────────────────────────────────────────────
// executive: visible in ALL modes
// standard:  visible in standard + analytical
// analytical: visible ONLY in analytical

function isVisible(itemVisibility: Visibility, mode: RenderMode): boolean {
  if (mode === 'analytical') return true;
  if (mode === 'standard') return itemVisibility !== 'analytical';
  return itemVisibility === 'executive';
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderDocument(
  doc: GeneratedDocument,
  mode: RenderMode,
): RenderedDocument {
  const visibleSections = doc.sections.filter((s) => isVisible(s.visibility, mode));

  const renderedSections = visibleSections.map((s) => ({
    title: s.title,
    content: s.content,
  }));

  const sources = collectSources(visibleSections, mode);

  return {
    mode,
    title: buildTitle(doc, mode),
    sections: renderedSections,
    sources,
    executive_summary: doc.executive_summary,
    word_count: countWords(visibleSections),
  };
}

// ── Title Builder ────────────────────────────────────────────────────────────

const MODE_LABELS: Record<RenderMode, string> = {
  executive: 'RESUMO DECISÓRIO',
  standard: '',
  analytical: 'ANÁLISE COMPLETA',
};

const TIPO_LABELS: Record<string, string> = {
  parecer: 'PARECER',
  parecer_relator: 'PARECER DO RELATOR',
  oficio: 'OFÍCIO',
  indicacao: 'INDICAÇÃO',
  pls: 'PROJETO DE LEI',
  relatorio_comissao: 'RELATÓRIO DE COMISSÃO',
};

function buildTitle(doc: GeneratedDocument, mode: RenderMode): string {
  const tipoLabel = TIPO_LABELS[doc.tipo] ?? doc.tipo.toUpperCase();
  const modeLabel = MODE_LABELS[mode];
  const ref = doc.materia_ref ? ` — ${doc.materia_ref}` : '';

  if (modeLabel) {
    return `${modeLabel} | ${tipoLabel}${ref}`;
  }
  return `${tipoLabel}${ref}`;
}

// ── Source Collection ─────────────────────────────────────────────────────────

function collectSources(sections: DocumentSection[], mode: RenderMode): string[] {
  const allSources: DocumentSource[] = [];

  for (const section of sections) {
    if (!section.sources) continue;
    for (const src of section.sources) {
      if (isVisible(src.visibility, mode)) {
        allSources.push(src);
      }
    }
  }

  const seen = new Set<string>();
  const unique: DocumentSource[] = [];
  for (const src of allSources) {
    if (seen.has(src.citation)) continue;
    seen.add(src.citation);
    unique.push(src);
  }

  if (mode === 'analytical') {
    return unique.map(
      (src, i) => `[${i + 1}] ${src.full_reference}${src.url ? `\n    ${src.url}` : ''}`,
    );
  }

  if (mode === 'standard') {
    return unique.map((src) => src.citation);
  }

  return unique.map((src) => src.citation);
}

// ── Word Count ───────────────────────────────────────────────────────────────

function countWords(sections: DocumentSection[]): number {
  return sections.reduce(
    (total, s) => total + s.content.split(/\s+/).filter(Boolean).length,
    0,
  );
}

// ── Parse Mode Markers from AI Output ────────────────────────────────────────

export function parseMarkedDocument(
  raw: string,
  meta: {
    id: string;
    tipo: GeneratedDocument['tipo'];
    materia_ref?: string;
    modelo_usado: string;
  },
): GeneratedDocument {
  const sections: DocumentSection[] = [];
  let executiveSummary = '';

  const parts = raw.split(/^(#{2,3}\s+.+)$/m);

  let currentTitle = '';
  let sectionIndex = 0;

  for (const part of parts) {
    const headerMatch = part.match(/^#{2,3}\s+(.+)$/);
    if (headerMatch) {
      currentTitle = headerMatch[1].trim();
      continue;
    }

    const content = part.trim();
    if (!content || !currentTitle) continue;

    const visibility = detectVisibility(currentTitle, content);

    const cleanContent = content
      .replace(/\[EXEC\]\s*/g, '')
      .replace(/\[STD\]\s*/g, '')
      .replace(/\[ANA\]\s*/g, '')
      .trim();

    const cleanTitle = currentTitle
      .replace(/\[EXEC\]\s*/g, '')
      .replace(/\[STD\]\s*/g, '')
      .replace(/\[ANA\]\s*/g, '')
      .trim();

    const { text, sources } = extractSources(cleanContent);

    if (visibility === 'executive' && sectionIndex === 0) {
      executiveSummary = text;
    }

    sections.push({
      id: `section-${sectionIndex++}`,
      title: cleanTitle,
      content: text,
      visibility,
      sources: sources.length > 0 ? sources : undefined,
    });
  }

  return {
    id: meta.id,
    tipo: meta.tipo,
    materia_ref: meta.materia_ref,
    gerado_em: new Date().toISOString(),
    modelo_usado: meta.modelo_usado,
    sections,
    executive_summary: executiveSummary || sections[0]?.content.slice(0, 300) || '',
  };
}

function detectVisibility(title: string, content: string): Visibility {
  const combined = `${title} ${content.slice(0, 100)}`;
  if (combined.includes('[EXEC]')) return 'executive';
  if (combined.includes('[ANA]')) return 'analytical';
  if (combined.includes('[STD]')) return 'standard';
  return 'standard';
}

function extractSources(content: string): { text: string; sources: DocumentSource[] } {
  const sources: DocumentSource[] = [];
  const srcPattern = /\[(EXEC|STD|ANA)-SRC\]\s*(.+?)(?:\n|$)/g;
  let match;

  while ((match = srcPattern.exec(content)) !== null) {
    const visMap: Record<string, Visibility> = {
      EXEC: 'executive',
      STD: 'standard',
      ANA: 'analytical',
    };
    const parts = match[2].split('|').map((s) => s.trim());
    sources.push({
      type: 'legislacao',
      citation: parts[0] || '',
      full_reference: parts[1] || parts[0] || '',
      url: parts[2] || undefined,
      visibility: visMap[match[1]] || 'standard',
    });
  }

  const text = content.replace(srcPattern, '').trim();

  return { text, sources };
}
