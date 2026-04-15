import Topbar from '@/components/topbar';
import { createClient } from '@supabase/supabase-js';
import {
  FileText,
  Users,
  Calendar,
  ScrollText,
  MapPin,
  Mail,
  BookUser,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  Clock,
  Cake,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import styles from './page.module.css';
import { PareceresAlertCards } from '@/components/pareceres-core/pareceres-alert-cards';
import type { ParecerAlertas } from '@/components/pareceres-core/pareceres-alert-cards';
import { COMISSOES_CMBV } from '@/lib/parecer/prompts-relator';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface DashboardSummary {
  pareceres:    { total_semana: number; ultima_sessao: string | null; ultima_data: string | null };
  indicacoes:   { pendentes: number; whatsapp: number };
  laia:         { sessoes_ativas: number; aguardando_humano: number };
  cadin:        { updates_pendentes: number; aniversariantes_hoje: { nome: string; cargo: string | null }[] };
  agenda:       { eventos_hoje: { titulo: string; tipo: string; hora: string | null }[] };
  sessoes_sapl: { count: number; proxima: string | null };
  parecer_alertas: ParecerAlertas | null;
}

// ─── Fetch de dados no servidor ───────────────────────────────────────────────

async function fetchSummary(): Promise<DashboardSummary> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const GABINETE_ID = process.env.GABINETE_ID!;

  const hoje = new Date();
  const hojeStr = hoje.toISOString().split('T')[0];
  const semanaAtras = new Date(hoje);
  semanaAtras.setDate(semanaAtras.getDate() - 7);
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');

  const [
    pareceresRes,
    indicacoesPendRes,
    indicacoesWaRes,
    laiaAtivasRes,
    laiaHumanoRes,
    cadinPendRes,
    aniversariantesRes,
    eventosRes,
    sessoesRes,
    alertMateriasRes,
    alertRascunhosRes,
    alertPendenciasRes,
  ] = await Promise.allSettled([
    db.from('pareceres_historico')
      .select('sessao_str, data_sessao')
      .eq('gabinete_id', GABINETE_ID)
      .gte('gerado_em', semanaAtras.toISOString())
      .order('gerado_em', { ascending: false }),

    db.from('indicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('status', 'pendente'),

    db.from('indicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('fonte', 'whatsapp'),

    db.from('laia_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('status', 'ativa'),

    db.from('laia_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('status', 'humano'),

    db.from('cadin_pending_updates')
      .select('id', { count: 'exact', head: true })
      .eq('gabinete_id', GABINETE_ID)
      .eq('status', 'pendente'),

    db.from('cadin_persons')
      .select('full_name, notes, cadin_appointments(title, active)')
      .like('notes', `%Aniversário: ${mes}-${dia}%`),

    db.from('eventos')
      .select('titulo, tipo, data_inicio')
      .eq('gabinete_id', GABINETE_ID)
      .gte('data_inicio', `${hojeStr}T00:00:00`)
      .lte('data_inicio', `${hojeStr}T23:59:59`)
      .order('data_inicio', { ascending: true }),

    db.from('sapl_sessoes_cache')
      .select('data_sessao, numero')
      .not('upload_pauta', 'is', null)
      .order('data_sessao', { ascending: false })
      .limit(5),

    // 10. Matérias recentes no cache (para alertas de pareceres)
    db.from('sapl_materias_cache')
      .select('id, tramitacoes_json')
      .eq('gabinete_id', GABINETE_ID)
      .gte('last_synced_at', semanaAtras.toISOString()),

    // 11. Rascunhos de relator (para excluir do count)
    db.from('pareceres_relator')
      .select('materia_id')
      .eq('gabinete_id', GABINETE_ID),

    // 12. Pareceres de comissão pendentes
    db.from('comissao_pareceres')
      .select('id, workflow_status, created_at, updated_at')
      .eq('gabinete_id', GABINETE_ID)
      .not('workflow_status', 'in', '("assinado","publicado")'),
  ]);

  const pareceres      = pareceresRes.status      === 'fulfilled' ? (pareceresRes.value.data      ?? []) : [];
  const indicacoesPend = indicacoesPendRes.status === 'fulfilled' ? (indicacoesPendRes.value.count ?? 0) : 0;
  const indicacoesWa   = indicacoesWaRes.status   === 'fulfilled' ? (indicacoesWaRes.value.count   ?? 0) : 0;
  const laiaAtivas     = laiaAtivasRes.status      === 'fulfilled' ? (laiaAtivasRes.value.count      ?? 0) : 0;
  const laiaHumano     = laiaHumanoRes.status      === 'fulfilled' ? (laiaHumanoRes.value.count      ?? 0) : 0;
  const cadinPend      = cadinPendRes.status        === 'fulfilled' ? (cadinPendRes.value.count        ?? 0) : 0;
  const aniversariantes = aniversariantesRes.status === 'fulfilled' ? (aniversariantesRes.value.data ?? []) : [];
  const eventos         = eventosRes.status          === 'fulfilled' ? (eventosRes.value.data         ?? []) : [];
  const sessoes         = sessoesRes.status           === 'fulfilled' ? (sessoesRes.value.data          ?? []) : [];
  const alertMaterias   = alertMateriasRes.status     === 'fulfilled' ? (alertMateriasRes.value.data    ?? []) : [];
  const alertRascunhos  = alertRascunhosRes.status    === 'fulfilled' ? (alertRascunhosRes.value.data   ?? []) : [];
  const alertPendencias = alertPendenciasRes.status   === 'fulfilled' ? (alertPendenciasRes.value.data  ?? []) : [];

  let proximaSessao: string | null = null;
  if (sessoes.length > 0) {
    const s = sessoes[0] as { data_sessao: string; numero: number };
    const d = new Date(`${s.data_sessao}T12:00:00`);
    proximaSessao = `Sessão ${s.numero} — ${d.toLocaleDateString('pt-BR')}`;
  }

  // ── Alertas de pareceres ───────────────────────────────────────────────────
  let parecer_alertas: ParecerAlertas | null = null;
  {
    // IDs de matérias que já têm rascunho de relator
    const idsComRascunho = new Set(
      alertRascunhos.map((r: { materia_id: number }) => r.materia_id),
    );

    // Contar matérias novas por comissão (via keywords nas tramitações)
    const porComissaoMap = new Map<string, { sigla: string; nome: string; count: number }>();
    for (const mat of alertMaterias as { id: number; tramitacoes_json: string | null }[]) {
      if (idsComRascunho.has(mat.id)) continue;
      const tramStr = mat.tramitacoes_json ?? '';
      for (const comissao of COMISSOES_CMBV) {
        const matched = comissao.keywords?.some((kw) =>
          tramStr.toLowerCase().includes(kw.toLowerCase()),
        );
        if (matched) {
          const existing = porComissaoMap.get(comissao.sigla);
          if (existing) {
            existing.count++;
          } else {
            porComissaoMap.set(comissao.sigla, {
              sigla: comissao.sigla,
              nome: comissao.nome,
              count: 1,
            });
          }
          break; // uma matéria conta apenas na primeira comissão que bater
        }
      }
    }
    const porComissao = Array.from(porComissaoMap.values()).sort((a, b) => b.count - a.count);
    const totalMateriasNovas = porComissao.reduce((s, c) => s + c.count, 0);

    // Ordem do dia: usar a sessão mais recente (já carregada)
    let ordemDoDia: ParecerAlertas['ordem_do_dia'] = null;
    if (sessoes.length > 0) {
      const s = sessoes[0] as { data_sessao: string; numero: number };
      // Contar matérias nessa sessão (simplificado: usar count de matérias no cache)
      ordemDoDia = {
        sessao_id: 0, // sem ID direto no cache, usar número como fallback
        numero: String(s.numero),
        data: s.data_sessao,
        total_materias: alertMaterias.length,
      };
    }

    // Pendências de comissão
    const now = Date.now();
    let emRascunho = 0;
    let aguardandoAssinatura = 0;
    let semParecer = 0;
    let criticos = 0;
    let maisAntigoDias = 0;

    for (const p of alertPendencias as { id: number; workflow_status: string; created_at: string; updated_at: string }[]) {
      if (p.workflow_status === 'rascunho') emRascunho++;
      else if (p.workflow_status === 'aguardando_assinatura') aguardandoAssinatura++;
      else semParecer++;

      const dias = Math.floor((now - new Date(p.created_at).getTime()) / 86_400_000);
      if (dias > maisAntigoDias) maisAntigoDias = dias;
      if (dias > 7) criticos++;
    }

    const totalPendencias = alertPendencias.length;

    // Montar alerta se houver algo relevante
    if (totalMateriasNovas > 0 || ordemDoDia || totalPendencias > 0) {
      parecer_alertas = {
        materias_novas: {
          total: totalMateriasNovas,
          por_comissao: porComissao,
          desde: semanaAtras.toISOString().split('T')[0],
        },
        ordem_do_dia: ordemDoDia,
        pendencias: {
          total: totalPendencias,
          em_rascunho: emRascunho,
          aguardando_assinatura: aguardandoAssinatura,
          sem_parecer: semParecer,
          criticos,
          mais_antigo_dias: maisAntigoDias,
        },
      };
    }
  }

  return {
    pareceres: {
      total_semana:  pareceres.length,
      ultima_sessao: (pareceres[0] as { sessao_str?: string } | undefined)?.sessao_str ?? null,
      ultima_data:   (pareceres[0] as { data_sessao?: string } | undefined)?.data_sessao ?? null,
    },
    indicacoes: { pendentes: indicacoesPend, whatsapp: indicacoesWa },
    laia: { sessoes_ativas: laiaAtivas, aguardando_humano: laiaHumano },
    cadin: {
      updates_pendentes: cadinPend,
      aniversariantes_hoje: aniversariantes.slice(0, 5).map((p) => {
        const person = p as { full_name: string; cadin_appointments?: { title: string; active: boolean }[] };
        const appt = person.cadin_appointments?.find((a) => a.active);
        return { nome: person.full_name, cargo: appt?.title ?? null };
      }),
    },
    agenda: {
      eventos_hoje: eventos.map((e) => {
        const ev = e as { titulo: string; tipo: string; data_inicio: string };
        const hora = ev.data_inicio
          ? new Date(ev.data_inicio).toLocaleTimeString('pt-BR', {
              hour: '2-digit', minute: '2-digit', timeZone: 'America/Boa_Vista',
            })
          : null;
        return { titulo: ev.titulo, tipo: ev.tipo, hora };
      }),
    },
    sessoes_sapl: { count: sessoes.length, proxima: proximaSessao },
    parecer_alertas,
  };
}

// ─── Helpers de formatação ────────────────────────────────────────────────────

const TIPO_LABEL: Record<string, string> = {
  sessao_plenaria:  'Plenária',
  reuniao_comissao: 'Comissão',
  agenda_externa:   'Externo',
  reuniao:          'Reunião',
  outro:            'Outro',
};

const TIPO_COLOR: Record<string, string> = {
  sessao_plenaria:  '#6366f1',
  reuniao_comissao: '#10b981',
  agenda_externa:   '#f59e0b',
  reuniao:          '#8b5cf6',
  outro:            '#6b7280',
};

// ─── Módulos de acesso rápido ─────────────────────────────────────────────────

const MODULES = [
  { label: 'Pareceres',        icon: FileText,      href: '/pareceres', desc: 'Gerar pareceres legislativos com IA',       color: '#6366f1' },
  { label: 'Comissões',        icon: Users,         href: '/comissoes', desc: 'Gestão de comissões e votações',            color: '#10b981' },
  { label: 'Agenda',           icon: Calendar,      href: '/agenda',    desc: 'Calendário legislativo unificado',          color: '#f59e0b' },
  { label: 'Projetos de Lei',  icon: ScrollText,    href: '/pls',       desc: 'Criação assistida de PLs',                  color: '#488DC7' },
  { label: 'Indicações',       icon: MapPin,        href: '/indicacoes', desc: 'Tracking de demandas cidadãs',             color: '#ef4444' },
  { label: 'Ofícios',          icon: Mail,          href: '/oficios',   desc: 'Geração rápida de ofícios',                 color: '#8b5cf6' },
  { label: 'CADIN',            icon: BookUser,      href: '/cadin',     desc: 'Cadastro de autoridades e contatos',        color: '#06b6d4' },
  { label: 'ALIA',             icon: MessageSquare, href: '/laia',      desc: 'Central de atendimento via WhatsApp',       color: '#ec4899' },
];

// ─── Página ───────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'; // sempre renderiza no servidor em runtime

export default async function DashboardPage() {
  const data = await fetchSummary();
  const { pareceres, indicacoes, laia, cadin, agenda, sessoes_sapl, parecer_alertas } = data;

  const temAlertas = indicacoes.pendentes > 0 || laia.aguardando_humano > 0 || cadin.updates_pendentes > 0 || parecer_alertas !== null;
  const temAniversariantes = cadin.aniversariantes_hoje.length > 0;

  return (
    <>
      <Topbar title="Gabinete Virtual" subtitle="Painel de gestão parlamentar" />
      <div className={styles.content}>

        {/* ── Barra de alertas (condicional) ─────────────────────────────── */}
        {temAlertas && (
          <section className={styles.alertBanner}>
            {parecer_alertas && (
              <PareceresAlertCards
                dados={parecer_alertas}
                modo="dashboard"
                alertCardClass={styles.alertCard}
              />
            )}
            {indicacoes.pendentes > 0 && (
              <Link href="/indicacoes" className={styles.alertCard} style={{ '--alert-color': '#ef4444' } as React.CSSProperties}>
                <AlertTriangle size={16} />
                <span>
                  <strong>{indicacoes.pendentes}</strong>{' '}
                  {indicacoes.pendentes === 1 ? 'indicação aguardando' : 'indicações aguardando'} moderação
                </span>
                <ArrowRight size={14} />
              </Link>
            )}
            {laia.aguardando_humano > 0 && (
              <Link href="/laia" className={styles.alertCard} style={{ '--alert-color': '#ec4899' } as React.CSSProperties}>
                <AlertTriangle size={16} />
                <span>
                  <strong>{laia.aguardando_humano}</strong>{' '}
                  {laia.aguardando_humano === 1 ? 'conversa aguardando' : 'conversas aguardando'} atendimento humano
                </span>
                <ArrowRight size={14} />
              </Link>
            )}
            {cadin.updates_pendentes > 0 && (
              <Link href="/cadin" className={styles.alertCard} style={{ '--alert-color': '#f59e0b' } as React.CSSProperties}>
                <AlertTriangle size={16} />
                <span>
                  <strong>{cadin.updates_pendentes}</strong>{' '}
                  {cadin.updates_pendentes === 1 ? 'atualização CADIN pendente' : 'atualizações CADIN pendentes'} de revisão
                </span>
                <ArrowRight size={14} />
              </Link>
            )}
          </section>
        )}

        {/* ── Cards de métricas reais ─────────────────────────────────────── */}
        <section className={styles.statsGrid}>
          {/* Pareceres */}
          <div className={`glass-card stat-card ${styles.statItem}`}>
            <div className={styles.statHeader}>
              <FileText size={20} style={{ color: '#6366f1' }} />
              {pareceres.total_semana > 0
                ? <CheckCircle size={14} style={{ color: 'var(--success-500)' }} />
                : <Clock size={14} style={{ color: 'var(--gray-400)' }} />
              }
            </div>
            <div className="stat-value">{pareceres.total_semana}</div>
            <div className="stat-label">Pareceres esta semana</div>
            <div className={styles.statTrend}>
              {pareceres.ultima_sessao
                ? `Último: ${pareceres.ultima_sessao.split('(')[0].trim()}`
                : 'Nenhum gerado esta semana'}
            </div>
          </div>

          {/* Indicações */}
          <div className={`glass-card stat-card ${styles.statItem}`}>
            <div className={styles.statHeader}>
              <MapPin size={20} style={{ color: '#ef4444' }} />
              {indicacoes.pendentes > 0
                ? <AlertTriangle size={14} style={{ color: '#ef4444' }} />
                : <CheckCircle size={14} style={{ color: 'var(--success-500)' }} />
              }
            </div>
            <div className="stat-value">{indicacoes.pendentes}</div>
            <div className="stat-label">Indicações pendentes</div>
            <div className={styles.statTrend}>
              {indicacoes.whatsapp > 0
                ? `${indicacoes.whatsapp} via WhatsApp`
                : 'Nenhuma nova via WhatsApp'}
            </div>
          </div>

          {/* ALIA */}
          <div className={`glass-card stat-card ${styles.statItem}`}>
            <div className={styles.statHeader}>
              <MessageSquare size={20} style={{ color: '#ec4899' }} />
              {laia.aguardando_humano > 0
                ? <AlertTriangle size={14} style={{ color: '#ec4899' }} />
                : <CheckCircle size={14} style={{ color: 'var(--success-500)' }} />
              }
            </div>
            <div className={styles.statValueRow}>
              <div className="stat-value">{laia.sessoes_ativas}</div>
              {laia.aguardando_humano > 0 && (
                <span className={styles.badgeAlerta}>{laia.aguardando_humano} aguardando</span>
              )}
            </div>
            <div className="stat-label">Sessões ALIA ativas</div>
            <div className={styles.statTrend}>
              {laia.aguardando_humano > 0
                ? `${laia.aguardando_humano} ${laia.aguardando_humano === 1 ? 'precisa' : 'precisam'} de atendimento`
                : 'Todas gerenciadas pela IA'}
            </div>
          </div>

          {/* Próxima sessão plenária */}
          <div className={`glass-card stat-card ${styles.statItem}`}>
            <div className={styles.statHeader}>
              <Calendar size={20} style={{ color: '#f59e0b' }} />
              {sessoes_sapl.count > 0
                ? <CheckCircle size={14} style={{ color: 'var(--success-500)' }} />
                : <Clock size={14} style={{ color: 'var(--gray-400)' }} />
              }
            </div>
            <div className="stat-value">{sessoes_sapl.count}</div>
            <div className="stat-label">Sessões com pauta publicada</div>
            <div className={styles.statTrend}>
              {sessoes_sapl.proxima ?? 'Nenhuma sessão agendada'}
            </div>
          </div>
        </section>

        {/* ── Agenda do dia + Aniversariantes ────────────────────────────── */}
        <section className={`${styles.dayGrid} ${!temAniversariantes ? styles.dayGridSolo : ''}`}>
          {/* Agenda de hoje */}
          <div className={`glass-card ${styles.agendaWidget}`}>
            <div className={styles.widgetHeader}>
              <Calendar size={18} style={{ color: '#f59e0b' }} />
              <span className={styles.widgetTitle}>Agenda de hoje</span>
              <Link href="/agenda" className={styles.widgetLink}>
                Ver tudo <ArrowRight size={12} />
              </Link>
            </div>
            {agenda.eventos_hoje.length === 0 ? (
              <p className={styles.emptyState}>Nenhum evento programado para hoje</p>
            ) : (
              <ul className={styles.eventList}>
                {agenda.eventos_hoje.map((ev, i) => (
                  <li key={i} className={styles.eventItem}>
                    <span
                      className={styles.eventDot}
                      style={{ background: TIPO_COLOR[ev.tipo] ?? '#6b7280' }}
                    />
                    <div className={styles.eventInfo}>
                      <span className={styles.eventTitulo}>{ev.titulo}</span>
                      <div className={styles.eventMeta}>
                        <span className={styles.eventTipo}>{TIPO_LABEL[ev.tipo] ?? ev.tipo}</span>
                        {ev.hora && <span className={styles.eventHora}>{ev.hora}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Aniversariantes (só renderiza se há algum) */}
          {temAniversariantes && (
            <div className={`glass-card ${styles.aniversariantesWidget}`}>
              <div className={styles.widgetHeader}>
                <Cake size={18} style={{ color: '#ec4899' }} />
                <span className={styles.widgetTitle}>Aniversariantes hoje</span>
                <Link href="/cadin" className={styles.widgetLink}>
                  CADIN <ArrowRight size={12} />
                </Link>
              </div>
              <ul className={styles.birthdayList}>
                {cadin.aniversariantes_hoje.map((p, i) => (
                  <li key={i} className={styles.birthdayItem}>
                    <div className={styles.birthdayAvatar}>
                      {p.nome.charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.birthdayInfo}>
                      <span className={styles.birthdayNome}>{p.nome}</span>
                      {p.cargo && <span className={styles.birthdayCargo}>{p.cargo}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ── Acesso rápido ───────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Acesso Rápido</h2>
          <div className={styles.modulesGrid}>
            {MODULES.map((mod) => {
              const Icon = mod.icon;
              return (
                <a key={mod.label} href={mod.href} className={`glass-card ${styles.moduleCard}`}>
                  <div className={styles.moduleIcon} style={{ background: `${mod.color}20`, color: mod.color }}>
                    <Icon size={24} />
                  </div>
                  <div className={styles.moduleInfo}>
                    <span className={styles.moduleLabel}>{mod.label}</span>
                    <span className={styles.moduleDesc}>{mod.desc}</span>
                  </div>
                </a>
              );
            })}
          </div>
        </section>

      </div>
    </>
  );
}
