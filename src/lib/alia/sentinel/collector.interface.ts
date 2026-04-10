// src/lib/alia/sentinel/collector.interface.ts

export interface DiarioEntry {
  source: string;        // 'doerr' | 'dombv' | 'dou' | 'dje' | 'tse'
  date: string;          // publication date ISO
  rawText: string;       // extracted text
  url: string;           // original link
  section?: string;      // section of the gazette (nomeações, exonerações, etc.)
}

export interface DiarioCollector {
  source: string;
  fetchLatest(date?: Date): Promise<DiarioEntry[]>;
}
