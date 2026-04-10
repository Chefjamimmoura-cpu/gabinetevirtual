// src/lib/alia/agents/oficio.agent.ts
// ALIA Agent: Ofício — redige minuta de ofício oficial da Vereadora Carol Dantas.

import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

// ── Agent export ─────────────────────────────────────────────────────────────

export const oficioAgent: AliaAgent = {
  name: 'oficio',
  description: 'Redige minutas de ofícios oficiais em nome da Vereadora Carol Dantas para encaminhar demandas ao Executivo ou outras autoridades.',

  async execute({ action: _action, data }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      const { destinatario, assunto, corpo } = data as {
        destinatario: string;
        assunto: string;
        corpo: string;
      };

      if (!destinatario || !assunto || !corpo) {
        return {
          success: false,
          content: 'Para criar o ofício, informe: destinatário (nome e cargo), assunto e o corpo do texto.',
        };
      }

      const hoje = new Date().toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      const ano = new Date().getFullYear();

      const minuta = [
        `**MINUTA DE OFÍCIO**`,
        ``,
        `---`,
        ``,
        `**CÂMARA MUNICIPAL DE BOA VISTA**`,
        `Gabinete da Vereadora Carol Dantas`,
        ``,
        `Boa Vista/RR, ${hoje}`,
        ``,
        `**OFÍCIO Nº ___/${ano}**`,
        ``,
        `**A:** ${destinatario}`,
        ``,
        `**Assunto:** ${assunto}`,
        ``,
        `Excelentíssimo(a) Senhor(a),`,
        ``,
        corpo,
        ``,
        `Certa de vossa atenção e colaboração, aproveito para reiterar os protestos de estima e consideração.`,
        ``,
        `Atenciosamente,`,
        ``,
        `**Vereadora Carol Dantas**`,
        `Câmara Municipal de Boa Vista – RR`,
        ``,
        `---`,
        `*Minuta gerada pela ALIA. Revise antes de assinar e protocolar.*`,
      ].join('\n');

      return {
        success: true,
        content: minuta,
        structured: {
          minuta,
          destinatario,
          assunto,
          status: 'Minuta pronta. Revise o conteúdo antes de usar.',
        },
        actions_taken: ['oficio_redigido'],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro ao criar ofício: ${msg}` };
    }
  },
};
