'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ShieldAlert, Bot, BotOff, Send, User, Loader2, MessageCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import styles from '../alia-dashboard.module.css';

interface SessionData {
  id: string;
  canal: string;
  status: 'ativa' | 'humano' | 'encerrada';
  contato_nome: string | null;
  telefone: string | null;
  assumido_por: string | null;
}

interface MessageData {
  id: string;
  role: 'user' | 'assistant' | 'human_agent' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export default function AliaMonitorSession({ sessionId, onUpdate }: { sessionId: string; onUpdate: () => void }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const fetchSessionDetails = async () => {
    try {
      const msgsRes = await fetch(`/api/laia/sessions/${sessionId}/messages`);
      if (msgsRes.ok) {
        setMessages(await msgsRes.json());
      }
      
      const sessionRes = await fetch('/api/laia/sessions');
      if (sessionRes.ok) {
        const allSessions: SessionData[] = await sessionRes.json();
        const current = allSessions.find((s) => s.id === sessionId);
        if (current) setSession(current);
      }
    } catch (e) {
      console.error('Erro ao carregar sessão:', e);
    }
  };

  useEffect(() => {
    fetchSessionDetails();

    const channel = supabase.channel(`session_${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'laia_messages', filter: `session_id=eq.${sessionId}` }, (payload) => {
        setMessages(prev => [...prev, payload.new as MessageData]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'laia_sessions', filter: `id=eq.${sessionId}` }, (payload) => {
        setSession(payload.new as SessionData);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, supabase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleTakeover = async () => {
    await fetch(`/api/laia/sessions/${sessionId}/takeover`, { method: 'POST' });
    onUpdate();
    fetchSessionDetails();
  };

  const handleRelease = async () => {
    await fetch(`/api/laia/sessions/${sessionId}/release`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensagem_retorno: "A assistente virtual retornou ao atendimento." }) 
    });
    onUpdate();
    fetchSessionDetails();
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    setIsSending(true);
    try {
      await fetch(`/api/laia/sessions/${sessionId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input })
      });
      setInput('');
    } catch (err) {
      console.error('Erro ao enviar resposta:', err);
    } finally {
      setIsSending(false);
    }
  };

  const getStatusLabel = (status: string): string => {
    if (status === 'ativa') return 'ALIA Ativa';
    if (status === 'humano') return 'Intervenção Humana';
    return 'Encerrada';
  };

  if (!session) {
    return (
      <div className={styles.loadingState}>
        <Loader2 size={20} className={styles.spinIcon} />
        Carregando dados da sessão...
      </div>
    );
  }

  return (
    <div className={styles.sessionContainer}>
      {/* Header */}
      <div className={styles.monitorHeader}>
        <div className={styles.monitorHeaderInfo}>
          <h2 className={styles.monitorHeaderName}>
            {session.contato_nome || session.telefone || 'Usuário Anônimo'}
          </h2>
          <span className={styles.monitorHeaderMeta}>
            {session.canal.toUpperCase()} • {getStatusLabel(session.status)}
          </span>
        </div>
        
        <div className={styles.monitorHeaderActions}>
          {session.status === 'ativa' && (
            <button onClick={handleTakeover} className={styles.btnTakeover}>
              <ShieldAlert size={16} /> Assumir Conversa
            </button>
          )}
          {session.status === 'humano' && (
            <button onClick={handleRelease} className={styles.btnRelease}>
              <Bot size={16} /> Devolver à IA
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className={styles.chatBody}>
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={msg.role === 'user' ? styles.msgWrapperCidadao : styles.msgWrapperAi}
          >
            {msg.role !== 'user' && (
              <div className={styles.msgRoleLabelRight}>
                {msg.role === 'assistant' 
                  ? <><Bot size={12} /> IA Respondeu</>
                  : <><User size={12} /> Assessor Respondeu</>
                }
              </div>
            )}
            <div className={
              msg.role === 'user' ? styles.msgCidadao : 
              msg.role === 'assistant' ? styles.msgAssistente : 
              styles.msgHumano
            }>
              {msg.content}
            </div>
            <div className={msg.role === 'user' ? styles.msgTimeLeft : styles.msgTimeRight}>
              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}

        {messages.length === 0 && (
          <div className={styles.messagesEmpty}>
            <div className={styles.messagesEmptyIcon}>
              <MessageCircle size={24} color="#94a3b8" />
            </div>
            <p className={styles.messagesEmptyText}>
              Nenhuma mensagem nesta sessão de conversa.
            </p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input (Humano) or AI Banner */}
      {session.status === 'humano' ? (
        <div className={styles.chatInputArea}>
          <form onSubmit={handleReply} className={styles.chatForm}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Digite sua mensagem manual para o contato..."
              className={styles.chatInput}
            />
            <button
              type="submit"
              disabled={!input.trim() || isSending}
              className={styles.btnSendAmber}
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      ) : (
        <div className={styles.aiBanner}>
          <BotOff size={16} />
          A IA está controlando esta conversa. Clique em &quot;Assumir Conversa&quot; para intervir manualmente.
        </div>
      )}
    </div>
  );
}
