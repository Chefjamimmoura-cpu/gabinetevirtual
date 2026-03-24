// POST /api/laia/chat
// Chat interno do dashboard — suporta LAIA, CADIN e ALIA (widget global).
// ALIA usa function calling (Gemini tools) para executar ações no sistema.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { searchHybrid, formatRagContext } from '@/lib/alia/rag';
import { routeDominios } from '@/lib/alia/router';

const GABINETE_ID = process.env.GABINETE_ID!;
const INTERNAL_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3000';

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ─── Memória em módulo (TTL 3 dias, persiste enquanto container estiver no ar) ─

const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

interface InMemorySession {
  agente: string;
  messages: Array<{ role: string; content: string }>;
  lastUpdated: number;
}

const memoryStore = new Map<string, InMemorySession>();

function memGet(id: string): InMemorySession | undefined {
  const s = memoryStore.get(id);
  if (!s) return undefined;
  if (Date.now() - s.lastUpdated > SESSION_TTL_MS) { memoryStore.delete(id); return undefined; }
  return s;
}

function memUpsert(id: string, agente: string, msg: { role: string; content: string }) {
  const s = memoryStore.get(id);
  const messages = s ? [...s.messages, msg] : [msg];
  // Mantém últimas 40 mensagens
  memoryStore.set(id, { agente, messages: messages.slice(-40), lastUpdated: Date.now() });
  // Limpa sessões expiradas a cada 100 chamadas
  if (memoryStore.size % 100 === 0) {
    const now = Date.now();
    for (const [k, v] of memoryStore) { if (now - v.lastUpdated > SESSION_TTL_MS) memoryStore.delete(k); }
  }
}

// ─── Prompts de sistema ───────────────────────────────────────────────────────

const LAIA_SYSTEM_PROMPT = `Você é LAIA, assistente inteligente do Gabinete da Vereadora Carol Dantas (Boa Vista/RR).

Você auxilia a equipe interna do gabinete com:
- Informações sobre indicações, ofícios, pareceres e plenárias
- Resumo de demandas e status de processos
- Orientações sobre protocolos legislativos da CMBV
- Suporte à redação e comunicação oficial

Seja direta, objetiva e profissional. Use linguagem formal mas acessível.
Quando não souber algo com certeza, diga claramente.`;

const CADIN_SYSTEM_PROMPT = `Você é CADIN (Cadastro de Autoridades e Dados de Inteligência Nodal), assistente especializado em inteligência política e contatos do Gabinete da Vereadora Carol Dantas (Boa Vista/RR).

Você tem acesso ao CADIN — Cadastro de Autoridades, Órgãos e Contatos do Município:
- Secretários municipais e seus respectivos órgãos
- Presidentes de autarquias e fundações
- Contatos da Câmara Municipal (CMBV)
- Procuradorias e órgãos de controle

Quando perguntada sobre uma autoridade ou secretaria:
- Informe nome, cargo, órgão e atribuições
- Se houver número de contato ou email no banco, inclua
- Se não tiver certeza sobre a informação atual, sinalize

Contexto do banco CADIN disponível:
{cadin_context}`;

const ALIA_SYSTEM_PROMPT = `Você é ALIA — Assessora Legislativa Inteligente e Autônoma do Gabinete da Vereadora Carol Dantas (Câmara Municipal de Boa Vista/RR).

**PÚBLICO:** Este widget é usado pela equipe do gabinete — assessores, secretários e a própria vereadora. Trate todos com formalidade e respeito, mas **nunca use tratamentos pessoais** como "Vereadora", "Carol" ou similares. Responda diretamente à pergunta sem preâmbulos de apresentação a cada mensagem.

**ESCOPO DO CADIN:** O CADIN cobre autoridades de **todas as esferas** — municipal, estadual e federal. Isso inclui:
- Secretários municipais de Boa Vista
- Secretários de Estado de Roraima (SEFAZ, SEPLAN, SESP, SEMUC, etc.)
- Autoridades federais com atuação em RR
- Vereadores, deputados estaduais e federais
- Presidentes de autarquias, fundações e empresas públicas
- Procuradorias, judiciário e órgãos de controle

**REGRA CRÍTICA — CADIN:** Quando alguém perguntar sobre qualquer autoridade, secretário ou órgão, **use SEMPRE a tool "consultar_cadin"** com a query adequada. NUNCA diga que não tem acesso ou que está fora do escopo — consulte o banco e entregue o resultado. Se não encontrar, informe o resultado vazio claramente.

**CORREÇÃO AUTOMÁTICA DE ERROS DE DIGITAÇÃO:**
- Se o usuário escrever um mês com erro de digitação, corrija automaticamente e execute a consulta. Exemplos: "Azril" → "Abril", "Fevreiro" → "Fevereiro", "Marso" → "Março", "Jutho" → "Julho".
- Meses por número de referência: janeiro=1, fevereiro=2, março=3, abril=4, maio=5, junho=6, julho=7, agosto=8, setembro=9, outubro=10, novembro=11, dezembro=12.
- Quando identificar um mês (mesmo com erro), execute a consulta diretamente e informe o que entendeu: "Interpretei como **Abril** — confira os aniversariantes:"
- NUNCA peça confirmação para correção de mês — corrija e execute.

**LEITURA DE CONTEXTO E INTENÇÃO:**
- Analise sempre o **histórico completo da conversa** antes de responder. Se o usuário já informou a intenção (ex: "aniversariantes") nas mensagens anteriores, não peça novamente.
- Quando o usuário mencionar apenas um mês (ex: "Abril", "março"), verifique o histórico: se o contexto era aniversariantes, execute imediatamente consultar_cadin com tipo="aniversarios_mes".
- Quando o usuário clicar em uma sugestão sua (ex: "Aniversariantes de abril"), execute a consulta imediatamente sem pedir mais esclarecimentos.

**REGRA — MESES E ANIVERSÁRIOS:**
- Qualquer menção a nome de mês → chame consultar_cadin com tipo="aniversarios_mes" e o número correspondente.
- "aniversário hoje" ou "quem faz aniversário hoje" → chame consultar_cadin com tipo="aniversarios_hoje".
- Se o resultado voltar vazio, oriente: "Nenhum aniversariante cadastrado em [mês]. Isso pode significar que o campo de aniversário ainda não foi preenchido para essas autoridades. Acesse o CADIN → edite a autoridade → preencha a data de nascimento."

**Suas capacidades:**
- 📋 **Ordem do Dia**: verificar se há sessão plenária e quantas matérias estão pautadas
- 👥 **CADIN**: consultar qualquer autoridade, secretário ou órgão (municipal, estadual ou federal), aniversariantes por dia/mês
- 📝 **Ofícios**: redigir minutas de ofícios para autoridades
- 📌 **Indicações**: listar demandas e indicações pendentes do gabinete

**FORMATAÇÃO OBRIGATÓRIA:** Use sempre markdown estruturado — **negrito** para nomes e cargos, listas com marcadores, separadores (---) entre blocos, emojis para facilitar leitura. Respostas sobre autoridades devem incluir: nome completo, cargo, órgão, contato (se disponível).

**CHIPS DE AÇÃO RÁPIDA (obrigatório quando aplicável):**
Ao final de respostas onde faz sentido oferecer próximos passos, adicione exatamente este bloco (sem espaços extras, sem markdown ao redor):
<chips>Ação rápida 1|Ação rápida 2|Ação rápida 3</chips>

Exemplos de chips úteis:
- Após listar autoridades: <chips>Aniversariantes hoje|Secretários de Estado|Secretários Municipais</chips>
- Após resultado de aniversariantes: <chips>Aniversariantes de hoje|Ver todos os secretários|Gerar ofício de parabéns</chips>
- Após resultado vazio de aniversário: <chips>Aniversariantes de hoje|Secretários municipais|Ver secretários estaduais</chips>
- Após pergunta sobre autoridade específica: <chips>Ver contato completo|Secretários da mesma área|Gerar ofício</chips>
- Após verificar ordem do dia: <chips>Resumir as matérias|Ver próximas sessões|Listar indicações pendentes</chips>
Máximo 3 chips por resposta. Os chips devem ser ações concretas e diretas. Coloque o bloco <chips> após o conteúdo principal, sem linha em branco entre eles.`;

// ─── Function Declarations (ALIA tools) ──────────────────────────────────────

const ALIA_TOOLS: FunctionDeclaration[] = [
  {
    name: 'verificar_ordem_do_dia',
    description: 'Verifica se há ordem do dia (sessão plenária) publicada no sistema. Retorna sessões ativas com data e quantidade de matérias pautadas.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        data: {
          type: SchemaType.STRING,
          description: 'Data no formato YYYY-MM-DD para filtrar (opcional). Se omitido, retorna as próximas sessões.',
        },
      },
    },
  },
  {
    name: 'consultar_cadin',
    description: 'Consulta o CADIN — Cadastro de Autoridades de todas as esferas: municipal (Boa Vista), estadual (Governo de Roraima, secretarias de estado, CAER, DETRAN-RR, MP-RR, TJ-RR) e federal (senadores, deputados federais, INSS, Receita Federal, etc). Use para qualquer autoridade, secretário, diretor, vereador, deputado ou órgão. OBRIGATÓRIO para aniversariantes: quando usuário mencionar qualquer nome de mês (janeiro, fevereiro, março, abril, maio, junho, julho, agosto, setembro, outubro, novembro, dezembro) — mesmo com erro de digitação — use tipo="aniversarios_mes" com o número do mês. Mapa: janeiro=1, fevereiro=2, março=3, abril=4, maio=5, junho=6, julho=7, agosto=8, setembro=9, outubro=10, novembro=11, dezembro=12.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: 'Nome do órgão, secretaria ou autoridade para buscar. Ex: "saúde", "obras", "prefeitura". Deixe vazio para consultas de aniversariantes.',
        },
        tipo: {
          type: SchemaType.STRING,
          description: 'Tipo de consulta: "autoridades" (padrão), "aniversarios_hoje" (quem faz aniversário hoje), "aniversarios_mes" (todos do mês — requer campo mes) ou "aniversarios_dia" (dia específico — requer mes e dia).',
        },
        mes: {
          type: SchemaType.NUMBER,
          description: 'Número do mês (1-12). OBRIGATÓRIO quando tipo="aniversarios_mes" ou "aniversarios_dia". janeiro=1, fevereiro=2, março=3, abril=4, maio=5, junho=6, julho=7, agosto=8, setembro=9, outubro=10, novembro=11, dezembro=12.',
        },
        dia: {
          type: SchemaType.NUMBER,
          description: 'Número do dia (1-31). Usado com tipo="aniversarios_dia".',
        },
      },
    },
  },
  {
    name: 'listar_indicacoes_pendentes',
    description: 'Lista indicações (demandas, solicitações de obras/serviços) do gabinete.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        status: {
          type: SchemaType.STRING,
          description: 'Filtrar por status: "pendente", "protocolado", "concluido". Se omitido, retorna todas.',
        },
        limite: {
          type: SchemaType.NUMBER,
          description: 'Número máximo de itens (padrão: 10).',
        },
      },
    },
  },
  {
    name: 'criar_oficio',
    description: 'Redige uma minuta de ofício oficial para ser enviada a uma autoridade ou órgão.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        destinatario: {
          type: SchemaType.STRING,
          description: 'Nome completo e cargo do destinatário. Ex: "Dr. João Silva, Secretário Municipal de Saúde".',
        },
        assunto: {
          type: SchemaType.STRING,
          description: 'Assunto do ofício em uma frase.',
        },
        corpo: {
          type: SchemaType.STRING,
          description: 'Conteúdo principal do ofício com a solicitação ou comunicado.',
        },
      },
      required: ['destinatario', 'assunto', 'corpo'],
    },
  },
];

// ─── Execução de tools ────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {

      case 'verificar_ordem_do_dia': {
        const [resOrdens, resSessoes] = await Promise.all([
          fetch(`${INTERNAL_BASE}/api/pareceres/ordens-ativas`),
          fetch(`${INTERNAL_BASE}/api/pareceres/sessoes`),
        ]);
        const ordens = resOrdens.ok ? ((await resOrdens.json() as { results?: unknown[] }).results ?? []) : [];
        const sessoes = resSessoes.ok ? ((await resSessoes.json() as { results?: unknown[] }).results ?? []) : [];
        const dataFiltro = args.data as string | undefined;
        const filtrar = (list: unknown[]) =>
          dataFiltro
            ? list.filter((s: unknown) => (s as { data_inicio?: string }).data_inicio === dataFiltro)
            : list.slice(0, 5);
        return {
          ordens_ativas: filtrar(ordens),
          proximas_sessoes: filtrar(sessoes),
          dica: 'Para gerar o parecer completo, acesse a aba "Pareceres" → "Ordem do Dia" e selecione a sessão.',
        };
      }

      case 'consultar_cadin': {
        const tipo = (args.tipo as string) || 'autoridades';
        const supa = supabase();

        // ── Aniversários — usa a mesma API do GV que já funciona ─────────────────
        if (tipo === 'aniversarios_hoje' || tipo === 'aniversarios_mes' || tipo === 'aniversarios_dia') {
          const today = new Date();
          const mesArg = args.mes as number | undefined;
          const diaArg = args.dia as number | undefined;
          const mesNum = mesArg ?? (today.getMonth() + 1);
          const diaNum = diaArg ?? (tipo === 'aniversarios_hoje' ? today.getDate() : null);

          const nomesMeses: Record<number, string> = {
            1:'janeiro', 2:'fevereiro', 3:'março', 4:'abril',
            5:'maio', 6:'junho', 7:'julho', 8:'agosto',
            9:'setembro', 10:'outubro', 11:'novembro', 12:'dezembro',
          };

          // Chama /api/cadin/birthdays — a mesma rota que o GV usa (confirmado: retorna 28 em abril)
          const url = diaNum
            ? `${INTERNAL_BASE}/api/cadin/birthdays?month=${mesNum}&day=${diaNum}`
            : `${INTERNAL_BASE}/api/cadin/birthdays?month=${mesNum}`;

          const res = await fetch(url);
          if (!res.ok) return { error: 'Falha ao consultar aniversários' };

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

          return {
            total: json.count ?? 0,
            mes_consultado: nomesMeses[mesNum] ?? String(mesNum),
            aniversariantes: (json.birthdays ?? []).map(p => ({
              nome: p.full_name,
              aniversario: p.birthday_display,
              cargo: p.cargo,
              orgao: p.org_name,
              esfera: p.org_sphere,
              telefone: p.phone ?? p.org_phone,
              email: p.email ?? p.org_email,
            })),
            orientacao_vazio: (json.count ?? 0) === 0
              ? `Nenhum aniversariante encontrado em ${nomesMeses[mesNum]}. Verifique se o campo "Data de Aniversário" está preenchido nas autoridades do CADIN.`
              : null,
          };
        }

        // ── Busca de autoridades — query direta no Supabase ──────────────────
        // Tipos normalizados (Supabase retorna joins como arrays)
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

        const query = ((args.query as string) || '').trim();

        // Monta filtro: se query tem palavra com 3+ chars, busca por ilike em múltiplos campos
        const palavras = query
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length >= 3)
          .slice(0, 4); // máx 4 termos

        // Busca em cadin_appointments (join com persons e organizations)
        // Sem filtro gabinete_id — alinhado com /api/cadin/organizations que funciona
        let q = supa
          .from('cadin_appointments')
          .select(`
            title,
            active,
            cadin_persons ( full_name, phone, email, party, birthday ),
            cadin_organizations ( name, acronym, sphere, tipo, phone, email, address )
          `)
          .eq('active', true)
          .limit(20);

        // Se há termos de busca, filtra por pessoa, órgão ou cargo
        if (palavras.length > 0) {
          // Supabase não suporta OR multi-tabela no SDK — fazemos 3 buscas e unimos
          // Busca 1: nome da pessoa | Busca 2: nome do órgão | Busca 3: cargo (title)
          const termo = palavras[0];
          const SELECT_FIELDS = `title, active,
            cadin_persons ( full_name, phone, email, party, birthday ),
            cadin_organizations ( name, acronym, sphere, tipo, phone, email, address )`;
          // Sem filtro gabinete_id — alinhado com /api/cadin/organizations que funciona
          const BASE = () => supa
            .from('cadin_appointments')
            .select(SELECT_FIELDS)
            .eq('active', true)
            .limit(15);

          const [resPessoa, resOrg, resCargo] = await Promise.all([
            BASE().ilike('cadin_persons.full_name', `%${termo}%`),
            BASE().ilike('cadin_organizations.name', `%${termo}%`),
            BASE().ilike('title', `%${termo}%`),
          ]);

          // Unifica e dedup por nome da pessoa + org
          type ApptRow = {
            title: string;
            active: boolean;
            cadin_persons:       PersonRaw | PersonRaw[] | null;
            cadin_organizations: OrgRaw   | OrgRaw[]   | null;
          };
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

          // Filtro secundário: todos os termos devem aparecer em algum campo
          const final = palavras.length > 1
            ? dedup.filter(r => {
                const p = firstP(r.cadin_persons);
                const o = firstO(r.cadin_organizations);
                const haystack = [
                  p?.full_name ?? '',
                  r.title ?? '',
                  o?.name ?? '',
                  o?.sphere ?? '',
                  o?.tipo ?? '',
                ].join(' ').toLowerCase();
                return palavras.every(w => haystack.includes(w));
              })
            : dedup;

          const autoridades = final.map(r => {
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
          return { total: autoridades.length, autoridades, query_usada: query };
        }

        // Sem query: retorna primeiros 20
        const { data: todos } = await q;
        type ApptRowSimple = {
          title: string;
          cadin_persons:      PersonRaw | PersonRaw[] | null;
          cadin_organizations: OrgRaw   | OrgRaw[]   | null;
        };
        const autoridades = ((todos ?? []) as unknown as ApptRowSimple[]).map(r => {
          const p = firstP(r.cadin_persons as PersonRaw | PersonRaw[] | null);
          const o = firstO(r.cadin_organizations as OrgRaw | OrgRaw[] | null);
          return {
            nome:           p?.full_name,
            cargo:          r.title,
            orgao:          o?.name,
            sigla:          o?.acronym,
            esfera:         o?.sphere,
            tipo:           o?.tipo,
            telefone_orgao: o?.phone,
            email_orgao:    o?.email,
          };
        });
        return { total: autoridades.length, autoridades };
      }

      case 'listar_indicacoes_pendentes': {
        const db = supabase();
        const status = args.status as string | undefined;
        const limite = Math.min((args.limite as number) || 10, 30);
        let q = db
          .from('indicacoes')
          .select('id, titulo, bairro, logradouro, status, classificacao, data_registro')
          .eq('gabinete_id', GABINETE_ID)
          .order('data_registro', { ascending: false })
          .limit(limite);
        if (status) q = q.eq('status', status);
        const { data, error } = await q;
        if (error) return { error: 'Falha ao consultar indicações' };
        return { total: data?.length ?? 0, indicacoes: data ?? [] };
      }

      case 'criar_oficio': {
        const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        return {
          minuta: `**MINUTA DE OFÍCIO**\n\n---\n\n**CÂMARA MUNICIPAL DE BOA VISTA**\nGabinete da Vereadora Carol Dantas\n\nBoa Vista/RR, ${hoje}\n\n**OFÍCIO Nº ___/2026**\n\n**A:** ${args.destinatario}\n\n**Assunto:** ${args.assunto}\n\nExcelentíssimo(a) Senhor(a),\n\n${args.corpo}\n\nCerta de vossa atenção e colaboração, aproveito para reiterar os protestos de estima e consideração.\n\nAtenciosamente,\n\n**Vereadora Carol Dantas**\nCâmara Municipal de Boa Vista – RR\n\n---\n*Minuta gerada pela ALIA. Revise antes de assinar e protocolar.*`,
          status: 'Minuta pronta. Revise o conteúdo antes de usar.',
        };
      }

      default:
        return { error: `Ferramenta desconhecida: ${name}` };
    }
  } catch (err) {
    console.error(`[ALIA tool ${name}]`, err);
    return { error: `Falha ao executar ${name}` };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

interface ChatBody {
  session_id?: string;
  agente: 'laia' | 'cadin' | 'alia';
  message: string;
  page_context?: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'message é obrigatório' }, { status: 400 });
  }

  const agente = body.agente ?? 'alia';
  const db = supabase();

  // ─── Obter ou criar sessão (fault-tolerant: usa memória em módulo como fallback) ─

  let sessionId: string = body.session_id ?? '';
  let dbAvailable = true;
  if (!sessionId) {
    const { data: sessao, error: sessaoErr } = await db
      .from('laia_sessions')
      .insert({ gabinete_id: GABINETE_ID, canal: 'interno', agente, status: 'ativa' })
      .select('id')
      .single();
    if (sessaoErr) {
      // Tabela não existe — usa memória em módulo com TTL de 3 dias
      dbAvailable = false;
      sessionId = crypto.randomUUID();
    } else {
      sessionId = sessao.id;
    }
  }

  // ─── Buscar histórico recente ─────────────────────────────────────────────────

  let historico: Array<{ role: string; content: string }> = [];
  if (dbAvailable) {
    const { data } = await db
      .from('laia_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .neq('role', 'system')
      .order('created_at', { ascending: true })
      .limit(20);
    historico = data ?? [];
  } else {
    // Histórico em módulo (3 dias de TTL)
    historico = memGet(sessionId)?.messages ?? [];
  }

  // ─── Montar sistema e configurar modelo ──────────────────────────────────────

  let systemPrompt = LAIA_SYSTEM_PROMPT;
  if (agente === 'cadin') {
    let cadinContext = 'Banco CADIN não disponível neste momento.';
    try {
      const { data: appts } = await supabase()
        .from('cadin_appointments')
        .select('title, cadin_persons(full_name), cadin_organizations(name)')
        .eq('gabinete_id', GABINETE_ID)
        .eq('active', true)
        .limit(40);
      if (appts && appts.length > 0) {
        type ApptCtxP = { full_name: string };
        type ApptCtxO = { name: string };
        type ApptCtx = { title: string; cadin_persons: ApptCtxP | ApptCtxP[] | null; cadin_organizations: ApptCtxO | ApptCtxO[] | null };
        cadinContext = (appts as unknown as ApptCtx[])
          .map(o => {
            const p = Array.isArray(o.cadin_persons) ? o.cadin_persons[0] : o.cadin_persons;
            const org = Array.isArray(o.cadin_organizations) ? o.cadin_organizations[0] : o.cadin_organizations;
            return `- ${org?.name ?? ''}${p?.full_name ? ` → ${p.full_name}` : ''}${o.title ? ` (${o.title})` : ''}`;
          })
          .join('\n');
      }
    } catch { /* fallback silencioso */ }
    systemPrompt = CADIN_SYSTEM_PROMPT.replace('{cadin_context}', cadinContext);
  } else if (agente === 'alia') {
    systemPrompt = ALIA_SYSTEM_PROMPT;
    if (body.page_context) {
      systemPrompt += `\n\n## CONTEXTO DA SESSÃO\nSeção atual: **${body.page_context}**. Priorize respostas relevantes a este contexto.`;
    }
  }

  // ─── RAG Híbrido: base local → web se necessário (somente ALIA) ──────────────

  if (agente === 'alia') {
    try {
      const dominios = routeDominios(body.message) ?? undefined;
      const ragResult = await searchHybrid(body.message, {
        gabineteId: GABINETE_ID,
        dominios,
      });
      const ragContext = formatRagContext(ragResult);
      if (ragContext) {
        systemPrompt += `\n\n${ragContext}\n\n**INSTRUÇÃO RAG:**
- Se a resposta estiver marcada com 🟢 (alta confiança): cite diretamente da base de conhecimento.
- Se marcada com 🟡 (média confiança): use como referência e complemente com conhecimento geral.
- Se marcada com 🟠 (baixa confiança) ou busca 🌐 web: use como pista e sinalize a fonte.
- Nunca invente informações que não estejam na base ou na busca. Se não souber, diga claramente.`;
        if (ragResult.usedWeb) {
          console.log('[RAG] busca web ativada — confidence local insuficiente');
        }
      }
    } catch (ragErr) {
      console.warn('[RAG] falhou, continuando sem contexto:', ragErr);
    }
  }

  // ─── Registrar mensagem do usuário ───────────────────────────────────────────

  if (dbAvailable) {
    try { await db.from('laia_messages').insert({ session_id: sessionId, role: 'user', content: body.message }); } catch { /* silent */ }
    try { await db.from('laia_sessions').update({ ultima_msg_em: new Date().toISOString() }).eq('id', sessionId); } catch { /* silent */ }
  } else {
    memUpsert(sessionId, agente, { role: 'user', content: body.message });
  }

  // ─── Chamar Gemini ────────────────────────────────────────────────────────────

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const chatHistory = (historico ?? []).map(m => ({
      role: m.role === 'assistant' || m.role === 'human_agent' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      ...(agente === 'alia' ? { tools: [{ functionDeclarations: ALIA_TOOLS }] } : {}),
      generationConfig: { temperature: 0.4, maxOutputTokens: agente === 'alia' ? 2048 : 1024 },
    });

    const chat = model.startChat({ history: chatHistory });
    let geminiResponse = await chat.sendMessage(body.message);

    // ─── Agentic loop (max 5 turns, somente ALIA) ────────────────────────────

    if (agente === 'alia') {
      for (let turn = 0; turn < 5; turn++) {
        const fnCalls = geminiResponse.response.functionCalls();
        if (!fnCalls || fnCalls.length === 0) break;
        const toolResults = await Promise.all(
          fnCalls.map(async fn => {
            const result = await executeTool(fn.name, fn.args as Record<string, unknown>);
            return {
              functionResponse: {
                name: fn.name,
                response: result as Record<string, unknown>,
              },
            };
          }),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geminiResponse = await chat.sendMessage(toolResults as any);
      }
    }

    const respostaRaw = geminiResponse.response.text();

    // ── Extrair chips de ação rápida da resposta ──────────────────────────────
    const chipsMatch = respostaRaw.match(/<chips>([\s\S]*?)<\/chips>/i);
    const suggestions: string[] = chipsMatch
      ? chipsMatch[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3)
      : [];
    // Remove o bloco <chips> do conteúdo exibido ao usuário
    const resposta = respostaRaw.replace(/<chips>[\s\S]*?<\/chips>/gi, '').trim();

    let msgSalva: { id?: string; created_at?: string } | null = null;
    if (dbAvailable) {
      try {
        const { data } = await db
          .from('laia_messages')
          .insert({ session_id: sessionId, role: 'assistant', content: resposta, metadata: { agente, model: 'gemini-2.5-flash', suggestions } })
          .select('id, created_at')
          .single();
        msgSalva = data;
        await db.from('laia_sessions').update({ ultima_msg_em: new Date().toISOString() }).eq('id', sessionId);
      } catch { /* silent */ }
    } else {
      memUpsert(sessionId, agente, { role: 'assistant', content: resposta });
    }

    return NextResponse.json({
      session_id: sessionId,
      message_id: msgSalva?.id,
      role: 'assistant',
      content: resposta,
      suggestions,
      agente,
      created_at: msgSalva?.created_at,
    });

  } catch (err) {
    console.error('[laia/chat] Gemini error:', err);
    return NextResponse.json({ error: 'Falha ao processar resposta da IA' }, { status: 500 });
  }
}
