'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Topbar from '@/components/topbar';
import { Users, FileText, CheckCircle, Clock, Loader2, FileWarning, ArrowRight } from 'lucide-react';
import styles from './comissoes-dashboard.module.css';

interface SaplComissao {
  id: number;
  nome: string;
  sigla?: string;
  membros: { nome: string; cargo: string }[];
}

interface PLPendente {
  id: number;
  numero: number;
  ano: number;
  tipo_sigla: string;
  ementa: string;
  sapl_url: string;
  comissao_atual: string;
  pareceres_existentes: number;
  tramitacoes_total: number;
  ultima_tramitacao: {
    data: string;
    status: string;
    texto: string;
  };
}

export default function ComissoesPage() {
  const [comissoes, setComissoes] = useState<SaplComissao[]>([]);
  const [selectedComissao, setSelectedComissao] = useState<SaplComissao | null>(null);
  const [loadingComissoes, setLoadingComissoes] = useState(true);
  
  const [pls, setPls] = useState<PLPendente[]>([]);
  const [loadingPls, setLoadingPls] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch Comissoes
  useEffect(() => {
    async function fetchComissoes() {
      try {
        const response = await fetch('/api/comissoes/sapl/comissoes');
        if (!response.ok) throw new Error('Falha ao buscar comissões');
        const data = await response.json();
        setComissoes(data.results || []);
        if (data.results?.length > 0) {
          setSelectedComissao(data.results[0]);
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Erro ao carregar comissões');
      } finally {
        setLoadingComissoes(false);
      }
    }
    fetchComissoes();
  }, []);

  // Fetch PLs for Selected Comissao
  const fetchPls = useCallback(async () => {
    if (!selectedComissao) return;
    setLoadingPls(true);
    try {
      const sigla = selectedComissao.sigla || '';
      const response = await fetch(`/api/comissoes/sapl/pls?comissao=${encodeURIComponent(sigla)}`);
      if (!response.ok) throw new Error('Falha ao buscar PLs da comissão');
      const data = await response.json();
      setPls(data.pls || []);
    } catch (err: any) {
      console.error(err);
      // Optional: set a separate error state for PLs, or reuse
    } finally {
      setLoadingPls(false);
    }
  }, [selectedComissao]);

  useEffect(() => {
    fetchPls();
  }, [fetchPls]);

  return (
    <div style={{ background: '#f9fafb', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Topbar title="Comissões" subtitle="Gestão de comissões e pareceres pendentes" />
      
      <div style={{ display: 'flex', flex: 1, padding: '24px', gap: '24px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        
        {/* Sidebar: Comission List */}
        <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={16} /> Suas Comissões
              </h3>
            </div>
            
            <div style={{ padding: '8px' }}>
              {loadingComissoes && (
                <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                  <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto' }} />
                </div>
              )}
              
              {!loadingComissoes && comissoes.map(comissao => {
                const isSelected = selectedComissao?.id === comissao.id;
                return (
                  <button
                    key={comissao.id}
                    onClick={() => setSelectedComissao(comissao)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      background: isSelected ? '#eff6ff' : 'transparent',
                      color: isSelected ? '#1d4ed8' : '#334155',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: isSelected ? 600 : 500,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      transition: 'background 0.2s'
                    }}
                  >
                    <span style={{ fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {comissao.sigla || 'COM'} <ArrowRight size={14} style={{ opacity: isSelected ? 1 : 0 }} />
                    </span>
                    <span style={{ fontSize: '12px', color: isSelected ? '#488DC7' : '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {comissao.nome}
                    </span>
                  </button>
                );
              })}

              {!loadingComissoes && comissoes.length === 0 && !error && (
                <div style={{ padding: '16px', fontSize: '13px', color: '#64748b', textAlign: 'center' }}>
                  Nenhuma comissão ativa encontrada.
                </div>
              )}
              
              {error && (
                 <div style={{ padding: '16px', fontSize: '13px', color: '#ef4444', textAlign: 'center' }}>
                 {error}
               </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Area: PLs List */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {selectedComissao && (
            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#111827', margin: 0 }}>
                    {selectedComissao.nome}
                  </h2>
                  <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
                    Matérias aguardando parecer ou análise nesta comissão.
                  </p>
                </div>
                <div style={{ background: '#f3f4f6', padding: '6px 12px', borderRadius: '16px', fontSize: '13px', fontWeight: 600, color: '#374151' }}>
                  {pls.length} Pendentes
                </div>
              </div>

              {/* Members List (Optional) */}
              {selectedComissao.membros?.length > 0 && (
                <div style={{ marginTop: '20px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {selectedComissao.membros.map((m, i) => (
                    <span key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: '12px', padding: '4px 10px', borderRadius: '4px' }}>
                      <strong>{m.nome}</strong> ({m.cargo})
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {loadingPls && (
            <div style={{ background: 'white', borderRadius: '12px', padding: '64px', border: '1px solid #e5e7eb', textAlign: 'center', color: '#6b7280' }}>
               <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto 16px', color: '#488DC7' }} />
               Buscando matérias pendentes...
            </div>
          )}

          {!loadingPls && selectedComissao && pls.length === 0 && (
             <div style={{ background: 'white', borderRadius: '12px', padding: '64px', border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b' }}>
                <CheckCircle size={48} style={{ margin: '0 auto 16px', color: '#10b981', opacity: 0.5 }} />
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#334155' }}>Tudo em dia!</h3>
                <p style={{ marginTop: '8px', fontSize: '14px' }}>Nenhuma matéria pendente de parecer nesta comissão momentaneamente.</p>
             </div>
          )}

          {!loadingPls && pls.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '20px' }}>
              {pls.map(pl => {
                const needsOpinion = pl.pareceres_existentes === 0;

                return (
                  <div key={pl.id} style={{ 
                    background: 'white', 
                    borderRadius: '12px', 
                    padding: '24px', 
                    border: needsOpinion ? '1px solid #fca5a5' : '1px solid #e5e7eb',
                    borderLeft: needsOpinion ? '4px solid #ef4444' : '4px solid #488DC7',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: '#1f2937', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <FileText size={16} color="#6b7280" /> {pl.tipo_sigla} {pl.numero}/{pl.ano}
                      </span>
                      {needsOpinion ? (
                         <span style={{ fontSize: '11px', fontWeight: 700, background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: '12px', textTransform: 'uppercase' }}>
                           Sem Parecer
                         </span>
                      ) : (
                        <span style={{ fontSize: '11px', fontWeight: 600, background: '#ecfdf5', color: '#047857', padding: '2px 8px', borderRadius: '12px', textTransform: 'uppercase' }}>
                           {pl.pareceres_existentes} Anexos
                        </span>
                      )}
                    </div>

                    <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: '1.5', WebkitLineClamp: 3, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {pl.ementa}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: '#f8fafc', padding: '12px', borderRadius: '8px', marginTop: 'auto' }}>
                      <Clock size={16} color="#64748b" style={{ flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{pl.ultima_tramitacao?.status}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{pl.ultima_tramitacao?.data || 'Aguardando'}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                      <a 
                        href={pl.sapl_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ flex: 1, textAlign: 'center', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: 600, color: '#374151', textDecoration: 'none', background: 'white' }}
                      >
                        Ver no SAPL
                      </a>
                      <button 
                         style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, color: 'white', background: '#488DC7', cursor: 'pointer' }}
                         onClick={() => {
                           alert('Fluxo de Criação de Parecer/Voto (S5) em desenvolvimento.');
                         }}
                      >
                         Gerar Parecer
                      </button>
                    </div>

                  </div>
                )
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

