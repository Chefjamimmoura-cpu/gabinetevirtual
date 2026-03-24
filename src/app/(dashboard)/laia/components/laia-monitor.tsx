'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import LaiaMonitorSession from './laia-monitor-session';
import { Smartphone, Monitor as MonitorIcon, Search, MessageSquare } from 'lucide-react';
import styles from '../laia-dashboard.module.css';

interface Session {
  id: string;
  canal: 'whatsapp' | 'interno';
  agente: 'laia' | 'cadin';
  telefone: string | null;
  contato_nome: string | null;
  status: 'ativa' | 'humano' | 'encerrada';
  assumido_por: string | null;
  ultima_msg_em: string;
  ultima_msg_preview: string;
}

export default function LaiaMonitor() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const supabase = createClient();

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/laia/sessions');
      const data = await res.json();
      if (res.ok) setSessions(data);
    } catch (e) {
      console.error('Erro ao buscar sessões LAIA:', e);
    }
  };

  useEffect(() => {
    fetchSessions();

    const channel = supabase.channel('laia_monitor_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'laia_sessions' }, () => {
        fetchSessions();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'laia_messages' }, () => {
        fetchSessions();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const getStatusDotClass = (status: string): string => {
    if (status === 'ativa') return styles.statusDotAtiva;
    if (status === 'humano') return styles.statusDotHumano;
    return styles.statusDotEncerrada;
  };

  const getStatusLabel = (status: string): string => {
    if (status === 'ativa') return 'ALIA Ativa';
    if (status === 'humano') return 'Intervenção Humana';
    return 'Encerrada';
  };

  const filteredSessions = sessions.filter(s => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (s.contato_nome && s.contato_nome.toLowerCase().includes(term)) ||
      (s.telefone && s.telefone.includes(term)) ||
      (s.ultima_msg_preview && s.ultima_msg_preview.toLowerCase().includes(term))
    );
  });

  return (
    <div className={styles.glassCardRow}>
      
      {/* Sidebar List */}
      <div className={styles.monitorSidebar}>
        <div className={styles.sidebarSearch}>
          <div className={styles.searchWrapper}>
            <Search size={16} className={styles.searchIcon} />
            <input 
              type="text" 
              placeholder="Buscar conversas..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.sessionsList}>
          {filteredSessions.map(session => (
            <div 
              key={session.id} 
              onClick={() => setSelectedSessionId(session.id)}
              className={`${styles.sessionItem} ${selectedSessionId === session.id ? styles.sessionItemActive : ''}`}
            >
              <div className={styles.sessionItemHeader}>
                <div className={styles.sessionItemName}>
                  {session.canal === 'whatsapp' 
                    ? <Smartphone size={14} color="#64748b" /> 
                    : <MonitorIcon size={14} color="#64748b" />
                  }
                  {session.contato_nome || session.telefone || 'Usuário Anônimo'}
                </div>
                <div className={styles.sessionItemTime}>
                  {new Date(session.ultima_msg_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              <div className={styles.sessionItemPreview}>
                {session.ultima_msg_preview || 'Sem mensagens...'}
              </div>

              <div className={styles.sessionItemStatus}>
                <div className={getStatusDotClass(session.status)} />
                <span className={styles.statusLabel}>
                  {getStatusLabel(session.status)}
                </span>
              </div>
            </div>
          ))}

          {filteredSessions.length === 0 && (
            <div className={styles.sidebarEmpty}>
              Nenhuma conversa encontrada no momento.
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className={styles.monitorMainEmpty}>
        {selectedSessionId ? (
          <LaiaMonitorSession sessionId={selectedSessionId} onUpdate={fetchSessions} />
        ) : (
          <div className={styles.monitorEmptyContent}>
            <div className={styles.monitorEmptyInner}>
              <div className={styles.monitorEmptyIcon}>
                <MessageSquare size={28} color="#94a3b8" />
              </div>
              <p className={styles.monitorEmptyText}>
                Selecione uma conversa na lista ao lado para monitorar as mensagens em tempo real.
              </p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
