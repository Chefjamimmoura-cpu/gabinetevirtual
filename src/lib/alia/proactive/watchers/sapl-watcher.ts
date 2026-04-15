// src/lib/alia/proactive/watchers/sapl-watcher.ts
// Verifica o SAPL por novas matérias e publicação de Ordem do Dia.

import { createClient } from '@supabase/supabase-js';
import type { Watcher, ProactiveEvent } from '../watcher.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://gabinete.wonetechnology.cloud';

// ── Supabase client ───────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface SaplMateria {
  id: string;
  tipo: string;
  numero: string;
  ano: number;
  ementa: string;
}

interface SaplOrdemDiaItem {
  tipo: string; // e.g. 'PLL', 'REQ', 'PLE'
}

interface SaplOrdemDiaMateria {
  id?: string | number;
  tipo?: string;
  numero?: string | number;
  ano?: number;
}

interface SaplOrdemDia {
  id: string;
  sessao_data: string;
  sessao_tipo: string;
  publicado_em: string;
  itens?: SaplOrdemDiaItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Trunca o texto para no máximo `max` caracteres, adicionando "…" se necessário.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/**
 * Gera resumo de matérias por tipo: "5 matérias (2 PLL, 2 REQ, 1 PLE)"
 * Se não houver itens, retorna string com total genérico.
 */
function resumoItens(itens: SaplOrdemDiaItem[]): string {
  if (itens.length === 0) return 'sem matérias registradas';

  const contagem: Record<string, number> = {};
  for (const item of itens) {
    const tipo = (item.tipo ?? 'Outros').toUpperCase();
    contagem[tipo] = (contagem[tipo] ?? 0) + 1;
  }

  const total = itens.length;
  const detalhes = Object.entries(contagem)
    .sort((a, b) => b[1] - a[1])
    .map(([tipo, qtd]) => `${qtd} ${tipo}`)
    .join(', ');

  return `${total} matéria${total !== 1 ? 's' : ''} (${detalhes})`;
}

// ── Config flags ──────────────────────────────────────────────────────────────

interface AliaConfig {
  notify_ordem_dia: boolean;
  notify_materia_comissao: boolean;
  auto_parecer_on_ordem_dia: boolean;
  parecer_model: string;
}

async function loadAliaConfig(gabineteId: string): Promise<AliaConfig> {
  const defaults: AliaConfig = {
    notify_ordem_dia: true,
    notify_materia_comissao: true,
    auto_parecer_on_ordem_dia: false,
    parecer_model: 'gemini-2.0-flash',
  };

  try {
    const { data, error } = await db()
      .from('gabinete_alia_config')
      .select('notify_ordem_dia, notify_materia_comissao, auto_parecer_on_ordem_dia, parecer_model')
      .eq('gabinete_id', gabineteId)
      .maybeSingle();

    if (error || !data) return defaults;

    return {
      notify_ordem_dia:           data.notify_ordem_dia           ?? defaults.notify_ordem_dia,
      notify_materia_comissao:    data.notify_materia_comissao    ?? defaults.notify_materia_comissao,
      auto_parecer_on_ordem_dia:  data.auto_parecer_on_ordem_dia  ?? defaults.auto_parecer_on_ordem_dia,
      parecer_model:              (data.parecer_model as string | undefined) ?? defaults.parecer_model,
    };
  } catch {
    return defaults;
  }
}

// ── Watcher ───────────────────────────────────────────────────────────────────

export const saplWatcher: Watcher = {
  name: 'sapl',
  // A cada 2 horas no horário de expediente (8h–18h), dias de semana
  schedule: '0 8-18/2 * * *',

  async check(gabineteId: string): Promise<ProactiveEvent[]> {
    const events: ProactiveEvent[] = [];

    try {
      const config = await loadAliaConfig(gabineteId);

      // ── Novas matérias ─────────────────────────────────────────────────────
      if (config.notify_materia_comissao) {
        const materiasRes = await fetch(
          `${INTERNAL_BASE}/api/sapl/materias-recentes?gabineteId=${encodeURIComponent(gabineteId)}&horasAtras=2`,
          { headers: { 'x-internal-call': '1' } },
        );

        if (materiasRes.ok) {
          const materias: SaplMateria[] = await materiasRes.json();

          for (const m of materias) {
            const ementaTruncada = truncate(m.ementa ?? '', 120);
            events.push({
              id: crypto.randomUUID(),
              type: 'materia_nova',
              urgency: 'informativa',
              title: `Nova matéria no SAPL: ${m.tipo} ${m.numero}/${m.ano}`,
              detail: `${m.tipo} nº ${m.numero}/${m.ano}\n${ementaTruncada}`,
              module: 'sapl',
              related_entities: { materia_ids: [String(m.id)] },
              action_url: `${APP_URL}/pareceres/materias/${m.id}`,
              detected_at: new Date().toISOString(),
            });
          }
        }
      }

      // ── Ordem do Dia ───────────────────────────────────────────────────────
      if (config.notify_ordem_dia) {
        const ordemRes = await fetch(
          `${INTERNAL_BASE}/api/sapl/ordem-dia-recente?gabineteId=${encodeURIComponent(gabineteId)}&horasAtras=2`,
          { headers: { 'x-internal-call': '1' } },
        );

        if (ordemRes.ok) {
          const ordens: SaplOrdemDia[] = await ordemRes.json();

          for (const ordem of ordens) {
            const dataFormatada = new Date(ordem.sessao_data).toLocaleDateString('pt-BR');
            const resumo = resumoItens(ordem.itens ?? []);
            events.push({
              id: crypto.randomUUID(),
              type: 'ordem_dia_publicada',
              urgency: 'alta',
              title: `Ordem do Dia publicada — Sessão ${dataFormatada}`,
              detail: `A Ordem do Dia da ${ordem.sessao_tipo} de ${dataFormatada} foi publicada no SAPL.\nMatérias: ${resumo}`,
              module: 'sapl',
              action_url: `${APP_URL}/pareceres`,
              detected_at: new Date().toISOString(),
            });

            // ── Auto-geração de pareceres ──────────────────────────────────
            if (config.auto_parecer_on_ordem_dia) {
              try {
                // Buscar matérias da ordem do dia via API interna
                const ordemRes2 = await fetch(
                  `${INTERNAL_BASE}/api/pareceres/ordem-dia?sessao_id=${encodeURIComponent(ordem.id)}`,
                  { headers: { 'x-internal-call': '1' } },
                );

                let materiaIds: string[] = [];
                if (ordemRes2.ok) {
                  const materias = await ordemRes2.json() as
                    | { results?: SaplOrdemDiaMateria[] }
                    | SaplOrdemDiaMateria[];
                  const lista: SaplOrdemDiaMateria[] = Array.isArray(materias)
                    ? materias
                    : (materias.results ?? []);
                  materiaIds = lista
                    .map((m) => (m.id ? String(m.id) : null))
                    .filter((id): id is string => !!id);
                }

                await db()
                  .from('alia_task_queue')
                  .insert({
                    gabinete_id: gabineteId,
                    tipo: 'gerar_parecer_ordem_dia',
                    status: 'pendente',
                    payload: {
                      sessao_id: ordem.id,
                      materia_ids: materiaIds,
                      modelo: config.parecer_model,
                      auto_generated: true,
                    },
                  });
              } catch (autoErr) {
                console.error('[sapl-watcher] erro ao criar tarefa automática:', autoErr);
              }
            }
          }
        }
      }
    } catch {
      // watcher nunca deve lançar erro
    }

    return events;
  },
};
