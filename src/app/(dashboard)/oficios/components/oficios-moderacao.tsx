'use client';

import React, { useState } from 'react';
import { CheckCircle, XCircle, Clock, MapPin, Play, Mic, Send, Edit3, Bot, FileText, CornerDownRight } from 'lucide-react';
import styles from '../oficios-dashboard.module.css';

interface OficioPendente {
  id: string;
  autor: string; // The person who requested via Whatsapp
  telefone: string;
  midia_tipo: 'audio' | 'texto';
  transcricao: string;
  oficioGerado: {
    destinatario: string;
    cargo: string;
    assunto: string;
    corpo: string;
  };
  status: 'pendente' | 'aprovado' | 'recusado';
  dataRecebida: string;
  chainOfThought: string[];
}

const MOCK_FALLBACK: OficioPendente[] = []; // Removido mock fixo para forçar uso do banco real

export function OficiosModeracao() {
  const [pendentes, setPendentes] = React.useState<OficioPendente[]>(MOCK_FALLBACK);
  const [generating, setGenerating] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function loadOficios() {
      try {
        const res = await fetch('/api/oficios');
        if (!res.ok) throw new Error('Falha ao carregar ofícios');
        const data = await res.json();
        
        // Mapeando dados do DB para a interface OficioPendente usada no Front
        const mapped: OficioPendente[] = data
          .filter((oficio: any) => oficio.status === 'rascunho' || oficio.status === 'pendente')
          .map((oficio: any) => ({
            id: oficio.id,
            autor: oficio.dados_json?.autor || 'Solicitante via WhatsApp',
            telefone: oficio.dados_json?.telefone || 'Não identificado',
            midia_tipo: oficio.dados_json?.midia_tipo || 'texto',
            transcricao: oficio.dados_json?.transcricao || 'Transcrição não disponível no Rascunho',
            oficioGerado: {
              destinatario: oficio.destinatario || 'Desconhecido',
              cargo: oficio.cargo_dest || 'Sem cargo',
              assunto: oficio.assunto || 'Sem assunto',
              corpo: oficio.corpo || 'Corpo vazio',
            },
            status: 'pendente',
            dataRecebida: oficio.created_at || new Date().toISOString(),
            chainOfThought: oficio.dados_json?.chainOfThought || ['ALIA: Orquestrou minuta oficial via Supabase.']
          }));
        
        setPendentes(mapped);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadOficios();
  }, []);

  const handleAprovar = (id: string) => {
    setGenerating(id);
    setTimeout(() => {
      setPendentes(prev => prev.map(p => p.id === id ? { ...p, status: 'aprovado' } : p));
      setGenerating(null);
    }, 1500);
  };

  const handleRecusar = (id: string) => {
    setPendentes(prev => prev.map(p => p.id === id ? { ...p, status: 'recusado' } : p));
  };

  const ativos = pendentes.filter(p => p.status === 'pendente');

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.5)', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
        <Clock size={48} color="#94a3b8" className="animate-spin" style={{ margin: '0 auto 16px', opacity: 0.8 }} />
        <h3 style={{ fontSize: '1.25rem', color: '#1e293b', marginBottom: '8px' }}>Carregando pendências...</h3>
        <p style={{ color: '#64748b' }}>Conectando com banco de dados.</p>
      </div>
    );
  }

  if (ativos.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.5)', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
        <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.8 }} />
        <h3 style={{ fontSize: '1.25rem', color: '#1e293b', marginBottom: '8px' }}>Gabinete em Dia!</h3>
        <p style={{ color: '#64748b' }}>Nenhum ofício aguardando moderação da ALIA.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'linear-gradient(to right, #f0f9ff, #ffffff)', borderRadius: '8px', borderLeft: '4px solid #0284c7' }}>
        <Bot size={24} color="#0284c7" />
        <div>
          <h4 style={{ margin: 0, color: '#0f172a', fontSize: '1rem' }}>Despachos Agenticos</h4>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>A ALIA redigiu estes ofícios de forma autônoma a partir do WhatsApp. Revise e assine digitalmente.</p>
        </div>
      </div>

      {ativos.map(item => (
        <div key={item.id} style={{ display: 'flex', background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          
          {/* Lado Esquerdo: Pedido Origem */}
          <div style={{ flex: 1, padding: '24px', borderRight: '1px solid #e2e8f0', background: '#f8fafc' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pedido Recebido via WhatsApp</span>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={14} /> 5 min atrás
              </span>
            </div>

            <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white' }}>
                 {item.autor.charAt(0)}
               </div>
               <div>
                  <h3 style={{ margin: '0 0 2px 0', fontSize: '1rem', color: '#0f172a' }}>{item.autor}</h3>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{item.telefone}</div>
               </div>
            </div>

             {item.midia_tipo === 'audio' && (
              <div style={{ background: '#e0f2fe', padding: '12px', borderRadius: '8px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', cursor: 'pointer' }}>
                  <Play size={16} fill="white" />
                </div>
                <div style={{ flex: 1, height: '4px', background: '#bae6fd', borderRadius: '2px', position: 'relative' }}>
                   <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '50%', background: '#0ea5e9', borderRadius: '2px' }} />
                </div>
                <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 500 }}>0:12</span>
              </div>
            )}

            <div style={{ fontSize: '0.95rem', color: '#334155', fontStyle: 'italic', paddingLeft: '12px', borderLeft: '3px solid #cbd5e1', marginBottom: '24px' }}>
               "{item.transcricao}"
            </div>

            <div style={{ padding: '12px', background: '#f1f5f9', borderRadius: '8px', fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '6px' }}>
               <div style={{ fontWeight: 600, color: '#334155', marginBottom: '4px' }}>Raciocínio IA (Chain of Thought):</div>
               {item.chainOfThought.map((thought, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                     <CornerDownRight size={12} color="#94a3b8" style={{ marginTop: '2px', flexShrink: 0 }} />
                     <span>{thought}</span>
                  </div>
               ))}
            </div>

          </div>

          {/* Lado Direito: Ofício Gerado */}
          <div style={{ flex: 1.5, padding: '24px', display: 'flex', flexDirection: 'column' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
               <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0ea5e9', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                 <FileText size={16} /> Ofício Gerado (Rascunho)
               </span>
               <span style={{ fontSize: '0.75rem', padding: '4px 8px', background: '#fef3c7', color: '#d97706', borderRadius: '12px', fontWeight: 600 }}>
                 Aguardando Assinatura
               </span>
            </div>

            <div style={{ flex: 1, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px', position: 'relative', boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.02)' }}>
               {/* Cabeçalho Doc */}
               <div style={{ textAlign: 'right', fontSize: '0.85rem', color: '#64748b', marginBottom: '24px' }}>
                  Boa Vista - RR, {String(new Date().getDate()).padStart(2, '0')}/{String(new Date().getMonth() + 1).padStart(2, '0')}/{new Date().getFullYear()}
               </div>
               
               <div style={{ marginBottom: '24px', fontSize: '0.9rem', color: '#0f172a', lineHeight: 1.4 }}>
                 Ao Senhor(a)
                 <div style={{ fontWeight: 600 }}>{item.oficioGerado.destinatario}</div>
                 <div>{item.oficioGerado.cargo}</div>
               </div>

               <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '24px', color: '#1e293b' }}>
                 Assunto: {item.oficioGerado.assunto}
               </div>

               <div style={{ fontSize: '0.95rem', color: '#334155', lineHeight: 1.6, textAlign: 'justify', marginBottom: '40px' }}>
                 {item.oficioGerado.corpo}
               </div>

               <div style={{ textAlign: 'center', borderTop: '1px solid #cbd5e1', paddingTop: '16px', margin: '0 40px', fontSize: '0.9rem', color: '#0f172a' }}>
                 <div style={{ fontWeight: 600 }}>Carol Dantas</div>
                 <div style={{ color: '#64748b' }}>Vereadora de Boa Vista</div>
               </div>
            </div>

            {/* Botões de Ação */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
               <button 
                onClick={() => handleAprovar(item.id)}
                disabled={generating === item.id}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: generating === item.id ? 'not-allowed' : 'pointer', opacity: generating === item.id ? 0.7 : 1, transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(14, 165, 233, 0.3)' }}
               >
                 {generating === item.id ? <Clock size={18} className="animate-spin" /> : <Send size={18} />}
                 {generating === item.id ? 'Assinando...' : 'Assinar, Numerar e Salvar PDF'}
               </button>
               <button style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s' }} title="Editar Texto">
                 <Edit3 size={18} />
               </button>
               <button onClick={() => handleRecusar(item.id)} style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s' }} title="Descartar">
                 <XCircle size={18} />
               </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
