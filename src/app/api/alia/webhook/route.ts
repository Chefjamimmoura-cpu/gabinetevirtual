// POST /api/alia/webhook
// ──────────────────────────────────────────────────────────────
// Webhook da Evolution API — recebe mensagens WhatsApp enviadas
// para a instância "gabinete-carol" e as processa via Gemini (ALIA).
//
// Fluxo:
//  1. Evolution API dispara POST aqui ao receber mensagem
//  2. Filtra: só mensagens de texto, ignora grupos e o próprio bot
//  3. Detecta COMANDOS DA EQUIPE DE CAMPO (começam com !):
//     !nova bairro="X" rua="Y" setores="A,B" [urgencia|prioridade]
//       → cria indicação no Supabase e retorna ID
//     !lista [responsavel]
//       → lista pendentes/em_andamento do responsável
//     !protocolar [id_curto]
//       → gera documento IA + protocola no SAPL
//     !status [id_curto]
//       → retorna status atual da indicação
//  4. Para mensagens normais: Gemini gera resposta como assessora ALIA
//  5. Resposta enviada de volta via Evolution API sendText
//  6. Log salvo em cadin_cia_logs
//
// Configuração na Evolution API (dashboard ou API):
//   Webhook URL: https://gabinete.wonetechnology.cloud/api/alia/webhook
//   Events: MESSAGES_UPSERT
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ──────────────────────────────────────────────────────────────
// COMANDOS DA EQUIPE DE CAMPO
// ──────────────────────────────────────────────────────────────

const GABINETE_ID = process.env.GABINETE_ID!;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ──────────────────────────────────────────────────────────────
// FERRAMENTAS PARA FUNCTION CALLING (AGENTIC LOOP)
// ──────────────────────────────────────────────────────────────
const aliaTools = [{
  functionDeclarations: [
    {
      name: "registrar_indicacao",
      description: "Registra uma nova indicação, zeladoria ou buraco no sistema (ex: Asfalto, Limpeza, Iluminação).",
      parameters: {
        type: "OBJECT",
        properties: {
          bairro: { type: "STRING", description: "Bairro do problema." },
          logradouro: { type: "STRING", description: "Rua do problema, cruzamento, local." },
          setores: { type: "ARRAY", items: { type: "STRING" }, description: "Secretarias/Setores envolvidos (ex: Asfalto, Esgoto)." },
          classificacao: { type: "STRING", enum: ["necessidade", "prioridade", "urgencia"], description: "Gravidade do problema." }
        },
        required: ["bairro", "logradouro", "classificacao"]
      }
    },
    {
      name: "listar_indicacoes",
      description: "Lista as indicações pendentes de um determinado membro da equipe.",
      parameters: {
        type: "OBJECT",
        properties: {
          responsavel: { type: "STRING", description: "Nome do assessor/responsável a pesquisar." }
        }
      }
    },
    {
      name: "protocolar_indicacao",
      description: "Gera a ementa otimizada e protocola a indicação diretamente no SAPL.",
      parameters: {
        type: "OBJECT",
        properties: {
          id_curto: { type: "STRING", description: "ID curto (8 caracteres) da indicação existente." }
        },
        required: ["id_curto"]
      }
    },
    {
      name: "consultar_status",
      description: "Consulta o status e o número SAPL de uma indicação.",
      parameters: {
        type: "OBJECT",
        properties: {
          id_curto: { type: "STRING", description: "ID curto (8 caracteres)." }
        },
        required: ["id_curto"]
      }
    },
    {
      name: "consultar_cadin",
      description: "Consulta o CADIN — Caderno de Autoridades de Roraima. Use para: obter contatos de autoridades e secretarias; saber quem ocupa determinado cargo; listar aniversariantes do dia ou do mês; buscar endereços e telefones de órgãos públicos.",
      parameters: {
        type: "OBJECT",
        properties: {
          consulta: { type: "STRING", description: "O que deseja saber: nome de secretaria, autoridade, cargo, órgão, ou 'aniversariantes de hoje/mês'." },
          aniversariantes_hoje: { type: "BOOLEAN", description: "Se true, retorna os aniversariantes do dia de hoje." },
          aniversariantes_mes: { type: "NUMBER", description: "Número do mês (1-12) para listar aniversariantes." }
        },
        required: ["consulta"]
      }
    },
    {
      name: "criar_oficio",
      description: "Cria uma minuta de ofício em nome da Vereadora Carol Dantas para encaminhar demandas ao Executivo.",
      parameters: {
        type: "OBJECT",
        properties: {
          destinatario: { type: "STRING", description: "Nome e cargo do destinatário do ofício." },
          assunto: { type: "STRING", description: "Assunto do ofício." },
          corpo: { type: "STRING", description: "Corpo do ofício em texto livre." }
        },
        required: ["destinatario", "assunto", "corpo"]
      }
    },
    {
      name: "marcar_agenda",
      description: "Marca um evento, reunião ou compromisso na agenda da Vereadora Carol Dantas.",
      parameters: {
        type: "OBJECT",
        properties: {
          titulo: { type: "STRING", description: "Título do evento ou reunião." },
          data_inicio: { type: "STRING", description: "Data e hora de início no formato ISO 8601 (ex: 2026-03-20T14:00:00)." },
          data_fim: { type: "STRING", description: "Data e hora de término (opcional)." },
          local: { type: "STRING", description: "Local do evento (opcional)." },
          descricao: { type: "STRING", description: "Descrição ou observações do evento (opcional)." },
          tipo: { type: "STRING", enum: ["reuniao", "agenda_externa", "sessao_plenaria", "reuniao_comissao", "outro"], description: "Tipo do evento. Padrão: reuniao." }
        },
        required: ["titulo", "data_inicio"]
      }
    },
    {
      name: "gerar_parecer_relator",
      description: "Gera um parecer de relator para uma comissão sobre uma matéria legislativa específica.",
      parameters: {
        type: "OBJECT",
        properties: {
          materia_id: { type: "NUMBER", description: "ID Numérico da matéria no SAPL." },
          commission_sigla: { type: "STRING", enum: ["CLJRF", "COF", "COUTH", "CECEJ", "CSASM", "CDCDHAISU", "CEDP", "CASP", "CPMAIPD", "CAG"], description: "Sigla da comissão." },
          voto: { type: "STRING", enum: ["FAVORÁVEL", "CONTRÁRIO", "CAUTELA"], description: "Voto do relator. Padrão: FAVORÁVEL" }
        },
        required: ["materia_id", "commission_sigla"]
      }
    },
    {
      name: "gerar_caderno_pdf",
      description: "Gera o PDF do Caderno de Autoridades do Estado de Roraima e retorna o link para download. O caderno pode ser filtrado por esfera, tipo de órgão ou cargo. Exemplos: 'somente secretários de estado', 'autarquias federais', 'todos os secretários municipais'.",
      parameters: {
        type: "OBJECT",
        properties: {
          esfera: { type: "STRING", enum: ["federal", "estadual", "municipal", "todos"], description: "Esfera a filtrar. Padrão: todos." },
          tipo: { type: "STRING", enum: ["secretaria", "autarquia", "fundacao", "empresa_publica", "camara", "prefeitura", "judiciario", "governo_estadual", "outros"], description: "Tipo de órgão a filtrar. Exemplos: secretaria, autarquia." },
          cargo: { type: "STRING", description: "Cargo para filtrar (ex: Secretário, Governador, Prefeito, Presidente). Busca parcial no título do cargo." }
        }
      }
    }
  ]
}];

async function executeLocalFunction(name: string, args: Record<string, any>, senderName: string): Promise<any> {
  const supabase = getSupabase();
  
  try {
    if (name === 'registrar_indicacao') {
      const { bairro, logradouro, setores = [], classificacao = 'necessidade' } = args;
      const titulo = `${setores.slice(0, 2).join(', ') || 'Demanda'} — ${logradouro}, ${bairro}`;

      const { data, error } = await supabase
        .from('indicacoes')
        .insert({
          gabinete_id: GABINETE_ID, titulo, bairro, logradouro, setores, classificacao,
          responsavel_nome: senderName, status: 'pendente', fonte: 'whatsapp',
        }).select('id').single();

      if (error || !data) throw error;
      return { success: true, id_curto: data.id.substring(0, 8).toUpperCase(), mensagem: "Criada no banco de dados." };
    }

    if (name === 'listar_indicacoes') {
      const resp = args.responsavel || senderName;
      const { data, error } = await supabase
        .from('indicacoes')
        .select('id, logradouro, bairro, status')
        .eq('gabinete_id', GABINETE_ID)
        .in('status', ['pendente', 'em_andamento'])
        .ilike('responsavel_nome', `%${resp}%`).limit(10);

      if (error || !data?.length) return { success: true, indicacoes: [], mensagem: "Nenhuma encontrada." };
      return { success: true, indicacoes: data.map((i: any) => ({ id_curto: i.id.substring(0,8).toUpperCase(), logradouro: i.logradouro, bairro: i.bairro, status: i.status })) };
    }

    if (name === 'protocolar_indicacao') {
      const { id_curto } = args;
      const { data: ind } = await supabase
        .from('indicacoes')
        .select('id, protocolado_em').eq('gabinete_id', GABINETE_ID).ilike('id', `${id_curto.toLowerCase()}%`).single();
        
      if (!ind) return { error: "Não encontrada." };
      if (ind.protocolado_em) return { error: "Já protocolada." };

      const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('supabase.co', 'vercel.app') ?? 'http://localhost:3000';
      
      const gerarRes = await fetch(`${baseUrl}/api/indicacoes/gerar-documento`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ indicacao_id: ind.id }),
      });
      const gerarData = await gerarRes.json();
      if (!gerarData.ok) return { error: "Extração falhou", detalhes: gerarData.error };

      const protRes = await fetch(`${baseUrl}/api/sapl/protocolar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ descricao: gerarData.ementa, tipo_sigla: 'IND' }),
      });
      const protData = await protRes.json();
      if (!protData.ok) return { error: "SAPL falhou", detalhes: protData.error };

      await supabase.from('indicacoes').update({
        protocolado_em: new Date().toISOString(),
        sapl_proposicao_id: protData.numero_proposicao,
        sapl_numero: `IND ${protData.numero_proposicao}/${new Date().getFullYear()}`, status: 'atendida',
      }).eq('id', ind.id);

      return { success: true, sapl: `IND ${protData.numero_proposicao}/${new Date().getFullYear()}`, url: protData.sapl_url, ementa: gerarData.ementa };
    }

    if (name === 'consultar_status') {
      const { id_curto } = args;
      const { data: ind } = await supabase
        .from('indicacoes')
        .select('status, protocolado_em, sapl_numero').eq('gabinete_id', GABINETE_ID).ilike('id', `${id_curto.toLowerCase()}%`).single();
      return ind ? { success: true, status: ind.status, protocolado: ind.protocolado_em, sapl_numero: ind.sapl_numero } : { error: "Não encontrada." };
    }

    if (name === 'consultar_cadin') {
      const { consulta, aniversariantes_hoje, aniversariantes_mes } = args;
      const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
      try {
        // ── Aniversariantes do dia ────────────────────────────────
        if (aniversariantes_hoje === true) {
          const now = new Date();
          const month = now.getMonth() + 1;
          const day = now.getDate();
          const res = await fetch(`${baseUrl}/api/cadin/birthdays?month=${month}&day=${day}`);
          if (!res.ok) return { error: 'CADIN indisponível' };
          const json = await res.json();
          const lista: Array<any> = json.birthdays ?? [];
          const dStr = `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`;
          if (!lista.length) return { success: true, mensagem: `Nenhum aniversariante hoje (${dStr}).`, aniversariantes: [] };
          const itens = lista.map((p: any) =>
            `• *${p.full_name}* — ${p.cargo || ''}${p.org_name ? ` (${p.org_name})` : ''}\n` +
            `  Tel: ${p.phone || p.org_phone || 'N/I'}${p.org_address ? ` | ${p.org_address}` : ''}`
          ).join('\n');
          return {
            success: true,
            mensagem: `🎂 Aniversariantes de hoje (${dStr}):\n\n${itens}`,
            aniversariantes: lista,
          };
        }

        // ── Aniversariantes do mês ────────────────────────────────
        // Robust: aceita number, string "4", ou fallback por nome do mês no consulta
        const MONTH_NAMES: Record<string, number> = {
          janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4,
          maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9,
          outubro: 10, novembro: 11, dezembro: 12,
        };

        let mesNum = aniversariantes_mes != null ? Number(aniversariantes_mes) : NaN;

        // Fallback: detecta nome do mês na consulta textual
        if (isNaN(mesNum) && consulta) {
          const cLower = consulta.toLowerCase();
          for (const [nome, num] of Object.entries(MONTH_NAMES)) {
            if (cLower.includes(nome)) { mesNum = num; break; }
          }
        }

        if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
          const res = await fetch(`${baseUrl}/api/cadin/birthdays?month=${mesNum}`);
          if (!res.ok) return { error: 'CADIN indisponível' };
          const json = await res.json();
          const lista: Array<any> = json.birthdays ?? [];
          const nomeMes = new Date(2000, mesNum - 1, 1).toLocaleString('pt-BR', { month: 'long' });
          if (!lista.length) return { success: true, mensagem: `Nenhum aniversariante em ${nomeMes}.`, aniversariantes: [] };
          const itens = lista.map((p: any) =>
            `• *${p.full_name}* (${p.birthday_display}) — ${p.cargo || ''}${p.org_name ? ` / ${p.org_name}` : ''}\n` +
            `  Tel: ${p.phone || p.org_phone || 'N/I'}`
          ).join('\n');
          return {
            success: true,
            mensagem: `🎂 Aniversariantes de ${nomeMes} (${lista.length}):\n\n${itens}`,
            aniversariantes: lista,
          };
        }

        // ── Busca textual padrão ──────────────────────────────────
        const res = await fetch(`${baseUrl}/api/cadin/organizations`);
        if (!res.ok) return { error: 'CADIN indisponível' };
        const orgs = await res.json() as Array<{ nomeOrgao: string; titularNome?: string; titularCargo?: string; phone?: string; email?: string; orgPhone?: string; orgAddress?: string }>;
        const q = (consulta || '').toLowerCase();
        const filtrados = orgs
          .filter(o =>
            o.nomeOrgao.toLowerCase().includes(q) ||
            o.titularNome?.toLowerCase().includes(q) ||
            o.titularCargo?.toLowerCase().includes(q)
          )
          .slice(0, 6)
          .map(o => ({
            orgao: o.nomeOrgao,
            titular: o.titularNome,
            cargo: o.titularCargo,
            telefone: o.phone || o.orgPhone || null,
            email: o.email || null,
            endereco: o.orgAddress || null,
          }));
        return { success: true, resultados: filtrados, total: filtrados.length };
      } catch {
        return { error: 'Erro ao consultar CADIN' };
      }
    }

    if (name === 'criar_oficio') {
      const { destinatario, assunto, corpo } = args;
      const data = new Date().toLocaleDateString('pt-BR');
      const minuta = `OFÍCIO Nº ___/${new Date().getFullYear()}\n\nBoa Vista/RR, ${data}\n\nAo(À) Excelentíssimo(a) Senhor(a)\n${destinatario}\n\nAssunto: ${assunto}\n\nExcelentíssimo(a) Senhor(a),\n\n${corpo}\n\nAtenciosamente,\n\nVereadora Carol Dantas\nCâmara Municipal de Boa Vista – RR`;
      return { success: true, minuta, instrucao: 'Minuta criada. Revisar e protocolar via sistema.' };
    }

    if (name === 'marcar_agenda') {
      const { titulo, data_inicio, data_fim, local, descricao, tipo = 'reuniao' } = args;
      const { data: evento, error } = await supabase
        .from('eventos')
        .insert({
          gabinete_id: GABINETE_ID,
          titulo,
          descricao: descricao || `Marcado via WhatsApp por ${senderName}`,
          tipo,
          data_inicio,
          data_fim: data_fim || null,
          local: local || null,
        })
        .select('id, data_inicio')
        .single();
      if (error || !evento) return { error: 'Falha ao criar evento na agenda.' };
      const dataFmt = new Date(evento.data_inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      return { success: true, id: evento.id, data_formatada: dataFmt, mensagem: `Evento "${titulo}" criado para ${dataFmt}.` };
    }

    if (name === 'gerar_parecer_relator') {
      const { materia_id, commission_sigla, voto = 'FAVORÁVEL' } = args;
      const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('supabase.co', 'vercel.app') ?? 'http://localhost:3000';
      
      const relator_nome = "Vereadora Carol Dantas";

      const gerarRes = await fetch(`${baseUrl}/api/pareceres/gerar-relator`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ materia_id, commission_sigla, relator_nome, voto, gabinete_id: GABINETE_ID }),
      });
      const gerarData = await gerarRes.json();
      if (!gerarRes.ok) return { error: "Falha ao gerar parecer", detalhes: gerarData.error || gerarData.details };

      return { 
        success: true, 
        mensagem: `Parecer gerado com sucesso para a comissão ${gerarData.commission}. O documento se encontra disponível no sistema.`, 
        parecer_gerado: gerarData.parecer_relator 
      };
    }

    if (name === 'gerar_caderno_pdf') {
      const { esfera = 'todos', tipo, cargo } = args;
      try {
        const supabase = getSupabase();
        
        // Montar params de filtro
        const params = new URLSearchParams();
        if (esfera && esfera !== 'todos') params.set('sphere', esfera);
        if (tipo) params.set('type', tipo);
        if (cargo) params.set('cargo', cargo);
        const qs = params.toString();

        // Verificar cache primeiro
        const crypto = await import('crypto');
        const sortedKey = Array.from(params.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v.toLowerCase()}`).join('&');
        const filterHash = crypto.createHash('md5').update(sortedKey || 'all').digest('hex');

        const { data: cached } = await supabase
          .from('cadin_pdf_cache')
          .select('pdf_public_url, authority_count, label')
          .eq('filter_hash', filterHash)
          .gt('expires_at', new Date().toISOString())
          .single();

        if (cached?.pdf_public_url) {
          // Cache hit!
          return {
            success: true,
            cache: true,
            mensagem: `📄 *${cached.label || 'Caderno de Autoridades'}*\n(${cached.authority_count} autoridades)\n\n✅ Documento já disponível (cache):\n${cached.pdf_public_url}`,
            download_url: cached.pdf_public_url,
            authority_count: cached.authority_count,
          };
        }

        // Cache miss — URL de geração
        const baseUrl = process.env.NEXTAUTH_URL ?? 'https://gabinete.wonetechnology.cloud';
        const publicUrl = `${baseUrl}/api/cadin/export-pdf${qs ? `?${qs}` : ''}`;

        // Descrição humanizada
        const descParts: string[] = [];
        if (cargo) descParts.push(cargo);
        if (tipo) {
          const LABELS: Record<string, string> = { secretaria: 'Secretarias', autarquia: 'Autarquias', fundacao: 'Fundações', prefeitura: 'Prefeituras', camara: 'Câmaras', judiciario: 'Judiciário', governo_estadual: 'Governo Estadual' };
          descParts.push(LABELS[tipo] || tipo);
        }
        if (esfera && esfera !== 'todos') descParts.push(esfera === 'estadual' ? 'Estaduais' : esfera === 'federal' ? 'Federais' : 'Municipais');
        const desc = descParts.length > 0 ? descParts.join(' · ') : 'Todas as autoridades';

        return {
          success: true,
          cache: false,
          mensagem: `📄 *Caderno de Autoridades — ${desc}*\n\nBaixe o PDF em:\n${publicUrl}\n\n_(O PDF será gerado e cacheado para futuras consultas)_`,
          download_url: publicUrl,
        };
      } catch {
        return { error: 'Falha ao gerar o Caderno PDF.' };
      }
    }

    return { error: "Ferramenta desconhecida" };
  } catch (err: any) {
    return { error: err.message };
  }
}


// Contexto de persona da ALIA (assessora virtual da vereadora)
const ALIA_SYSTEM_PROMPT = `Você é ALIA (Assessora Legislativa Inteligente e Autônoma), a assistente virtual do gabinete da Vereadora Carol Dantas, da Câmara Municipal de Boa Vista – RR (CMBV).

Seu papel é interagir de forma natural, profissional e ACOLHEDORA com a equipe e cidadãos pelo WhatsApp.

VOCÊ POSSUI AS SEGUINTES FERRAMENTAS AUTÔNOMAS:
- 'registrar_indicacao': quando alguém reportar problema urbano (buraco, iluminação, lixo, asfalto). Chame ANTES de responder. Informe o ID curto retornado.
- 'protocolar_indicacao': quando pedirem para protocolar uma indicação no SAPL. Sempre devolva o link.
- 'listar_indicacoes': quando pedirem lista de tarefas ou pendências.
- 'consultar_status': para verificar status de indicação pelo ID.
- 'consultar_cadin': quando perguntarem sobre secretaria, autoridade ou contato de órgão de RR/BV; ou pedirem aniversariantes do dia (aniversariantes_hoje=true) ou do mês (aniversariantes_mes=número).
- 'criar_oficio': quando solicitarem redigir um ofício para o Executivo. Retorne a minuta para revisão.
- 'marcar_agenda': quando solicitarem agendar reunião, compromisso ou evento para a Vereadora.
- 'gerar_caderno_pdf': quando pedirem o PDF do Caderno de Autoridades. Aceita filtros: esfera (federal/estadual/municipal), tipo de órgão (secretaria/autarquia/etc) e cargo (Secretário/Governador/etc). Pode gerar cadernos parciais como 'somente secretários de estado' ou 'autarquias estaduais'. Os PDFs são cacheados por 24h.
- 'gerar_parecer_relator': quando solicitarem a redação de um voto ou parecer de relatoria para uma matéria legislativa, especificando a comissão e opcionalmente o voto.

Regras:
- NUNCA invente dados de SAPL, IDs ou contatos — use sempre as ferramentas.
- Pode encadear múltiplas ferramentas na mesma conversa (ex: consultar CADIN e depois criar ofício).
- Assine sempre: *ALIA — Gabinete Vereadora Carol Dantas*`;

interface EvolutionMessage {
  event: string;
  instance: string;
  data?: {
    key?: {
      remoteJid?: string;
      fromMe?: boolean;
      id?: string;
    };
    message?: any;
    messageType?: string;
    pushName?: string;
    base64?: string; // Algumas versões da Evolution colocam no root do data
  };
}

function extractText(msg: EvolutionMessage): string {
  const message = msg.data?.message;
  if (!message) return '';
  
  const type = msg.data?.messageType;
  if (type === 'imageMessage') return message.imageMessage?.caption || '';
  if (type === 'videoMessage') return message.videoMessage?.caption || '';
  if (type === 'documentMessage') return message.documentMessage?.caption || message.documentMessage?.fileName || '';
  if (type === 'audioMessage') return '(Áudio Recebido)';

  return message.conversation || message.extendedTextMessage?.text || '';
}

async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gabinete-carol';

  if (!url || !key) return false;

  try {
    const res = await fetch(`${url}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
      },
      body: JSON.stringify({
        number: to,
        text,
        delay: 1000,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Buscar base64 de mídia via Evolution API ───────────────────────────────

async function fetchMediaBase64(messageId: string): Promise<{ base64: string; mimeType: string } | null> {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gabinete-carol';
  if (!evoUrl || !evoKey || !messageId) return null;
  try {
    const res = await fetch(`${evoUrl}/message/getBase64FromMediaMessage/${instance}/${messageId}`, {
      headers: { apikey: evoKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.base64) return null;
    return { base64: data.base64, mimeType: data.mimetype || 'audio/ogg' };
  } catch {
    return null;
  }
}

// ── Helpers de sessão LAIA ─────────────────────────────────────────────────

async function obterOuCriarSessao(telefone: string, nomeContato: string): Promise<string> {
  const supabase = getSupabase();
  const telefoneLimpo = telefone.replace('@s.whatsapp.net', '');

  // Buscar sessão ativa ou em takeover para este telefone
  const { data: existente } = await supabase
    .from('laia_sessions')
    .select('id, status')
    .eq('gabinete_id', GABINETE_ID)
    .eq('canal', 'whatsapp')
    .eq('telefone', telefoneLimpo)
    .neq('status', 'encerrada')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existente) {
    // Atualizar nome do contato e timestamp
    await supabase
      .from('laia_sessions')
      .update({ contato_nome: nomeContato, ultima_msg_em: new Date().toISOString() })
      .eq('id', existente.id);
    return existente.id;
  }

  // Criar nova sessão
  const { data: nova } = await supabase
    .from('laia_sessions')
    .insert({
      gabinete_id: GABINETE_ID,
      canal: 'whatsapp',
      agente: 'laia',
      telefone: telefoneLimpo,
      contato_nome: nomeContato,
      status: 'ativa',
    })
    .select('id')
    .single();

  return nova?.id ?? '';
}

async function salvarMensagem(sessionId: string, role: 'user' | 'assistant', content: string, metadata?: Record<string, unknown>) {
  if (!sessionId) return;
  const supabase = getSupabase();
  await supabase.from('laia_messages').insert({
    session_id: sessionId,
    role,
    content,
    metadata: metadata ?? {},
  });
  await supabase
    .from('laia_sessions')
    .update({ ultima_msg_em: new Date().toISOString() })
    .eq('id', sessionId);
}

// ──────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: EvolutionMessage;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 });
  }

  // Só processa eventos de mensagem recebida
  if (body.event !== 'messages.upsert' && body.event !== 'MESSAGES_UPSERT') {
    return NextResponse.json({ ok: true, skipped: 'not a message event' });
  }

  const key = body.data?.key;
  const remoteJid = key?.remoteJid;
  const fromMe = key?.fromMe;

  // Ignora mensagens enviadas pelo próprio bot e mensagens de grupos
  if (fromMe || !remoteJid || remoteJid.endsWith('@g.us')) {
    return NextResponse.json({ ok: true, skipped: 'own message or group' });
  }

  const messageType = body.data?.messageType;
  const text = extractText(body);
  let base64Raw: string | undefined = body.data?.message?.base64 || body.data?.base64;

  // Para áudios sem base64 inline, busca via Evolution API
  let fetchedMimeType: string | undefined;
  if (messageType === 'audioMessage' && !base64Raw && key?.id) {
    const fetched = await fetchMediaBase64(key.id);
    if (fetched) { base64Raw = fetched.base64; fetchedMimeType = fetched.mimeType; }
  }

  const isMultimodal = !!base64Raw;

  if (!text && !isMultimodal) {
    return NextResponse.json({ ok: true, skipped: 'no text or media content' });
  }

  const senderName = body.data?.pushName || 'Cidadão';

  // ── Obter ou criar sessão LAIA ──────────────────────────────
  const sessionId = await obterOuCriarSessao(remoteJid, senderName).catch(() => '');

  // ── VERIFICAR TAKEOVER HUMANO ───────────────────────────────
  // Se um assessor assumiu esta conversa, apenas registra a mensagem
  // no histórico e NÃO responde automaticamente. O assessor vê em tempo real.
  if (sessionId) {
    const supabase = getSupabase();
    const { data: sessao } = await supabase
      .from('laia_sessions')
      .select('status')
      .eq('id', sessionId)
      .single();

    if (sessao?.status === 'humano') {
      // Registrar mensagem do usuário para o assessor ver no monitor
      await salvarMensagem(sessionId, 'user', text, { remoteJid, evolution_key: key?.id });
      return NextResponse.json({ ok: true, skipped: 'human_takeover', session_id: sessionId });
    }
  }

  // Registrar mensagem do usuário no histórico da sessão
  if (sessionId) {
    await salvarMensagem(sessionId, 'user', text || '(Mídia enviada)', { remoteJid, evolution_key: key?.id }).catch(() => null);
  }

  // ── INICIANDO A IA E O LOOP DE FERRAMENTAS (FUNCTIONS) ────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  let replyText = '';
  let geminiOk = false;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: ALIA_SYSTEM_PROMPT,
      tools: aliaTools as any, // Injeta as functions declaradas
      generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
    });

    let userPromptParts: any[] = [];
    
    // Tratamento Multimodal Se Houver Mídia (Imagem, Audio, etc)
    if (base64Raw && typeof base64Raw === 'string') {
      let mimeType = 'image/jpeg';
      if (messageType === 'imageMessage') mimeType = body.data?.message?.imageMessage?.mimetype || 'image/jpeg';
      if (messageType === 'audioMessage') mimeType = fetchedMimeType || body.data?.message?.audioMessage?.mimetype || 'audio/ogg';
      if (messageType === 'documentMessage') mimeType = body.data?.message?.documentMessage?.mimetype || 'application/pdf';

      let dataToGemini = base64Raw;
      if (dataToGemini.startsWith('data:')) {
        dataToGemini = dataToGemini.split(',')[1];
      }

      userPromptParts.push({
        inlineData: { data: dataToGemini, mimeType }
      });

      // ── Upload da Mídia para o Bucket Supabase (Opcional/Backup Visual)
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supa = createClient(supabaseUrl, supabaseKey);
        
        const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
        const buffer = Buffer.from(dataToGemini, 'base64');
        const filename = `${GABINETE_ID}/${Date.now()}_${key?.id || 'media'}.${ext}`;
        
        await supa.storage.from('gabinete_media').upload(filename, buffer, { contentType: mimeType });
      } catch (e) {
        console.error('[ALIA] Erro ao subir media para storage:', e);
      }
    }

    userPromptParts.push({ text: `Mensagem via WhatsApp recebida de ${senderName}:\n"${text || '(Áudio/Mídia sem legenda)'}"` });

    const chat = model.startChat();
    let currentResult = await chat.sendMessage(userPromptParts);

    // Agentic loop — suporta múltiplas chamadas de ferramentas em sequência
    let maxTurns = 5;
    while (maxTurns-- > 0) {
      const calls = currentResult.response.functionCalls() ?? [];
      if (calls.length === 0) {
        replyText = currentResult.response.text().trim();
        break;
      }
      // Executa todas as chamadas em paralelo e devolve os resultados ao Gemini
      const responses = await Promise.all(
        calls.map(async (call) => {
          const funcResult = await executeLocalFunction(call.name, call.args as Record<string, any>, senderName);
          return { functionResponse: { name: call.name, response: funcResult } };
        })
      );
      currentResult = await chat.sendMessage(responses);
    }

    if (!replyText) replyText = currentResult.response.text().trim() || 'Processamento concluído.';
    
    geminiOk = true;
  } catch (err) {
    console.error('[ALIA webhook] Gemini/Agentic loop error:', err);
    replyText = `Olá, ${senderName}! Recebi sua mensagem, mas meu sistema interno está offline neste momento. ⏱️\n\n*ALIA*`;
  }

  // Envia resposta WhatsApp
  const sent = await sendWhatsAppMessage(remoteJid, replyText);

  // Registrar resposta da IA na sessão LAIA (para o monitor)
  if (sessionId && replyText) {
    await salvarMensagem(sessionId, 'assistant', replyText, {
      gemini_ok: geminiOk,
      model: 'gemini-2.5-flash',
    }).catch(() => null);
  }

  // Salva log no Supabase
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const gabineteId = process.env.GABINETE_ID;

      await supabase.from('cadin_cia_logs').insert({
        gabinete_id: gabineteId || null,
        person_id: null,
        phone: remoteJid.replace('@s.whatsapp.net', ''),
        contact_name: senderName,
        prompt_used: text.substring(0, 500),
        message_sent: replyText.substring(0, 1000),
        status: sent ? 'sent' : 'error',
        evolution_response: sent ? { ok: true } : { ok: false },
      });
    }
  } catch (logErr) {
    console.error('[ALIA webhook] log error:', logErr);
  }

  return NextResponse.json({
    ok: true,
    gemini_ok: geminiOk,
    whatsapp_sent: sent,
    reply_length: replyText.length,
  });
}
