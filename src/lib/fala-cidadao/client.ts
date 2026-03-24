// ============================================================
// Fala Cidadão Client — USO ÚNICO para importação dos dados
// históricos para o nosso sistema. Após a importação, o Fala
// Cidadão não é mais utilizado.
// ============================================================

const FC_API = process.env.FALA_CIDADAO_API_URL ?? 'https://api.prd.impacto.caroldantas.rr.cidadao.me';
const FC_APP_KEY = process.env.FALA_CIDADAO_APP_KEY ?? '';
const FC_LOGIN = process.env.FALA_CIDADAO_LOGIN ?? '';
const FC_PASSWORD = process.env.FALA_CIDADAO_PASSWORD ?? '';

// Serviço de indicação parlamentar no Fala Cidadão
const FC_SERVICE_ID = '1000000000';

// Cache de token em memória (válido por ~50 minutos)
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export interface SolicitacaoFC {
  id: string;
  slug: string;
  created_at: string;
  status: 'PENDING' | 'INVESTIGATING' | 'ACCEPTED' | 'REJECTED';
  service_name: string;
  requester_name: string;
  requester_cpf_number: string;
  responsible_person_id: string | null;
  dw_synced_at: string | null;
  transmitted_at: string | null;
  resolved_at: string | null;
  document_id: string | null;
  file_id: string | null;
  file_extension: string | null;
  // Campos extraídos do JSON de descrição
  _bairro?: string;
  _logradouro?: string;
  _setores?: string[];
  _responsavel?: string;
  _classificacao?: string;
  _observacoes?: string;
  _fotos?: string[];
}

interface FCListResponse {
  header: { success: boolean; message: string };
  body: {
    service_request: {
      elements: SolicitacaoFC[];
      totalElements: number;
      totalPages: number;
      currentPage: number;
      limit: number;
    };
  };
}

interface FCAuthResponse {
  header: { success: boolean };
  body: { usrtkn?: { jwt_token: string } };
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(`${FC_API}/auth/person-auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'appkey': FC_APP_KEY,
    },
    body: JSON.stringify({ login: FC_LOGIN, password: FC_PASSWORD }),
  });

  if (!res.ok) throw new Error(`Fala Cidadão auth falhou: ${res.status}`);
  const data = await res.json() as FCAuthResponse;
  const token = data.body?.usrtkn?.jwt_token;
  if (!token) throw new Error('Token JWT não retornado pelo Fala Cidadão');

  cachedToken = token;
  tokenExpiresAt = Date.now() + 50 * 60 * 1000; // 50 min
  return token;
}

// Campos do formulário: profissional responsavel = campo id ~1 no form
// O description.answers contém os campos preenchidos
function parseDescription(description: string | null): Partial<SolicitacaoFC> {
  if (!description) return {};
  try {
    // description pode ser JSON string com {request_id, automations, answers?}
    // ou pode ser o texto da ementa diretamente
    const parsed = JSON.parse(description);
    if (parsed && typeof parsed === 'object') {
      // Extrair os campos do formulário se existirem como answers
      const answers = parsed.answers ?? parsed;
      return {
        _bairro: answers.bairro_da_indicacao ?? answers.bairro ?? undefined,
        _logradouro: answers.logradouro_da_indicacao ?? answers.logradouro ?? undefined,
        _responsavel: answers.profissional_responsavel_pela_indicacao ?? answers.responsavel ?? undefined,
        _classificacao: answers.classificacao ? String(answers.classificacao).toLowerCase() : undefined,
        _observacoes: answers.informacoes_adicionais ?? answers.observacoes ?? undefined,
        _setores: Array.isArray(answers.setor_que_necessita_de_atencao)
          ? answers.setor_que_necessita_de_atencao
          : answers.setores
            ? [answers.setores]
            : undefined,
      };
    }
  } catch {
    // descrição não é JSON
  }
  return {};
}

export async function listSolicitacoes(page = 1, pageSize = 100): Promise<{
  items: SolicitacaoFC[];
  total: number;
  totalPages: number;
}> {
  const token = await getToken();

  const res = await fetch(`${FC_API}/regulation/panel/service-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'appkey': FC_APP_KEY,
      'authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      filters: {},
      pagination: { page, pageSize },
      ordering: [{ field: 'created_at', order: 'DESC' }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Fala Cidadão listSolicitacoes falhou: ${res.status} — ${txt.substring(0, 200)}`);
  }

  const data = await res.json() as FCListResponse;
  const sr = data.body?.service_request;
  const items = (sr?.elements ?? []).map(item => ({
    ...item,
    ...parseDescription((item as unknown as Record<string, unknown>).description as string ?? null),
  }));

  return {
    items,
    total: sr?.totalElements ?? 0,
    totalPages: sr?.totalPages ?? 1,
  };
}

export async function getAllSolicitacoes(): Promise<SolicitacaoFC[]> {
  const all: SolicitacaoFC[] = [];
  let page = 1;

  const first = await listSolicitacoes(1, 100);
  all.push(...first.items);

  const totalPages = first.totalPages;
  for (page = 2; page <= totalPages; page++) {
    const { items } = await listSolicitacoes(page, 100);
    all.push(...items);
    // rate-limit gentil
    await new Promise(r => setTimeout(r, 300));
  }

  return all;
}
