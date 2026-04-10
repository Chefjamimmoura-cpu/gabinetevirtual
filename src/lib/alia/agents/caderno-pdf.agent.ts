// src/lib/alia/agents/caderno-pdf.agent.ts
// ALIA Agent: Caderno PDF — gera e exporta o Caderno de Autoridades em PDF com filtros.
// Separado do cadin.agent para uso direto como ação explícita de export.

import { createClient } from '@supabase/supabase-js';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const TIPO_LABELS: Record<string, string> = {
  secretaria:       'Secretarias',
  autarquia:        'Autarquias',
  fundacao:         'Fundações',
  empresa_publica:  'Empresas Públicas',
  camara:           'Câmaras',
  prefeitura:       'Prefeituras',
  judiciario:       'Judiciário',
  governo_estadual: 'Governo Estadual',
  outros:           'Outros',
};

// ── Agent export ─────────────────────────────────────────────────────────────

export const cadernoPdfAgent: AliaAgent = {
  name: 'cadin',
  description: 'Gera o PDF do Caderno de Autoridades do Estado de Roraima com filtros por esfera, tipo de órgão ou cargo.',

  async execute({ action: _action, data }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const {
        esfera = 'todos',
        tipo,
        cargo,
      } = data as {
        esfera?: string;
        tipo?: string;
        cargo?: string;
      };

      const supa = getSupabase();

      // Monta query string de filtros
      const params = new URLSearchParams();
      if (esfera && esfera !== 'todos') params.set('sphere', esfera);
      if (tipo) params.set('type', tipo);
      if (cargo) params.set('cargo', cargo);
      const qs = params.toString();

      // Verificar cache (evita regerar PDF recém-gerado)
      const crypto = await import('crypto');
      const sortedKey = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v.toLowerCase()}`)
        .join('&');
      const filterHash = crypto.createHash('md5').update(sortedKey || 'all').digest('hex');

      const { data: cached } = await supa
        .from('cadin_pdf_cache')
        .select('pdf_public_url, authority_count, label')
        .eq('filter_hash', filterHash)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cached?.pdf_public_url) {
        return {
          success: true,
          content: [
            `📄 **${cached.label || 'Caderno de Autoridades'}**`,
            `(${cached.authority_count} autoridades)`,
            ``,
            `✅ Documento disponível (cache):`,
            cached.pdf_public_url,
          ].join('\n'),
          structured: {
            cache: true,
            download_url: cached.pdf_public_url,
            authority_count: cached.authority_count,
          },
          actions_taken: ['caderno_pdf_cache_hit'],
        };
      }

      // Cache miss — retorna link de geração sob demanda
      const publicUrl = `${INTERNAL_BASE}/api/cadin/export-pdf${qs ? `?${qs}` : ''}`;

      // Descrição humanizada dos filtros
      const descParts: string[] = [];
      if (cargo) descParts.push(cargo);
      if (tipo) descParts.push(TIPO_LABELS[tipo] || tipo);
      if (esfera && esfera !== 'todos') {
        const esferaLabel = esfera === 'estadual' ? 'Estaduais' : esfera === 'federal' ? 'Federais' : 'Municipais';
        descParts.push(esferaLabel);
      }
      const desc = descParts.length > 0 ? descParts.join(' · ') : 'Todas as autoridades';

      return {
        success: true,
        content: [
          `📄 **Caderno de Autoridades — ${desc}**`,
          ``,
          `Baixe o PDF em:`,
          publicUrl,
          ``,
          `_(O PDF será gerado e cacheado por 24h para futuras consultas)_`,
        ].join('\n'),
        structured: {
          cache: false,
          download_url: publicUrl,
          filtros: { esfera, tipo, cargo },
        },
        actions_taken: ['caderno_pdf_link_gerado'],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Falha ao gerar o Caderno PDF: ${msg}` };
    }
  },
};
