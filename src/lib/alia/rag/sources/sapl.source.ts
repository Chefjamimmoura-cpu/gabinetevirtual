// src/lib/alia/rag/sources/sapl.source.ts
// Fetches municipal legislation from SAPL CMBV.

import type { LegalSource } from './source.interface';
import type { LegalDocument, TipoNorma } from '../legal-types';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

export const saplSource: LegalSource = {
  name: 'SAPL CMBV',
  baseUrl: 'https://sapl.boavista.rr.leg.br',

  async fetchByTheme(theme, opts) {
    try {
      // Use the existing SAPL API integration via internal routes
      const url = `${INTERNAL_BASE}/api/sapl/materias?q=${encodeURIComponent(theme)}&tipo=lei`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) return [];
      const data = await res.json();
      const materias = Array.isArray(data) ? data : (data.results ?? []);

      return materias.slice(0, opts?.limit ?? 50).map((m: any) => ({
        tipo_norma: 'lei_ordinaria' as TipoNorma,
        numero: String(m.numero ?? ''),
        ano: Number(m.ano ?? new Date().getFullYear()),
        esfera: 'municipal' as const,
        ementa: m.ementa ?? '',
        texto_integral: m.texto_original ?? m.ementa ?? '',
        fonte_url: `${this.baseUrl}/materia/${m.id}`,
        data_publicacao: m.data_publicacao ?? new Date().toISOString().split('T')[0],
        situacao: 'vigente' as const,
      }));
    } catch (err) {
      console.error('[SAPL source] fetchByTheme error:', err);
      return [];
    }
  },

  async fetchNorma(tipo, numero, ano) {
    try {
      const url = `${INTERNAL_BASE}/api/sapl/materias?numero=${numero}&ano=${ano}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      const data = await res.json();
      const m = Array.isArray(data) ? data[0] : data.results?.[0];
      if (!m) return null;

      return {
        tipo_norma: tipo,
        numero: String(m.numero),
        ano: Number(m.ano),
        esfera: 'municipal',
        ementa: m.ementa ?? '',
        texto_integral: m.texto_original ?? '',
        fonte_url: `${this.baseUrl}/materia/${m.id}`,
        data_publicacao: m.data_publicacao ?? '',
        situacao: 'vigente',
      };
    } catch (err) {
      console.error('[SAPL source] fetchNorma error:', err);
      return null;
    }
  },
};
