'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ScrollText, Search, Plus, Loader2, ExternalLink, FileText, CheckCircle, Clock } from 'lucide-react';
import styles from './pls-dashboard.module.css';
import PlsNovaProposicao from './components/pls-nova-proposicao';

interface PLSapl {
  id: number;
  numero: number;
  ano: number;
  tipo_sigla: string;
  ementa: string;
  em_tramitacao: boolean;
  tem_texto: boolean;
  total_docs: number;
  sapl_url: string;
  ultima_tramitacao: {
    data: string;
    status: string;
    destino: string;
  } | null;
}

interface SAPLResponse {
  total: number;
  total_pages: number;
  resumo_por_tipo: Record<string, number>;
  results: PLSapl[];
}

export default function PlsDashboard() {
  const [isNovaProposicao, setIsNovaProposicao] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('Todos');
  const [autorFilter, setAutorFilter] = useState('127');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SAPLResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/pls/sapl', window.location.origin);
      url.searchParams.append('page', page.toString());
      if (searchTerm) url.searchParams.append('q', searchTerm);
      if (autorFilter) url.searchParams.append('autor', autorFilter);
      // If we are filtering by specific type (not 'Todos' and not 'Outros')
      if (activeTab !== 'Todos' && activeTab !== 'Outros') {
        url.searchParams.append('tipo', activeTab);
      }
      
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error('Falha ao buscar Projetos de Lei do SAPL');
      
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, activeTab, page, autorFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm, activeTab, page, autorFilter, fetchData]);

  // Handle Page Change
  const handleNextPage = () => { if (data && page < data.total_pages) setPage(p => p + 1); };
  const handlePrevPage = () => { if (page > 1) setPage(p => p - 1); };

  // Derived Values
  const resumo = data?.resumo_por_tipo || {};
  const plls = resumo['PLL'] || 0;
  const pdls = resumo['PDL'] || 0;
  const pres = resumo['PRE'] || 0;
  const totalGeral = data?.total || 0;
  
  // Calculate "Outros" assuming we only have specific tabs for PLL, PDL, PRE right now
  const outrosCount = Object.entries(resumo).reduce((acc, [key, count]) => {
    if (!['PLL', 'PDL', 'PRE'].includes(key)) {
      return acc + count;
    }
    return acc;
  }, 0);

  const getBadgeStyle = (tipo: string) => {
    switch(tipo) {
      case 'PLL': return { bg: '#eff6ff', color: '#488DC7', border: '#bfdbfe' }; // blue
      case 'PDL': return { bg: '#fef3c7', color: '#d97706', border: '#fde68a' }; // amber/yellow
      case 'PRE': return { bg: '#f3e8ff', color: '#9333ea', border: '#e9d5ff' }; // purple
      default: return { bg: '#f3f4f6', color: '#4b5563', border: '#e5e7eb' }; // gray
    }
  };

  const getStatusColor = (status: string | undefined | null) => {
    if (!status) return '#6b7280';
    const s = status.toLowerCase();
    if (s.includes('aprovado') || s.includes('sancionado') || s.includes('promulgado')) return '#10b981'; // green
    if (s.includes('arquivado') || s.includes('retirado')) return '#ef4444'; // red
    return '#f59e0b'; // orange for Em Comissão, Aguardando Parecer, etc
  };

  // Filter client side specifically for the 'Outros' tab if API doesn't support a negative 'Outros' filter natively
  const displayedResults = (data?.results || []).filter(pl => {
    if (activeTab === 'Outros') {
      return !['PLL', 'PDL', 'PRE'].includes(pl.tipo_sigla);
    }
    return true; // the API already filters if activeTab is PLL, PDL, etc.
  });

  return (
    <div className={styles.dashboardContainer} style={{ background: '#f9fafb', minHeight: '100vh', padding: '0 24px 24px' }}>
      <header className={styles.header} style={{ background: 'transparent', boxShadow: 'none', borderBottom: 'none', padding: '24px 0', flexDirection: 'column', alignItems: 'flex-start', gap: '20px' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div className={styles.headerLeft}>
            <div className={styles.iconWrapper} style={{ background: '#ecfdf5' }}>
              <ScrollText size={24} color="#10b981" />
            </div>
            <div>
              <h1 className={styles.title} style={{ fontSize: '1.5rem', color: '#111827' }}>Projetos de Lei</h1>
              <p className={styles.subtitle} style={{ color: '#4b5563' }}>Acompanhamento e tramitação legislativa sincronizada (SAPL)</p>
            </div>
          </div>
          
          <button 
            onClick={() => setIsNovaProposicao(true)}
            className={styles.btnNew} style={{ background: '#10b981', color: 'white', padding: '10px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <Plus size={18} /> Nova Proposição (IA)
          </button>
        </div>

        {/* Search Bar */}
        <div className={styles.searchGroup} style={{ width: '100%', maxWidth: '600px', position: 'relative' }}>
          <Search size={18} className={styles.searchIcon} style={{ position: 'absolute', left: '16px', top: '12px', color: '#9ca3af' }} />
          <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
            <input 
              type="text" 
              placeholder="Buscar por ementa, número ou tipo..." 
              className={styles.searchInput}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ flex: 1, padding: '11px 16px 11px 44px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontSize: '14px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
            />
            <select 
              value={autorFilter}
              onChange={(e) => { setAutorFilter(e.target.value); setPage(1); }}
              style={{
                padding: '11px 16px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                outline: 'none',
                fontSize: '14px',
                background: 'white',
                color: '#374151',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                fontWeight: 500,
                width: '180px'
              }}
            >
              <option value="127">Ver. Carol Dantas</option>
              <option value="124">Ver. Ítalo Otávio</option>
              <option value="123">Ver. Dr. Ilderson</option>
              <option value="128">Ver. Bruno Perez</option>
              <option value="114">Ver. Zélio Mota</option>
              <option value="117">Ver. Júlio Medeiros</option>
              <option value="121">Ver. Tuti Lopes</option>
              <option value="122">Ver. Aline Rezende</option>
              <option value="">Todos (Qualquer autor)</option>
            </select>
          </div>
        </div>
      </header>

      {isNovaProposicao ? (
        <PlsNovaProposicao onBack={() => setIsNovaProposicao(false)} />
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', borderBottom: '1px solid #e5e7eb', paddingBottom: '16px', overflowX: 'auto' }}>
            {[
          { id: 'Todos', label: 'Todos', count: totalGeral },
          { id: 'PLL', label: 'Projetos de Lei (PLL)', count: plls },
          { id: 'PDL', label: 'Decretos (PDL)', count: pdls },
          { id: 'PRE', label: 'Resoluções (PRE)', count: pres },
          { id: 'Outros', label: 'Outros', count: outrosCount }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setPage(1); }}
            style={{
              padding: '8px 16px',
              borderRadius: '999px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === tab.id ? '#111827' : '#f3f4f6',
              color: activeTab === tab.id ? 'white' : '#4b5563',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
            <span style={{ 
              background: activeTab === tab.id ? 'rgba(255,255,255,0.2)' : '#e5e7eb', 
              color: activeTab === tab.id ? 'white' : '#6b7280',
              padding: '2px 8px', borderRadius: '12px', fontSize: '12px' 
            }}>
              {loading && activeTab === tab.id ? '...' : tab.count}
            </span>
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px', color: '#6b7280' }}>
          <Loader2 size={32} className={styles.spinIcon} style={{ color: '#10b981', marginBottom: '16px' }} />
          Sincronizando com o SAPL...
        </div>
      )}

      {error && !loading && (
        <div style={{ padding: '24px', backgroundColor: '#fef2f2', color: '#b91c1c', borderRadius: '8px', border: '1px solid #fecaca' }}>
          Erro ao processar a requisição: {error}
        </div>
      )}

      {/* PL Cards Grid */}
      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
          {displayedResults.map((pl) => {
            const badge = getBadgeStyle(pl.tipo_sigla);
            const statusColor = getStatusColor(pl.ultima_tramitacao?.status);
            
            return (
              <div key={pl.id} style={{ 
                background: 'white', 
                borderRadius: '12px', 
                padding: '24px', 
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                transition: 'transform 0.2s, box-shadow 0.2s',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
              }}
              >
                {/* Card Header: Type Badge & Action */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ 
                      background: badge.bg, 
                      color: badge.color, 
                      border: `1px solid ${badge.border}`,
                      padding: '4px 8px', 
                      borderRadius: '6px', 
                      fontSize: '12px', 
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap'
                    }}>
                      <FileText size={14} />
                      {pl.tipo_sigla} {pl.numero}/{pl.ano}
                    </span>
                    {pl.tem_texto && (
                      <span title="Possui Texto Original anexado no SAPL" style={{ color: '#9ca3af', display: 'flex', alignItems: 'center' }}>
                        <ScrollText size={16} />
                      </span>
                    )}
                  </div>
                  <a href={pl.sapl_url} target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280', padding: '4px', marginTop: '-4px', marginRight: '-4px' }} title="Abrir no SAPL" onClick={(e) => e.stopPropagation()}>
                    <ExternalLink size={16} />
                  </a>
                </div>

                {/* Ementa */}
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '15px', color: '#374151', lineHeight: '1.5', fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {pl.ementa}
                  </p>
                </div>

                {/* Footer: Status */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', borderTop: '1px solid #f3f4f6', paddingTop: '16px', marginTop: 'auto' }}>
                  <div style={{ 
                    minWidth: '32px', 
                    height: '32px', 
                    borderRadius: '50%', 
                    background: `${statusColor}15`, 
                    color: statusColor,
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center' 
                  }}>
                    {pl.em_tramitacao ? <Clock size={16} /> : <CheckCircle size={16} />}
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: statusColor, marginBottom: '2px' }}>
                      {pl.ultima_tramitacao?.status || 'Recebida'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      {pl.ultima_tramitacao?.destino || 'Mesa Diretora'} · {pl.ultima_tramitacao?.data || '-'}
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Footer */}
      {!loading && !error && data && data.total_pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 0', marginTop: '8px' }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
            Página {page} de {data.total_pages} (Total: {data.total} matérias)
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={handlePrevPage} 
              disabled={page === 1}
              style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '8px', backgroundColor: page === 1 ? '#f3f4f6' : '#fff', color: page === 1 ? '#9ca3af' : '#374151', cursor: page === 1 ? 'not-allowed' : 'pointer', fontWeight: 500 }}
            >
              Anterior
            </button>
            <button 
              onClick={handleNextPage} 
              disabled={page >= data.total_pages}
              style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '8px', backgroundColor: page >= data.total_pages ? '#f3f4f6' : '#fff', color: page >= data.total_pages ? '#9ca3af' : '#374151', cursor: page >= data.total_pages ? 'not-allowed' : 'pointer', fontWeight: 500 }}
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {!loading && !error && displayedResults.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px', color: '#6b7280', background: 'white', borderRadius: '12px', border: '1px dashed #d1d5db' }}>
          <Script size={48} color="#d1d5db" style={{ margin: '0 auto 16px' }} />
          <p style={{ fontSize: '16px', fontWeight: 500, color: '#374151' }}>Nenhuma proposição encontrada</p>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>Tente ajustar os filtros ou os termos de busca.</p>
        </div>
      )}
      
      </>
      )}
    </div>
  );
}

const Script = ({ size, color, style }: any) => <FileText size={size} color={color} style={style} />;

