'use client';

import React, { useState } from 'react';
import { Bot, FileText, CheckCircle, Clock, Play, Mic, Send, Edit3, XCircle, ChevronRight, Download } from 'lucide-react';
// Reusing some styles from oficios or generic if needed, or inline.

interface ParecerPendente {
  id: string;
  autor: string;
  transcricao: string;
  midia_tipo: 'texto' | 'audio';
  parecerResumo: string;
  status: 'pendente' | 'aprovado' | 'recusado';
  dataRecebida: string;
  pdfAnexoNome: string;
  chainOfThought: string[];
}

const mockPendentes: ParecerPendente[] = [
  {
    id: 'PAR-001',
    autor: 'SAPL Automático (CronJob)',
    transcricao: 'Nova Ordem do Dia identificada (Sessão 14/03). Extraindo matérias...',
    midia_tipo: 'texto',
    parecerResumo: 'A Ordem do Dia contém 5 matérias. Foram identificados 2 Projetos de Lei do Executivo (Aprovados), 1 Indicação da Vereadora Carol (Aprovada) e 2 Requerimentos da Oposição (Rejeitados). O parecer final sugere Voto Sim para os do Executivo e da Vereadora.',
    status: 'pendente',
    dataRecebida: new Date().toISOString(),
    pdfAnexoNome: '14_03_2026_id_102.pdf',
    chainOfThought: [
      'ALIA: Pauta "Ordem do Dia" identificada monitorando o portal SAPL.',
      'ALIA: Extraindo 5 matérias que constam EXCLUSIVAMENTE nesta Ordem do Dia.',
      'ALIA: Cruzando com base de dados SAPL para obter texto original dos Projetos.',
      'ALIA: Gerando minuta votação agrupada da respectiva Sessão.'
    ]
  }
];

export function PareceresModeracao() {
  const [pendentes, setPendentes] = useState<ParecerPendente[]>(mockPendentes);
  const [generating, setGenerating] = useState<string | null>(null);

  const handleAprovar = (id: string) => {
    setGenerating(id);
    setTimeout(() => {
      setPendentes(prev => prev.map(p => p.id === id ? { ...p, status: 'aprovado' } : p));
      setGenerating(null);
    }, 2000);
  };

  const handleRecusar = (id: string) => {
    setPendentes(prev => prev.map(p => p.id === id ? { ...p, status: 'recusado' } : p));
  };

  const ativos = pendentes.filter(p => p.status === 'pendente');

  if (ativos.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.5)', borderRadius: '12px', border: '1px dashed #cbd5e1', marginTop: '20px' }}>
        <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.8 }} />
        <h3 style={{ fontSize: '1.25rem', color: '#1e293b', marginBottom: '8px' }}>Pautas em Dia!</h3>
        <p style={{ color: '#64748b' }}>Nenhuma ordem do dia aguardando geração de pareceres pela ALIA.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'linear-gradient(to right, #fdf4ff, #ffffff)', borderRadius: '8px', borderLeft: '4px solid #d946ef' }}>
        <Bot size={24} color="#d946ef" />
        <div>
          <h4 style={{ margin: 0, color: '#0f172a', fontSize: '1rem' }}>Análise Prévia (ALIA)</h4>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>Pareceres gerados a partir as matérias contidas exclusivamente em uma Ordem do Dia (SAPL).</p>
        </div>
      </div>

      {ativos.map(item => (
        <div key={item.id} style={{ display: 'flex', background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          
          <div style={{ flex: 1, padding: '24px', borderRight: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gatilho Autônomo</span>
            </div>

            <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white' }}>
                 M
               </div>
               <div>
                  <h3 style={{ margin: '0 0 2px 0', fontSize: '1rem', color: '#0f172a' }}>{item.autor}</h3>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                     <FileText size={14} color="#0284c7" /> {item.pdfAnexoNome}
                  </div>
               </div>
            </div>

            <div style={{ fontSize: '0.95rem', color: '#334155', fontStyle: 'italic', paddingLeft: '12px', borderLeft: '3px solid #cbd5e1', marginBottom: '24px' }}>
               "{item.transcricao}"
            </div>

            <div style={{ padding: '12px', background: '#f1f5f9', borderRadius: '8px', fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '6px' }}>
               <div style={{ fontWeight: 600, color: '#334155', marginBottom: '4px' }}>Chain of Thought (ALIA):</div>
               {item.chainOfThought.map((thought, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                     <ChevronRight size={12} color="#94a3b8" style={{ marginTop: '2px', flexShrink: 0 }} />
                     <span>{thought}</span>
                  </div>
               ))}
            </div>

          </div>

          <div style={{ flex: 1.5, padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
               <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#d946ef', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                 <FileText size={16} /> Resumo Executivo
               </span>
            </div>

            <div style={{ flex: 1, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px', position: 'relative', boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.02)' }}>
               
               <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '16px', color: '#1e293b' }}>
                 Diretriz de Votação (Minuta)
               </div>

               <div style={{ fontSize: '0.95rem', color: '#334155', lineHeight: 1.6, textAlign: 'justify' }}>
                 {item.parecerResumo}
               </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
               <button 
                onClick={() => handleAprovar(item.id)}
                disabled={generating === item.id}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', background: '#d946ef', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: generating === item.id ? 'not-allowed' : 'pointer', opacity: generating === item.id ? 0.7 : 1, transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(217, 70, 239, 0.3)' }}
               >
                 {generating === item.id ? <Clock size={18} className="animate-spin" /> : <Download size={18} />}
                 {generating === item.id ? 'Gerando Completo...' : 'Aprovar Diretriz e Baixar DOCX'}
               </button>
               <button onClick={() => handleRecusar(item.id)} style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s' }} title="Reavaliar Manuais">
                 <XCircle size={18} />
               </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
