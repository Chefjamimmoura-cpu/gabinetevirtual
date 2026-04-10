// src/lib/alia/rag/legal-types.ts

export type TipoNorma =
  | 'constituicao' | 'lei' | 'lc' | 'lei_ordinaria' | 'lei_organica'
  | 'decreto' | 'resolucao' | 'portaria' | 'regimento'
  | 'sumula' | 'sumula_vinculante' | 'acordao' | 'tema_repetitivo'
  | 'loa' | 'ldo' | 'ppa' | 'lrf';

export type Esfera = 'federal' | 'estadual' | 'municipal' | 'judiciario';

export type Tribunal = 'stf' | 'stj' | 'tjrr' | 'tse' | 'tcu' | 'tcerr';

export interface LegalDocument {
  tipo_norma: TipoNorma;
  numero: string;
  ano: number;
  esfera: Esfera;
  ementa: string;
  texto_integral: string;
  fonte_url: string;
  data_publicacao: string;
  situacao: 'vigente' | 'revogada' | 'parcialmente_revogada';
  tribunal?: Tribunal;
  relator?: string;
}

export interface LegalChunk {
  documento: string;
  tipo_norma: TipoNorma;
  hierarquia: string;
  artigo: string;
  dispositivo_completo: string;
  texto: string;
  tema_principal: string;
  temas_secundarios: string[];
  palavras_chave: string[];
  artigos_relacionados: string[];
  vigente: boolean;
  tribunal?: Tribunal;
  esfera: Esfera;
  fonte_url: string;
}
