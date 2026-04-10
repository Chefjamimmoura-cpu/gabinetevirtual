// src/lib/alia/proactive/watcher.interface.ts
// Interface for all proactive watchers + event types.

export type EventType =
  | 'prazo_vencendo'
  | 'materia_nova'
  | 'email_urgente'
  | 'aniversario'
  | 'autoridade_mudou'
  | 'indicacao_parada'
  | 'sessao_amanha'
  | 'ordem_dia_publicada'
  | 'oficio_sem_resposta'
  | 'comissao_pendencia'
  | 'votacao_divergente'
  | 'email_digest'
  | 'indicacao_protocolar'
  | 'cadin_curadoria';

export type Urgency = 'critica' | 'alta' | 'media' | 'baixa' | 'informativa';

export interface ProactiveEvent {
  id: string;
  type: EventType;
  urgency: Urgency;
  title: string;
  detail: string;
  module: string;
  related_entities?: {
    person_ids?: string[];
    materia_ids?: string[];
    indicacao_ids?: string[];
  };
  action_url?: string;
  detected_at: string;
}

export interface Watcher {
  name: string;
  schedule: string; // cron expression
  check(gabineteId: string): Promise<ProactiveEvent[]>;
}
