'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Bot, X, Send, Maximize2, Minimize2, Paperclip, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function getPageContext(pathname: string): string {
  if (pathname.includes('/pareceres')) return 'Pareceres — Análise de Matérias Legislativas e Sessões Plenárias';
  if (pathname.includes('/agenda')) return 'Agenda — Calendário de Eventos e Compromissos';
  if (pathname.includes('/cadin')) return 'CADIN — Cadastro de Autoridades e Órgãos Municipais';
  if (pathname.includes('/oficios')) return 'Ofícios — Documentos Oficiais do Gabinete';
  if (pathname.includes('/indicacoes')) return 'Indicações — Demandas e Serviços para a Comunidade';
  if (pathname.includes('/pls')) return 'PLs — Proposições Legislativas';
  if (pathname.includes('/comissoes')) return 'Comissões — Acompanhamento de Comissões da Câmara';
  if (pathname.includes('/laia')) return 'LAIA — Central de Atendimento';
  if (pathname.includes('/configuracoes')) return 'Configurações do Sistema';
  return 'Dashboard Principal';
}

function getPageWelcome(pathname: string): string {
  if (pathname.includes('/pareceres')) return 'Posso verificar as matérias da próxima sessão, resumir a ordem do dia ou orientar sobre algum projeto específico.';
  if (pathname.includes('/agenda')) return 'Posso verificar seus compromissos, informar sobre a próxima sessão plenária ou listar eventos do mês.';
  if (pathname.includes('/cadin')) return 'Posso buscar secretários, autoridades municipais, aniversariantes de hoje ou qualquer órgão da Prefeitura.';
  if (pathname.includes('/oficios')) return 'Posso redigir uma minuta de ofício. Me diga o destinatário e o assunto.';
  if (pathname.includes('/indicacoes')) return 'Posso listar as indicações pendentes, protocoladas ou concluídas do gabinete.';
  return 'Como posso ajudar agora?';
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'alia';
  text: string;
  timestamp: string;
  suggestions?: string[];
}

export default function GlobalAliaWidget() {
  const pathname = usePathname();
  const pageContext = getPageContext(pathname);
  const pageWelcome = getPageWelcome(pathname);

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'alia',
      text: `Olá! Sou a **ALIA**, assistente do Gabinete da Vereadora Carol Dantas. 🤝\n\n${pageWelcome}\n\n**Posso ajudar com:**\n- 📋 Ordem do Dia e sessões plenárias\n- 👥 CADIN — secretários, autoridades, aniversariantes\n- 📝 Minutas de ofícios\n- 📌 Indicações e demandas do gabinete`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });

  // Notificações Push
  const [badgeCount, setBadgeCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Delay de 5s para não pesar no carregamento inicial da página
    const timer = setTimeout(async () => {
      // Se já estivermos na tela de pareceres, não precisamos avisar novamente da mesma forma invasiva
      if (pathname.includes('/pareceres')) return;

      try {
        const res = await fetch('/api/pareceres/relatoria/fila?comissao=CASP&limit=20');
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        
        // Conta quantas estão sem rascunho
        const pendentes = (data.fila || []).filter((m: any) => m.status_relatoria === 'sem_rascunho').length;
        if (pendentes > 0) {
          setBadgeCount(pendentes);
          setShowTooltip(true);
          // Oculta o balão de push após 10 segundos, mas mantém o badge
          setTimeout(() => { if (mounted) setShowTooltip(false); }, 10000);
        }
      } catch (err) {
        // Silencioso
      }
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [pathname]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setHasDragged(true);
        setPosition({
          x: e.clientX - dragStartPos.current.x,
          y: e.clientY - dragStartPos.current.y
        });
      }
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: input,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const res = await fetch('/api/alia/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agente: 'alia',
          message: userMsg.text,
          page_context: pageContext,
          ...(sessionId ? { session_id: sessionId } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Persiste session_id para manter contexto da conversa
        if (data.session_id && !sessionId) setSessionId(data.session_id);
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          sender: 'alia',
          text: data.content || 'Processado com sucesso.',
          suggestions: data.suggestions ?? [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
      } else {
        throw new Error('Erro na API');
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        sender: 'alia',
        text: 'Sistema indisponível ou sem conexão no momento. Tente novamente mais tarde.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleChip = (text: string) => {
    if (isTyping) return;
    setInput('');
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    fetch('/api/alia/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agente: 'alia',
        message: text,
        page_context: pageContext,
        ...(sessionId ? { session_id: sessionId } : {}),
      }),
    })
      .then(res => res.ok ? res.json() : Promise.reject('Erro na API'))
      .then(data => {
        if (data.session_id && !sessionId) setSessionId(data.session_id);
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          sender: 'alia',
          text: data.content || 'Processado com sucesso.',
          suggestions: data.suggestions ?? [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
      })
      .catch(() => {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          sender: 'alia',
          text: 'Sistema indisponível no momento. Tente novamente.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
      })
      .finally(() => setIsTyping(false));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setHasDragged(false);
    dragStartPos.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  const toggleWidget = (e?: React.MouseEvent) => {
    if (hasDragged) return;
    setIsOpen(!isOpen);
  };
  const toggleExpand = () => setIsExpanded(!isExpanded);

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      fontFamily: '"Inter", sans-serif',
      transform: `translate(${position.x}px, ${position.y}px)`,
      transition: isDragging ? 'none' : 'transform 0.1s',
    }}>
      
      {/* Botão Flutuante */}
      {!isOpen && (
        <button 
          onMouseDown={handleMouseDown}
          onClick={toggleWidget}
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #0ea5e9, #1c4076)',
            border: 'none',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 10px 25px -5px rgba(37, 99, 235, 0.4), 0 8px 10px -6px rgba(37, 99, 235, 0.2)',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseOver={e => e.currentTarget.style.transform = 'scale(1.05)'}
          onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          {/* Tooltip de Push Notification */}
          {showTooltip && badgeCount > 0 && (
            <div style={{
              position: 'absolute',
              bottom: '70px',
              right: '0',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '12px 16px',
              width: '240px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              animation: 'fade-in-up 0.4s ease-out forwards',
              fontFamily: '"Inter", sans-serif',
              pointerEvents: 'none', // Não bloqueia cliques
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '1.2rem' }}>🚨</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1c4076' }}>ALIA Alerta</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
                Vereadora, existem <strong>{badgeCount} matérias</strong> na fila de relatoria aguardando o seu parecer.
              </p>
              {/* Seta do tooltip */}
              <div style={{
                position: 'absolute',
                bottom: '-6px',
                right: '24px',
                width: '12px',
                height: '12px',
                background: '#fff',
                borderRight: '1px solid #e2e8f0',
                borderBottom: '1px solid #e2e8f0',
                transform: 'rotate(45deg)',
              }} />
            </div>
          )}

          {/* Badge de contagem */}
          {badgeCount > 0 && (
            <div style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              background: '#ef4444',
              color: 'white',
              fontSize: '0.7rem',
              fontWeight: 700,
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              border: '2px solid #fff'
            }}>
              {badgeCount > 9 ? '9+' : badgeCount}
            </div>
          )}

          <Bot size={32} />
        </button>
      )}

      {/* Janela de Chat */}
      {isOpen && (
        <div style={{
          width: isExpanded ? '600px' : '380px',
          height: isExpanded ? '80vh' : '550px',
          maxHeight: '90vh',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          transition: 'width 0.3s ease, height 0.3s ease',
        }}>
          {/* Header */}
          <div 
            onMouseDown={handleMouseDown}
            style={{
              background: 'linear-gradient(135deg, #0ea5e9, #1c4076)',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: 'white',
              cursor: 'move',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ background: 'rgba(255,255,255,0.2)', padding: '8px', borderRadius: '50%' }}>
                <Bot size={24} color="#ffffff" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>ALIA</h3>
                <span style={{ fontSize: '0.75rem', opacity: 0.85, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: '7px', height: '7px', background: '#4ade80', borderRadius: '50%' }} />
                  {pageContext.split(' — ')[0]}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={toggleExpand} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.8 }} title={isExpanded ? "Restaurar" : "Expandir"}>
                {isExpanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </button>
              <button onClick={toggleWidget} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', opacity: 0.8 }} title="Fechar">
                <X size={24} />
              </button>
            </div>
          </div>

          {/* Area de Mensagens */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            {messages.map((msg, msgIdx) => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <div style={{
                  background: msg.sender === 'user' ? '#0ea5e9' : '#ffffff',
                  color: msg.sender === 'user' ? 'white' : '#1e293b',
                  padding: '12px 16px',
                  borderRadius: msg.sender === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  border: msg.sender === 'alia' ? '1px solid #e2e8f0' : 'none',
                  fontSize: '0.9rem',
                  lineHeight: '1.6'
                }}>
                  {msg.sender === 'user' ? (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p style={{ margin: '0 0 6px 0' }}>{children}</p>,
                        strong: ({ children }) => <strong style={{ fontWeight: 700, color: '#0f172a' }}>{children}</strong>,
                        ul: ({ children }) => <ul style={{ margin: '4px 0 6px 0', paddingLeft: '18px' }}>{children}</ul>,
                        ol: ({ children }) => <ol style={{ margin: '4px 0 6px 0', paddingLeft: '18px' }}>{children}</ol>,
                        li: ({ children }) => <li style={{ marginBottom: '3px' }}>{children}</li>,
                        hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '8px 0' }} />,
                        h3: ({ children }) => <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '8px 0 4px 0', color: '#0ea5e9' }}>{children}</h3>,
                        h4: ({ children }) => <h4 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '6px 0 3px 0', color: '#334155' }}>{children}</h4>,
                        code: ({ children }) => <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: '3px', fontSize: '0.85em' }}>{children}</code>,
                        blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #0ea5e9', margin: '4px 0', paddingLeft: '10px', color: '#475569' }}>{children}</blockquote>,
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  )}
                </div>
                <span style={{
                  fontSize: '0.75rem',
                  color: '#94a3b8',
                  marginTop: '4px',
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start'
                }}>
                  {msg.timestamp}
                </span>

                {/* Chips de ação rápida — só na última mensagem da ALIA */}
                {msg.sender === 'alia' && msg.suggestions && msg.suggestions.length > 0 && msgIdx === messages.length - 1 && !isTyping && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    marginTop: '8px',
                    alignSelf: 'flex-start',
                    maxWidth: '100%',
                  }}>
                    {msg.suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleChip(s)}
                        disabled={isTyping}
                        style={{
                          padding: '5px 12px',
                          borderRadius: '20px',
                          border: '1.5px solid #0ea5e9',
                          background: isTyping ? '#f1f5f9' : '#ffffff',
                          color: isTyping ? '#94a3b8' : '#0ea5e9',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          cursor: isTyping ? 'not-allowed' : 'pointer',
                          transition: 'background 0.15s, color 0.15s',
                          lineHeight: 1.3,
                        }}
                        onMouseOver={e => { if (!isTyping) { (e.currentTarget as HTMLButtonElement).style.background = '#0ea5e9'; (e.currentTarget as HTMLButtonElement).style.color = '#ffffff'; } }}
                        onMouseOut={e => { if (!isTyping) { (e.currentTarget as HTMLButtonElement).style.background = '#ffffff'; (e.currentTarget as HTMLButtonElement).style.color = '#0ea5e9'; } }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isTyping && (
              <div style={{ alignSelf: 'flex-start', background: '#ffffff', padding: '12px 16px', borderRadius: '16px 16px 16px 4px', border: '1px solid #e2e8f0', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#0ea5e9', fontSize: '0.9rem' }}>ALIA está pensando</span>
                <Loader2 size={16} className="animate-spin" color="#0ea5e9" />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div style={{
            padding: '16px',
            background: '#ffffff',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <button style={{ background: '#f1f5f9', border: 'none', padding: '10px', borderRadius: '50%', color: '#64748b', cursor: 'pointer', transition: 'background 0.2s' }} title="Anexar">
               <Paperclip size={20} />
            </button>
            <input
              type="text"
              placeholder="Peça informações ou relatórios para a ALIA..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={isTyping}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: '1px solid #cbd5e1',
                borderRadius: '24px',
                outline: 'none',
                fontSize: '0.95rem',
                backgroundColor: isTyping ? '#f8fafc' : '#ffffff'
              }}
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              style={{
                background: !input.trim() || isTyping ? '#cbd5e1' : '#0ea5e9',
                color: 'white',
                border: 'none',
                height: '46px',
                width: '46px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: !input.trim() || isTyping ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s'
              }}
            >
              <Send size={20} style={{ marginLeft: '2px' }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

