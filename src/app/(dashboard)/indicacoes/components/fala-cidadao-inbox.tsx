'use client';

import React, { useState } from 'react';
import { Mail, MessageCircle, CheckCircle, Settings, Trash2, ShieldAlert, Bot } from 'lucide-react';
import styles from './fala-cidadao-inbox.module.css';

interface MensagemBruta {
  id: string;
  autor: string;
  canal: 'email' | 'instagram' | 'whatsapp';
  assunto?: string;
  corpo: string;
  data: string;
  spamScore: number; // 0-100 (100 = definitely spam)
  status: 'caixa_entrada' | 'rejeitado' | 'enviado_alia';
}

const MOCK_INBOX: MensagemBruta[] = []; // Substantivado com BD Real

function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

interface MensagemExtendida extends MensagemBruta {
  bairro?: string;
  logradouro?: string;
  setores?: string[];
  classificacao?: string;
}

export function FalaCidadaoInbox() {
  const [inbox, setInbox] = useState<MensagemExtendida[]>(MOCK_INBOX);
  const [loading, setLoading] = useState(true);
  const [selectedMsg, setSelectedMsg] = useState<MensagemExtendida | null>(null);

  React.useEffect(() => {
    async function loadInbox() {
      try {
        const res = await fetch('/api/indicacoes/fala-cidadao');
        if (res.ok) {
          const data = await res.json();
          const mapped = data.map((d: any) => ({
            id: d.id,
            autor: d.autor || 'Desconhecido',
            canal: d.canal || 'whatsapp',
            assunto: d.assunto || '',
            corpo: d.mensagem || d.corpo || d.descricao || '',
            data: d.created_at || new Date().toISOString(),
            spamScore: d.spam_score || 0,
            status: d.status || 'caixa_entrada',
            bairro: d.bairro,
            logradouro: d.logradouro,
            setores: d.setores,
            classificacao: d.classificacao
          }));
          setInbox(mapped);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadInbox();
  }, []);

  const pendentes = inbox.filter(i => i.status === 'caixa_entrada');

  const handleEnviarParaAlia = (id: string) => {
    setInbox(prev => prev.map(m => m.id === id ? { ...m, status: 'enviado_alia' } : m));
  };

  const handleMarcarSpam = (id: string) => {
    setInbox(prev => prev.map(m => m.id === id ? { ...m, status: 'rejeitado' } : m));
    if (selectedMsg?.id === id) setSelectedMsg(null);
  };

  const openApproveModal = (msg: MensagemExtendida) => {
    setSelectedMsg(msg);
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.headerBar}>
        <div>
          <h3 className={styles.headerTitle}>
            <MessageCircle size={20} color="#64748b" /> Inbox Fala Cidadão (Pré-Triagem)
          </h3>
          <p className={styles.headerSubtext}>Filtro de lixo, xingamentos e spam antes que alcancem o painel da ALIA.</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.counterBadge}>
            {pendentes.length} Pendentes
          </div>
          <button className={styles.btnSettings}>
            <Settings size={18} />
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
           <p style={{ color: '#64748b' }}>Sincronizando Inbox...</p>
        </div>
      ) : pendentes.length === 0 ? (
        <div className={styles.emptyState}>
          <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px' }} />
          <h4 className={styles.emptyTitle}>Caixa Limpa!</h4>
          <p className={styles.emptyText}>Todas as mensagens foram triadas ou não há chamados.</p>
        </div>
      ) : (
        <div className={styles.messageList}>
          {pendentes.map(msg => {
            const isSpam = msg.spamScore > 80;
            return (
              <div key={msg.id} className={`${styles.messageCard} ${isSpam ? styles.cardSpam : ''}`}>
                {/* Channel Sidebar */}
                <div className={isSpam ? styles.channelSidebarSpam : styles.channelSidebar}>
                  {isSpam ? (
                    <ShieldAlert size={24} color="#ef4444" />
                  ) : msg.canal === 'email' ? (
                    <Mail size={24} color="#64748b" />
                  ) : (
                    <MessageCircle size={24} color="#d946ef" />
                  )}
                  <span className={`${styles.channelLabel} ${isSpam ? styles.channelLabelSpam : styles.channelLabelNormal}`}>
                    {msg.canal}
                  </span>
                  {isSpam && (
                    <span className={styles.spamWarning}>Alto Risco<br/>Spam</span>
                  )}
                </div>

                {/* Message Content */}
                <div className={styles.messageContent}>
                  <div className={styles.messageHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={styles.messageAutor}>{msg.autor}</span>
                    </div>
                    <span className={styles.messageDate}>{formatDateTime(msg.data)}</span>
                  </div>
                  {msg.assunto && <h4 className={styles.messageSubject}>Assunto: {msg.assunto}</h4>}
                  <p className={styles.messageBody}>&ldquo;{msg.corpo}&rdquo;</p>
                </div>

                {/* Action Sidebar */}
                <div className={styles.actionSidebar}>
                  <button
                    onClick={() => openApproveModal(msg)}
                    className={styles.btnEnviarAlia}
                  >
                    <CheckCircle size={16} /> Analisar Demanda
                  </button>
                  <button
                    onClick={() => handleMarcarSpam(msg.id)}
                    className={styles.btnSpam}
                  >
                    <Trash2 size={16} /> Rejeitar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Revisão da Demanda */}
      {selectedMsg && (
        <div className={styles.modalOverlay}>
           <div className={styles.modalContent}>
              <div className={styles.modalHeader}>
                 <h3>Revisar Demanda: {selectedMsg.assunto || 'Nova Solicitação'}</h3>
                 <button onClick={() => setSelectedMsg(null)} className={styles.closeModalBtn}>✕</button>
              </div>
              <div className={styles.modalBody}>
                 <div className={styles.modalRow}>
                    <strong>👥 Cidadão Responsável:</strong> {selectedMsg.autor}
                 </div>
                 <div className={styles.modalRow}>
                    <strong>📍 Endereço:</strong> {selectedMsg.logradouro || 'Não informado'} - {selectedMsg.bairro || 'Não informado'}
                 </div>
                 {selectedMsg.setores && selectedMsg.setores.length > 0 && (
                   <div className={styles.modalRow}>
                      <strong>🛠️ Setor / Tema:</strong> {selectedMsg.setores.join(', ')}
                   </div>
                 )}
                 <div className={styles.modalDescription}>
                    <strong>Descrição original:</strong>
                    <p>"{selectedMsg.corpo}"</p>
                 </div>
              </div>
              <div className={styles.modalFooter}>
                 <button className={styles.btnCancel} onClick={() => setSelectedMsg(null)}>Cancelar</button>
                 <button 
                  className={styles.btnConvert}
                  onClick={() => {
                     // Integração futura com Cadastro de Indicação
                     alert('Esta ação redirecionará para o formulário de Cadastro da Indicação pré-preenchido.');
                     handleEnviarParaAlia(selectedMsg.id); // Simula o aceite
                     setSelectedMsg(null);
                  }}
                 >
                    <Bot size={18} /> Converter em Indicação Oficial
                 </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}
