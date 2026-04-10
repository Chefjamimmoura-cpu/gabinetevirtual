// src/lib/alia/proactive/watchers/email-watcher.ts
// Detecta e-mails com urgência 'critica' ainda não tratados.

import { createClient } from '@supabase/supabase-js';
import type { Watcher, ProactiveEvent } from '../watcher.interface';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface EmailIntelligence {
  id: string;
  subject: string;
  sender_name: string | null;
  sender_email: string | null;
  received_at: string;
  summary: string | null;
}

export const emailWatcher: Watcher = {
  name: 'email',
  schedule: '*/30 * * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const supabase = db();

      const { data, error } = await supabase
        .from('email_intelligence')
        .select('id, subject, sender_name, sender_email, received_at, summary')
        .eq('gabinete_id', gabineteId)
        .eq('urgency', 'critica')
        .eq('actioned', false)
        .order('received_at', { ascending: false })
        .limit(20);

      if (error || !data) return events;

      for (const email of data as EmailIntelligence[]) {
        const remetente = email.sender_name || email.sender_email || 'remetente desconhecido';
        events.push({
          id: crypto.randomUUID(),
          type: 'email_urgente',
          urgency: 'critica',
          title: `E-mail urgente não tratado: ${email.subject}`,
          detail: `E-mail de ${remetente} com classificação CRÍTICA aguardando ação.${email.summary ? ` Resumo: ${email.summary}` : ''}`,
          module: 'email',
          action_url: `/email/${email.id}`,
          detected_at: new Date().toISOString(),
        });
      }
    } catch {
      // watcher nunca deve lançar erro
    }

    return events;
  },
};
