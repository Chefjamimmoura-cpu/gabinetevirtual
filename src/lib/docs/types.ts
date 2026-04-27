// DocFormatter — tipos canônicos para descrição de documentos legislativos
// Usado pelo Disclaimer Registry e pela página de assinaturas dedicada.

export type DocumentKind =
  | 'parecer_comissao'
  | 'ata_comissao'
  | 'parecer_relatoria'
  | 'pll'
  | 'pdl'
  | 'requerimento_urgencia'
  | 'indicacao'
  | 'oficio'
  | 'generico';

export interface DisclaimerContext {
  kind: DocumentKind;
  comissao?: { nome: string; sigla: string };
  materia?: { tipo_sigla: string; numero: number | string; ano: number | string };
  autor?: string;
  data?: string;
  descricaoOverride?: string;
}
