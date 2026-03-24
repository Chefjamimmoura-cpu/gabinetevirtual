'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Send, Zap, BookUser, MessageCircle } from 'lucide-react';
import styles from '../laia-dashboard.module.css';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'human_agent' | 'system';
  content: string;
  created_at: string;
}

export default function LaiaChat({ agente }: { agente: 'laia' | 'cadin' }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/laia/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          agente,
          message: userMsg.content
        })
      });

      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Erro na comunicação');

      if (!sessionId && data.session_id) {
        setSessionId(data.session_id);
      }

      const botMsg: Message = {
        id: Date.now().toString() + 'bot',
        role: 'assistant',
        content: data.content,
        created_at: data.created_at || new Date().toISOString(),
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      console.error(err);
      const errorMsg: Message = {
        id: Date.now().toString() + 'error',
        role: 'system',
        content: `Ocorreu um erro ao comunicar com a ${agente === 'laia' ? 'ALIA' : 'CADIN'}. Detalhes: ${errorMessage}`,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const isLaia = agente === 'laia';

  return (
    <div className={styles.glassCard}>
      {/* Header */}
      <div className={styles.chatHeader}>
        {isLaia 
          ? <Zap size={20} color="#488DC7" /> 
          : <BookUser size={20} color="#10b981" />
        }
        <h2 className={styles.chatHeaderTitle}>
          {isLaia ? 'Assistente ALIA' : 'Agente CADIN (Contatos)'}
        </h2>
      </div>

      {/* Messages */}
      <div className={styles.chatBody}>
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            <div className={isLaia ? styles.emptyStateIcon : styles.emptyStateIconGreen}>
              {isLaia 
                ? <Zap size={32} color="#488DC7" /> 
                : <BookUser size={32} color="#10b981" />
              }
            </div>
            <h3 className={styles.emptyStateTitle}>
              {isLaia ? 'Converse com a ALIA' : 'Consulte o CADIN'}
            </h3>
            <p className={styles.emptyStateText}>
              {isLaia 
                ? 'Faça perguntas sobre legislação, peça resumos de matérias ou auxílio com documentos do gabinete.'
                : 'Consulte autoridades, secretarias municipais, contatos do governo e informações do cadastro.'
              }
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={
              msg.role === 'user' ? styles.chatMessageUser : 
              msg.role === 'system' ? styles.chatMessageSystem : 
              styles.chatMessageBot
            }
          >
            <div>{msg.content}</div>
            <div className={msg.role === 'user' ? styles.chatTimeUser : styles.chatTimeBot}>
              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className={styles.typingIndicator}>
            <div className={styles.typingDots}>
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
            </div>
            {isLaia ? 'ALIA' : 'CADIN'} está digitando...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={styles.chatInputArea}>
        <form onSubmit={sendMessage} className={styles.chatForm}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Conversar com ${isLaia ? 'ALIA' : 'CADIN'}...`}
            className={styles.chatInput}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={styles.btnSend}
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

