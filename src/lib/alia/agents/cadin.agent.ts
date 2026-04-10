// src/lib/alia/agents/cadin.agent.ts
// ALIA Agent: CADIN — consulta autoridades, aniversariantes e exporta caderno PDF.

import { createClient } from '@supabase/supabase-js';
import type { AliaAgent, AgentContext, AgentResult } from './agent.interface';

const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

type PersonRaw = { full_name: string; phone?: string; email?: string; party?: string; birthday?: string };
type OrgRaw    = { name: string; acronym?: string; sphere?: string; tipo?: string; phone?: string; email?: string; address?: string };

function firstP(v: PersonRaw | PersonRaw[] | null): PersonRaw | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
function firstO(v: OrgRaw | OrgRaw[] | null): OrgRaw | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const NOMES_MESES: Record<number, string> = {
  1:'janeiro', 2:'fevereiro', 3:'março', 4:'abril',
  5:'maio', 6:'junho', 7:'julho', 8:'agosto',
  9:'setembro', 10:'outubro', 11:'novembro', 12:'dezembro',
};

// ── consultar_cadin ──────────────────────────────────────────────────────────

async function consultarCadin(args: Record<string, unknown>): Promise<AgentResult> {
  const tipo = (args.tipo as string) || 'autoridades';
  const supa = getSupabase();

  // ── Aniversários ──────────────────────────────────────────────────────────
  if (tipo === 'aniversarios_hoje' || tipo === 'aniversarios_mes' || tipo === 'aniversarios_dia') {
    const today = new Date();
    const mesArg = args.mes as number | undefined;
    const diaArg = args.dia as number | undefined;
    const mesNum = mesArg ?? (today.getMonth() + 1);
    const diaNum = diaArg ?? (tipo === 'aniversarios_hoje' ? today.getDate() : null);

    const url = diaNum
      ? `${INTERNAL_BASE}/api/cadin/birthdays?month=${mesNum}&day=${diaNum}`
      : `${INTERNAL_BASE}/api/cadin/birthdays?month=${mesNum}`;

    const res = await fetch(url);
    if (!res.ok) {
      return { success: false, content: 'Falha ao consultar aniversários no CADIN.' };
    }

    const json = await res.json() as {
      count: number;
      birthdays: Array<{
        full_name: string;
        birthday_display: string | null;
        phone: string | null;
        email: string | null;
        cargo: string | null;
        org_name: string | null;
        org_phone: string | null;
        org_email: string | null;
        org_sphere: string | null;
      }>;
    };

    const total = json.count ?? 0;
    const nomeMes = NOMES_MESES[mesNum] ?? String(mesNum);

    if (total === 0) {
      const orientacao = diaNum
        ? `Nenhum aniversariante em ${String(diaNum).padStart(2,'0')}/${String(mesNum).padStart(2,'0')}.`
        : `Nenhum aniversariante em ${nomeMes}. Verifique se o campo "Data de Aniversário" está preenchido nas autoridades do CADIN.`;
      return {
        success: true,
        content: orientacao,
        structured: { total: 0, aniversariantes: [] },
      };
    }

    const lista = (json.birthdays ?? []).map(p => ({
      nome:      p.full_name,
      aniversario: p.birthday_display,
      cargo:     p.cargo,
      orgao:     p.org_name,
      esfera:    p.org_sphere,
      telefone:  p.phone ?? p.org_phone,
      email:     p.email ?? p.org_email,
    }));

    const linhas = lista
      .map(p => `• **${p.nome}**${p.aniversario ? ` (${p.aniversario})` : ''} — ${p.cargo ?? ''}${p.orgao ? ` / ${p.orgao}` : ''}\n  Tel: ${p.telefone ?? 'N/I'}`)
      .join('\n');

    const titulo = diaNum
      ? `Aniversariantes de ${String(diaNum).padStart(2,'0')}/${String(mesNum).padStart(2,'0')} (${total}):`
      : `Aniversariantes de ${nomeMes} (${total}):`;

    return {
      success: true,
      content: `🎂 ${titulo}\n\n${linhas}`,
      structured: { total, aniversariantes: lista },
    };
  }

  // ── Busca de autoridades ──────────────────────────────────────────────────
  const query = ((args.query as string) || '').trim();
  const palavras = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3).slice(0, 4);

  const SELECT_FIELDS = `title, active,
    cadin_persons ( full_name, phone, email, party, birthday ),
    cadin_organizations ( name, acronym, sphere, tipo, phone, email, address )`;

  const BASE = () =>
    supa.from('cadin_appointments').select(SELECT_FIELDS).eq('active', true).limit(15);

  type ApptRow = {
    title: string;
    active: boolean;
    cadin_persons:       PersonRaw | PersonRaw[] | null;
    cadin_organizations: OrgRaw   | OrgRaw[]   | null;
  };

  let rows: ApptRow[];

  if (palavras.length > 0) {
    const termo = palavras[0];
    const [resPessoa, resOrg, resCargo] = await Promise.all([
      BASE().ilike('cadin_persons.full_name', `%${termo}%`),
      BASE().ilike('cadin_organizations.name', `%${termo}%`),
      BASE().ilike('title', `%${termo}%`),
    ]);

    const combined: ApptRow[] = [
      ...((resPessoa.data ?? []) as unknown as ApptRow[]),
      ...((resOrg.data    ?? []) as unknown as ApptRow[]),
      ...((resCargo.data  ?? []) as unknown as ApptRow[]),
    ];

    const seen = new Set<string>();
    const dedup = combined.filter(r => {
      const p = firstP(r.cadin_persons);
      const o = firstO(r.cadin_organizations);
      const key = `${p?.full_name}|${o?.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    rows = palavras.length > 1
      ? dedup.filter(r => {
          const p = firstP(r.cadin_persons);
          const o = firstO(r.cadin_organizations);
          const haystack = [p?.full_name ?? '', r.title ?? '', o?.name ?? '', o?.sphere ?? '', o?.tipo ?? ''].join(' ').toLowerCase();
          return palavras.every(w => haystack.includes(w));
        })
      : dedup;
  } else {
    const { data: todos } = await supa
      .from('cadin_appointments')
      .select(SELECT_FIELDS)
      .eq('active', true)
      .limit(20);
    rows = (todos ?? []) as unknown as ApptRow[];
  }

  const autoridades = rows.map(r => {
    const p = firstP(r.cadin_persons);
    const o = firstO(r.cadin_organizations);
    return {
      nome:            p?.full_name,
      cargo:           r.title,
      orgao:           o?.name,
      sigla:           o?.acronym,
      esfera:          o?.sphere,
      tipo:            o?.tipo,
      telefone_pessoa: p?.phone,
      email_pessoa:    p?.email,
      partido:         p?.party,
      telefone_orgao:  o?.phone,
      email_orgao:     o?.email,
      endereco:        o?.address,
    };
  });

  if (autoridades.length === 0) {
    return {
      success: true,
      content: `Nenhuma autoridade encontrada para a busca: "${query}".`,
      structured: { total: 0, autoridades: [], query_usada: query },
    };
  }

  const linhas = autoridades.map(a =>
    `• **${a.nome ?? 'N/I'}** — ${a.cargo ?? ''}${a.orgao ? ` (${a.orgao})` : ''}\n  Tel: ${a.telefone_pessoa ?? a.telefone_orgao ?? 'N/I'}${a.email_pessoa ?? a.email_orgao ? ` | ${a.email_pessoa ?? a.email_orgao}` : ''}`
  ).join('\n');

  return {
    success: true,
    content: `Encontrados ${autoridades.length} resultado(s) para "${query}":\n\n${linhas}`,
    structured: { total: autoridades.length, autoridades, query_usada: query },
  };
}

// ── gerar_caderno_pdf ────────────────────────────────────────────────────────

async function gerarCadernoPdf(args: Record<string, unknown>): Promise<AgentResult> {
  const { esfera = 'todos', tipo, cargo } = args as { esfera?: string; tipo?: string; cargo?: string };
  try {
    const supa = getSupabase();

    const params = new URLSearchParams();
    if (esfera && esfera !== 'todos') params.set('sphere', esfera);
    if (tipo) params.set('type', tipo);
    if (cargo) params.set('cargo', cargo);
    const qs = params.toString();

    // Verificar cache
    const crypto = await import('crypto');
    const sortedKey = Array.from(params.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v.toLowerCase()}`).join('&');
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
        content: `📄 **${cached.label || 'Caderno de Autoridades'}**\n(${cached.authority_count} autoridades)\n\n✅ Documento disponível (cache):\n${cached.pdf_public_url}`,
        structured: { cache: true, download_url: cached.pdf_public_url, authority_count: cached.authority_count },
        actions_taken: ['cache_hit'],
      };
    }

    const publicUrl = `${INTERNAL_BASE}/api/cadin/export-pdf${qs ? `?${qs}` : ''}`;

    const LABELS: Record<string, string> = {
      secretaria: 'Secretarias', autarquia: 'Autarquias', fundacao: 'Fundações',
      prefeitura: 'Prefeituras', camara: 'Câmaras', judiciario: 'Judiciário',
      governo_estadual: 'Governo Estadual',
    };
    const descParts: string[] = [];
    if (cargo) descParts.push(cargo);
    if (tipo) descParts.push(LABELS[tipo] || tipo);
    if (esfera && esfera !== 'todos') {
      descParts.push(esfera === 'estadual' ? 'Estaduais' : esfera === 'federal' ? 'Federais' : 'Municipais');
    }
    const desc = descParts.length > 0 ? descParts.join(' · ') : 'Todas as autoridades';

    return {
      success: true,
      content: `📄 **Caderno de Autoridades — ${desc}**\n\nBaixe o PDF em:\n${publicUrl}\n\n_(O PDF será gerado e cacheado para futuras consultas)_`,
      structured: { cache: false, download_url: publicUrl },
      actions_taken: ['pdf_link_gerado'],
    };
  } catch {
    return { success: false, content: 'Falha ao gerar o Caderno PDF.' };
  }
}

// ── Agent export ─────────────────────────────────────────────────────────────

export const cadinAgent: AliaAgent = {
  name: 'cadin',
  description: 'Consulta o CADIN — autoridades, órgãos, contatos e aniversariantes de Roraima. Também gera o Caderno de Autoridades em PDF.',

  async execute({ action, data, context: _context }: {
    action: string;
    data: Record<string, unknown>;
    context: AgentContext;
    model: string;
  }): Promise<AgentResult> {
    try {
      if (action === 'gerar_caderno_pdf') {
        return await gerarCadernoPdf(data);
      }
      // Default: consultar_cadin
      return await consultarCadin(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, content: `Erro no agente CADIN: ${msg}` };
    }
  },
};
