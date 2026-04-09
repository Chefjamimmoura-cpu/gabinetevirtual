// src/lib/alia/types.ts
// Shared types for the ALIA Core Engine.
// Every module in src/lib/alia/ imports from here — no circular deps.

// ── Agent Types ──────────────────────────────────────────────────────────────

export type AgentType =
  | 'cadin'
  | 'parecer'
  | 'relator'
  | 'indicacao'
  | 'oficio'
  | 'pls'
  | 'agenda'
  | 'email'
  | 'sessao'
  | 'ordem_dia'
  | 'comissao'
  | 'general'
  | 'crossmodule';

export type ChannelType = 'whatsapp' | 'dashboard' | 'email' | 'cron' | 'api';

// ── Memory ───────────────────────────────────────────────────────────────────

export type MemoryType = 'preference' | 'decision' | 'relation' | 'pattern';

export interface AliaMemory {
  id: string;
  gabinete_id: string;
  tipo: MemoryType;
  subject: string;
  content: string;
  confidence: number;
  source_module: string | null;
  source_ref: string | null;
  expires_at: string | null;
  last_accessed_at: string;
  created_at: string;
  updated_at: string;
}

export interface RememberOptions {
  sourceModule?: string;
  sourceRef?: string;
  expiresAt?: string;
  confidence?: number;
}

// ── Gabinete Config (multi-tenant) ───────────────────────────────────────────

export interface GabineteConfig {
  parlamentar_nome: string;
  casa_legislativa: string;
  sigla_casa: string;
  partido: string;
  alia_nome?: string;
  alia_tom?: 'formal' | 'equilibrado' | 'informal';
  alia_assinatura_email?: string;
  comissoes_membro: string[];
  comissao_presidente?: string;
}

// ── Document Rendering ───────────────────────────────────────────────────────

export type RenderMode = 'executive' | 'standard' | 'analytical';

export type Visibility = 'executive' | 'standard' | 'analytical';

export type SourceType =
  | 'legislacao'
  | 'jurisprudencia'
  | 'sumula'
  | 'sapl'
  | 'doutrina'
  | 'cadin';

export interface DocumentSource {
  type: SourceType;
  citation: string;
  full_reference: string;
  url?: string;
  visibility: Visibility;
}

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  visibility: Visibility;
  sources?: DocumentSource[];
}

export interface GeneratedDocument {
  id: string;
  tipo: 'parecer' | 'parecer_relator' | 'oficio' | 'indicacao' | 'pls' | 'relatorio_comissao';
  materia_ref?: string;
  gerado_em: string;
  modelo_usado: string;
  sections: DocumentSection[];
  executive_summary: string;
}

export interface RenderedDocument {
  mode: RenderMode;
  title: string;
  sections: Array<{ title: string; content: string }>;
  sources: string[];
  executive_summary: string;
  word_count: number;
}
