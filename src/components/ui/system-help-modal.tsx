'use client';

import { useState } from 'react';
import {
  X, BookOpen, Briefcase, Layers, Inbox, MessageSquare,
  LayoutDashboard, Bell, Zap, Sparkles, Settings
} from 'lucide-react';
import styles from './system-help-modal.module.css';

interface SystemHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type HelpTab = 'intro' | 'cadin' | 'pareceres' | 'indicacoes' | 'alia';

const tabs: { key: HelpTab; label: string; icon: typeof BookOpen }[] = [
  { key: 'intro',      label: 'Resumo Geral',        icon: BookOpen },
  { key: 'cadin',      label: 'CADIN (Cidadãos)',     icon: Briefcase },
  { key: 'pareceres',  label: 'Módulo Pareceres',     icon: Layers },
  { key: 'indicacoes', label: 'Painel de Indicações',  icon: Inbox },
  { key: 'alia',       label: 'Assistente ALIA',      icon: MessageSquare },
];

export default function SystemHelpModal({ isOpen, onClose }: SystemHelpModalProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>('intro');

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        {/* ── Header ────────────────────────────────────── */}
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            <BookOpen size={20} />
          </div>
          <div className={styles.headerText}>
            <h2 className={styles.title}>Central de Ajuda</h2>
            <p className={styles.subtitle}>Documentação e guias do Gabinete Virtual</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {/* ── Body ──────────────────────────────────────── */}
        <div className={styles.body}>

          {/* Sidebar */}
          <nav className={styles.sidebar}>
            {tabs.map(tab => (
              <button
                key={tab.key}
                className={`${styles.tabBtn} ${activeTab === tab.key ? styles.active : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span className={styles.tabIconWrap}>
                  <tab.icon size={16} />
                </span>
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className={styles.content}>

            {/* ═══ Resumo Geral ══════════════════════════ */}
            {activeTab === 'intro' && (
              <div className={styles.helpDoc} key="intro">
                <div className={styles.sectionHeader}>
                  <div className={`${styles.sectionIcon} ${styles.navy}`}>
                    <LayoutDashboard size={20} />
                  </div>
                  <div>
                    <h3 className={styles.sectionTitle}>Bem-vinda ao Gabinete Virtual</h3>
                    <p className={styles.sectionDesc}>Visão geral da plataforma e seus recursos</p>
                  </div>
                </div>

                <p>
                  O Gabinete Virtual é uma plataforma integrada para gestão de mandatos parlamentares,
                  desenvolvida para economizar tempo, automatizar tarefas burocráticas e aproximar o
                  mandato da população através da Inteligência Artificial (ALIA).
                </p>

                <h4>Estrutura do Painel</h4>

                <div className={styles.featureGrid}>
                  <div className={styles.featureCard}>
                    <div className={`${styles.featureCardIcon} ${styles.fcNavy}`}>
                      <LayoutDashboard size={16} />
                    </div>
                    <div className={styles.featureCardTitle}>Menu Lateral</div>
                    <div className={styles.featureCardDesc}>
                      Navegue por Pareceres, Solicitações, CADIN e todos os módulos.
                    </div>
                  </div>
                  <div className={styles.featureCard}>
                    <div className={`${styles.featureCardIcon} ${styles.fcCyan}`}>
                      <Bell size={16} />
                    </div>
                    <div className={styles.featureCardTitle}>Barra Superior</div>
                    <div className={styles.featureCardDesc}>
                      Buscas rápidas, notificações e configurações da conta.
                    </div>
                  </div>
                  <div className={styles.featureCard}>
                    <div className={`${styles.featureCardIcon} ${styles.fcEmerald}`}>
                      <Zap size={16} />
                    </div>
                    <div className={styles.featureCardTitle}>Widget ALIA</div>
                    <div className={styles.featureCardDesc}>
                      Botão flutuante para acionar a IA Especialista do gabinete.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ CADIN ════════════════════════════════ */}
            {activeTab === 'cadin' && (
              <div className={styles.helpDoc} key="cadin">
                <div className={styles.sectionHeader}>
                  <div className={`${styles.sectionIcon} ${styles.cyan}`}>
                    <Briefcase size={20} />
                  </div>
                  <div>
                    <h3 className={styles.sectionTitle}>CADIN (Cadastro Integrado)</h3>
                    <p className={styles.sectionDesc}>CRM especializado em cidadãos e lideranças</p>
                  </div>
                </div>

                <p>
                  O CADIN atua como o cérebro das relações públicas do seu mandato. É um CRM
                  especializado na gestão de cidadãos e lideranças, centralizando contatos,
                  histórico de atendimentos e dados eleitorais.
                </p>

                <div className={styles.cardInfo}>
                  <strong><Sparkles size={14} /> Nova Funcionalidade: Aniversariantes</strong>
                  <p>
                    Automação que alerta sobre os aniversariantes do dia. Você pode programar o
                    WhatsApp para disparar mensagens de parabéns personalizadas pela IA ALIA!
                  </p>
                </div>

                <h4>Ações Disponíveis</h4>
                <p>Ao abrir o perfil de um cidadão, você pode:</p>
                <ul>
                  <li>Verificar seções eleitorais e dados de localização.</li>
                  <li>Adicionar etiquetas de engajamento (Ex: Liderança, Saúde, Educação).</li>
                  <li>Registrar atendimentos passados para manter o histórico completo de conversas.</li>
                </ul>
              </div>
            )}

            {/* ═══ Pareceres ════════════════════════════ */}
            {activeTab === 'pareceres' && (
              <div className={styles.helpDoc} key="pareceres">
                <div className={styles.sectionHeader}>
                  <div className={`${styles.sectionIcon} ${styles.emerald}`}>
                    <Layers size={20} />
                  </div>
                  <div>
                    <h3 className={styles.sectionTitle}>Módulo de Pareceres</h3>
                    <p className={styles.sectionDesc}>Relatoria inteligente de proposições legislativas</p>
                  </div>
                </div>

                <p>
                  O sistema Pareceres 2.0 foi desenhado para relatar proposições (Projetos de Lei,
                  Requerimentos) sem complicação, puxando dados diretamente do sistema legislativo
                  digital (SAPL).
                </p>

                <h4>Como preencher uma relatoria</h4>
                <ol>
                  <li>
                    Digite o <strong>Nº da Proposição</strong> e clique em <em>Buscar SAPL</em>.
                    A ALIA tentará encontrar o projeto pela API.
                  </li>
                  <li>
                    Após carregar, o texto completo do PDF do projeto aparecerá do lado esquerdo
                    para você ler as páginas rapidamente.
                  </li>
                  <li>
                    Defina o viés do parecer (Favorável ou Desfavorável) e clique no
                    botão <strong>Gerar Parecer (IA)</strong>.
                  </li>
                  <li>
                    Um documento rico, com formatação jurídica e tabelas de fundamentação, será
                    construído na aba &ldquo;Relatoria Gerada&rdquo;.
                  </li>
                </ol>
              </div>
            )}

            {/* ═══ Indicações ═══════════════════════════ */}
            {activeTab === 'indicacoes' && (
              <div className={styles.helpDoc} key="indicacoes">
                <div className={styles.sectionHeader}>
                  <div className={`${styles.sectionIcon} ${styles.amber}`}>
                    <Inbox size={20} />
                  </div>
                  <div>
                    <h3 className={styles.sectionTitle}>Indicações (Recebidas)</h3>
                    <p className={styles.sectionDesc}>Demandas do Fala Cidadão integradas ao gabinete</p>
                  </div>
                </div>

                <p>
                  Conectado ao aplicativo <em>Fala Cidadão</em>, este painel coleta automaticamente
                  as demandas do município informadas pelos moradores (Ex: buracos na rua, lâmpada queimada).
                </p>

                <h4>Fluxo de Trabalho</h4>
                <ol>
                  <li>
                    Ao receber uma Indicação, analise as fotos no modal lateral <strong>Detalhes</strong>.
                  </li>
                  <li>
                    Encaminhe a indicação para a ALIA redigir instantaneamente um
                    <strong> Requerimento Oficial</strong> ou um <strong>Ofício</strong> exigindo
                    reparo da Prefeitura.
                  </li>
                  <li>
                    Após finalizar o ofício, altere o status na lista
                    (Triado &rarr; Finalizado) — a ALIA pode atualizar o <em>Fala Cidadão</em>
                    {' '}enviando um WhatsApp ao eleitor informando que o problema está sendo resolvido.
                  </li>
                </ol>
              </div>
            )}

            {/* ═══ ALIA ═════════════════════════════════ */}
            {activeTab === 'alia' && (
              <div className={styles.helpDoc} key="alia">
                <div className={styles.sectionHeader}>
                  <div className={`${styles.sectionIcon} ${styles.violet}`}>
                    <MessageSquare size={20} />
                  </div>
                  <div>
                    <h3 className={styles.sectionTitle}>Assistente ALIA</h3>
                    <p className={styles.sectionDesc}>Agente de Linguagem e Inteligência Avançada</p>
                  </div>
                </div>

                <p>
                  A ALIA é um Agente de Linguagem e Inteligência Avançada, configurada especificamente
                  com dezenas de prompts sobre o regimento interno, normas jurídicas e tom de voz do parlamentar.
                </p>

                <h4>Exemplos de uso</h4>
                <div className={styles.chatBubbleWrap}>
                  <div className={styles.chatBubble}>
                    ALIA, quem faz aniversário amanhã da nossa base do bairro João de Barro?
                  </div>
                  <div className={styles.chatBubble}>
                    Me lembre de como aprovar uma moção de repúdio segundo o Regimento Interno de Boa Vista.
                  </div>
                </div>

                <div className={styles.providerHint}>
                  <div className={styles.providerHintIcon}>
                    <Settings size={14} />
                  </div>
                  <div className={styles.providerHintText}>
                    <strong>Provedor LLM:</strong> Você pode alterar o motor da ALIA
                    (Claude, Gemini ou OpenAI) através da guia de <strong>Planos SaaS</strong> no
                    seu Perfil, caso necessite de contextos mais complexos.
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
