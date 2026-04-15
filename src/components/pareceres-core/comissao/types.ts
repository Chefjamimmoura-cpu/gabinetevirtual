export interface MateriaFila {
  id: number;
  tipo_sigla: string;
  numero: number;
  ano: number;
  ementa: string;
  autores: string;
  status_relatoria: 'sem_rascunho' | 'rascunho_gerado';
  rascunho_voto: string | null;
  rascunho_em: string | null;
  ultima_tramitacao: string;
  status_tramitacao?: string;
  data_tramitacao?: string;
  sapl_url: string;
}

export interface ComissaoConfig {
  sigla: string;
  nome: string;
  area?: string;
  criterios?: string;
  keywords?: string[];
  artigoRegimento?: string;
  link_lei?: string;
  sapl_unit_id?: number | null;
  sapl_comissao_id?: number;
  meu_cargo?: string;
  comissao_uuid?: string | null;
}

export interface ComissaoMembro {
  nome: string;
  cargo: string;
}

export interface ParecerResult {
  texto: string;
  voto: string;
}

export interface Reuniao {
  id: number;
  data_sessao: string;
  commission_sigla: string;
  materia_ids: number[];
  total_materias: number;
  pareceres_gerados: number;
}
