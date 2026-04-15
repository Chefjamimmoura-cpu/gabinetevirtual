/**
 * Sistema de permissões granulares por módulo.
 * Cada módulo do app tem uma flag boolean no JSONB permissions do profile.
 */

export const ALL_MODULES = [
  { id: 'dashboard',     label: 'Dashboard',       description: 'Painel de resumo e métricas' },
  { id: 'pareceres',     label: 'Pareceres',       description: 'Consultar e gerar pareceres' },
  { id: 'agenda',        label: 'Agenda',           description: 'Visualizar e criar eventos' },
  { id: 'pls',           label: 'Projetos de Lei',  description: 'Consultar e acompanhar PLs' },
  { id: 'indicacoes',    label: 'Indicações',       description: 'Criar e gerenciar indicações' },
  { id: 'oficios',       label: 'Ofícios',          description: 'Criar e gerenciar ofícios' },
  { id: 'cadin',         label: 'CADIN',            description: 'Consultar e manipular CADIN' },
  { id: 'sessoes',       label: 'Transcrições',     description: 'Transcrições e atas de sessões' },
  { id: 'alia',          label: 'Assistente ALIA',   description: 'Usar IA assistente (ALIA/LAIA)' },
  { id: 'configuracoes',    label: 'Configurações',    description: 'Configurações do gabinete' },
  { id: 'whatsapp_config', label: 'Config WhatsApp',  description: 'Configurações de integração WhatsApp' },
] as const;

export type ModuleId = typeof ALL_MODULES[number]['id'];

export type Permissions = Record<ModuleId, boolean>;

/** Permissões padrão: tudo liberado */
export function fullPermissions(): Permissions {
  return Object.fromEntries(ALL_MODULES.map(m => [m.id, true])) as Permissions;
}

/** Permissões padrão para visitante: tudo bloqueado */
export function emptyPermissions(): Permissions {
  return Object.fromEntries(ALL_MODULES.map(m => [m.id, false])) as Permissions;
}

/** Verifica se o usuário tem acesso a um módulo */
export function hasPermission(permissions: Partial<Permissions> | null | undefined, moduleId: string): boolean {
  if (!permissions) return false;
  return permissions[moduleId as ModuleId] === true;
}

/** Labels amigáveis para cada role */
export const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Administrador',
  admin: 'Assessor(a) Administrativo',
  vereador: 'Vereadora',
  assessor: 'Assessor(a)',
  visitante: 'Visitante',
};

/** Descrições curtas para cada role */
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  superadmin: 'Acesso total ao sistema + painel de controle mestre',
  admin: 'Gestão do gabinete, equipe e configurações',
  vereador: 'Acesso máximo dentro do gabinete',
  assessor: 'Leitura e escrita nos módulos liberados',
  visitante: 'Acesso restrito — apenas módulos selecionados',
};

/** Todos os roles disponíveis, em ordem hierárquica */
export const ROLE_OPTIONS = ['superadmin', 'vereador', 'admin', 'assessor', 'visitante'] as const;

/** Roles que têm acesso total independente de permissions */
export const FULL_ACCESS_ROLES = ['superadmin', 'admin', 'vereador', 'assessor'];

/** Verifica se o role tem acesso total (ignora permissions) */
export function hasFullAccess(role: string): boolean {
  return FULL_ACCESS_ROLES.includes(role);
}
