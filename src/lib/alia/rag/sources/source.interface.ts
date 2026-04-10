// src/lib/alia/rag/sources/source.interface.ts

import type { LegalDocument, TipoNorma } from '../legal-types';

export interface LegalSource {
  name: string;
  baseUrl: string;

  fetchByTheme(theme: string, opts?: { since?: Date; limit?: number }): Promise<LegalDocument[]>;

  fetchNorma(tipo: TipoNorma, numero: string, ano: number): Promise<LegalDocument | null>;
}
