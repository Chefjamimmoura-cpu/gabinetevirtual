// src/lib/alia/agents/consulta-materia.agent.ts
// ALIA Agent: Consulta Matéria — busca ementa, autoria e tramitação de matérias legislativas no SAPL.

import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

// ── Types ────────────────────────────────────────────────────────────────────

interface TramitacaoItem {
  data?: string;
  comissao?: string;
  descricao?: string;
  situacao?: string;
  aprovado?: boolean;
}

interface MateriaResult {
  id: number;
  tipo_sigla: string;
  numero: number;
  ano: number;
  ementa: string;
  autores: string[];
  data_apresentacao?: string;
  tramitacao?: TramitacaoItem[];
  url_sapl: string;
}

interface BuscarMateriaResponse {
  materias: MateriaResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tenta extrair referência de matéria da query.
 * Aceita: "PLL 32/2026", "PLE 5/2026", "32/2026", "PLL 32 2026" etc.
 */
function extrairReferencia(query: string): { tipo_sigla?: string; numero: number; ano: number } | null {
  // Padrão com sigla: PLL 32/2026 | PLL32/2026 | PLL 32 2026
  const comSigla = /\b(PLL|PLE|PLO|REQ|IND|RLO|PDL|EMC|SBD)\s*(\d{1,4})[\/\s](\d{4})\b/i;
  const matchSigla = query.match(comSigla);
  if (matchSigla) {
    return {
      tipo_sigla: matchSigla[1].toUpperCase(),
      numero: parseInt(matchSigla[2], 10),
      ano: parseInt(matchSigla[3], 10),
    };
  }

  // Padrão sem sigla: 32/2026
  const semSigla = /\b(\d{1,4})\/(\d{4})\b/;
  const matchSemSigla = query.match(semSigla);
  if (matchSemSigla) {
    return {
      numero: parseInt(matchSemSigla[1], 10),
      ano: parseInt(matchSemSigla[2], 10),
    };
  }

  return null;
}

/**
 * Formata a situação de tramitação de forma amigável com emoji.
 */
function formatarSituacao(situacao?: string, aprovado?: boolean): string {
  if (aprovado === true) return '✅ Favorável';
  if (aprovado === false) return '❌ Contrário';
  if (!situacao) return '⏳ Pendente';

  const s = situacao.toLowerCase();
  if (s.includes('favorável') || s.includes('aprovad') || s.includes('deferido')) return '✅ Favorável';
  if (s.includes('contrário') || s.includes('reprovad') || s.includes('indeferido')) return '❌ Contrário';
  if (s.includes('arquivad')) return '🗂️ Arquivado';
  if (s.includes('devolvid') || s.includes('retirad')) return '↩️ Devolvido';
  return `⏳ ${situacao}`;
}

/**
 * Formata data ISO ou DD/MM/YYYY para exibição.
 */
function formatarData(data?: string): string {
  if (!data) return 'N/I';
  try {
    const d = new Date(data);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('pt-BR');
    }
  } catch {
    // ignora erro de parse
  }
  return data;
}

/**
 * Monta a ficha técnica de uma matéria legislativa.
 */
function montarFichaTecnica(m: MateriaResult): string {
  const linhas: string[] = [];

  linhas.push(`📄 *${m.tipo_sigla} ${m.numero}/${m.ano}*`);

  if (m.autores && m.autores.length > 0) {
    const autoresStr = m.autores.join(', ');
    linhas.push(`Autor: ${autoresStr}`);
  }

  if (m.ementa) {
    linhas.push(`Ementa: ${m.ementa}`);
  }

  if (m.tramitacao && m.tramitacao.length > 0) {
    linhas.push('');
    linhas.push('📊 *Tramitação:*');

    if (m.data_apresentacao) {
      linhas.push(`  • Entrada: ${formatarData(m.data_apresentacao)}`);
    }

    for (const t of m.tramitacao) {
      const nome = t.comissao || t.descricao || 'Tramitação';
      const status = formatarSituacao(t.situacao, t.aprovado);
      const data = t.data ? ` (${formatarData(t.data)})` : '';
      linhas.push(`  • ${nome}: ${status}${data}`);
    }
  }

  linhas.push('');
  linhas.push(`🔗 Ver no SAPL: ${m.url_sapl}`);

  return linhas.join('\n');
}

// ── Agent export ─────────────────────────────────────────────────────────────

export const consultaMateriaAgent: AliaAgent = {
  name: 'consulta_materia',
  description: 'Busca informações sobre matérias legislativas no SAPL: ementa, autoria e tramitação. Responde a consultas por número (PLL 32/2026) ou por texto (sobre o que é...).',

  async execute({ action: _action, data }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const query = (data.query as string | undefined) || (data.text as string | undefined) || '';

      if (!query.trim()) {
        return {
          success: false,
          content: 'Por favor, informe o número da matéria (ex: PLL 32/2026) ou descreva sobre o que deseja consultar.',
        };
      }

      // Tenta extrair referência direta (número/ano)
      const ref = extrairReferencia(query);

      let url: string;
      if (ref) {
        const params = new URLSearchParams();
        if (ref.tipo_sigla) params.set('tipo_sigla', ref.tipo_sigla);
        params.set('numero', String(ref.numero));
        params.set('ano', String(ref.ano));
        url = `${INTERNAL_BASE}/api/pareceres/buscar-materia?${params.toString()}`;
      } else {
        // Busca textual por ementa
        url = `${INTERNAL_BASE}/api/pareceres/buscar-materia?q=${encodeURIComponent(query)}`;
      }

      const res = await fetch(url);

      if (!res.ok) {
        const errText = await res.text().catch(() => 'erro desconhecido');
        return {
          success: false,
          content: `Não foi possível consultar o SAPL no momento. Detalhe: ${errText}`,
        };
      }

      const json = await res.json() as BuscarMateriaResponse;
      const materias = json.materias ?? [];

      if (materias.length === 0) {
        const sugestao = ref
          ? `Verifique se o número está correto (ex: ${ref.tipo_sigla ? ref.tipo_sigla + ' ' : ''}${ref.numero}/${ref.ano}) ou tente buscar pela ementa.`
          : 'Tente informar o número completo da matéria, como PLL 32/2026.';

        return {
          success: true,
          content: `Nenhuma matéria encontrada para a consulta: "${query}".\n${sugestao}`,
          structured: { materias: [], query },
        };
      }

      // Resultado único: ficha técnica completa
      if (materias.length === 1) {
        return {
          success: true,
          content: montarFichaTecnica(materias[0]),
          structured: { materias, query },
        };
      }

      // Múltiplos resultados: lista resumida (top 5)
      const top5 = materias.slice(0, 5);
      const lista = top5.map((m, i) => {
        const autores = m.autores?.length ? ` — ${m.autores[0]}` : '';
        const ementa = m.ementa ? ` — ${m.ementa.slice(0, 80)}${m.ementa.length > 80 ? '...' : ''}` : '';
        return `${i + 1}. *${m.tipo_sigla} ${m.numero}/${m.ano}*${autores}${ementa}`;
      });

      const intro = `Encontrei ${materias.length} matéria${materias.length > 1 ? 's' : ''} para "${query}". Aqui estão as principais:\n`;
      const dica = '\n\nPara ver a ficha completa, informe o número exato (ex: PLL 32/2026).';

      return {
        success: true,
        content: intro + lista.join('\n') + dica,
        structured: { materias: top5, total: materias.length, query },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro ao consultar matéria: ${msg}` };
    }
  },
};
