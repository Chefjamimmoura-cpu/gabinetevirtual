'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ScrollText, Search, Plus, Loader2, ExternalLink, FileText, CheckCircle, Clock, BarChart3, Archive, TrendingUp, Bot, Edit3, Users } from 'lucide-react';
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

interface TemaDistribuicao {
  tema: string;
  count: number;
}

interface PLInterno {
  id: string;
  numero_sapl: string | null;
  tipo: string;
  ementa: string | null;
  tema: string | null;
  status: string;
  aprovado_em: string | null;
  updated_at: string;
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
  const [temas, setTemas] = useState<TemaDistribuicao[]>([]);
  const [temasTotal, setTemasTotal] = useState(0);
  const [plsInternos, setPlsInternos] = useState<PLInterno[]>([]);
  const [plsInternosLoading, setPlsInternosLoading] = useState(true);

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

  // Fetch tema distribution (internal PLs)
  const fetchTemas = useCallback(async () => {
    try {
      const res = await fetch('/api/pls/distribuicao-temas');
      if (!res.ok) return;
      const result = await res.json();
      setTemas(result.distribuicao || []);
      setTemasTotal(result.total || 0);
    } catch {
      // Non-blocking — chart simply won't render
    }
  }, []);

  useEffect(() => {
    fetchTemas();
  }, [fetchTemas]);

  // Fetch internal PLs (ALIA-generated)
  const fetchPlsInternos = useCallback(async () => {
    setPlsInternosLoading(true);
    try {
      const res = await fetch('/api/pls/listar?per_page=10');
      if (!res.ok) return;
      const result = await res.json();
      setPlsInternos(result.results || []);
    } catch {
      // Non-blocking
    } finally {
      setPlsInternosLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlsInternos();
  }, [fetchPlsInternos]);

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

  // Derived metrics for cards
  const allResults = data?.results || [];
  const tramitandoCount = allResults.filter(pl => pl.em_tramitacao).length;
  const aprovadosCount = allResults.filter(pl => {
    const s = (pl.ultima_tramitacao?.status || '').toLowerCase();
    return s.includes('aprovad') || s.includes('sancionad') || s.includes('promulgad');
  }).length;
  const arquivadosCount = allResults.filter(pl => {
    const s = (pl.ultima_tramitacao?.status || '').toLowerCase();
    return s.includes('arquivad') || s.includes('retirad');
  }).length;

  // Chart colors — curated palette
  const CHART_COLORS = [
    '#10b981', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6',
    '#14b8a6', '#f97316', '#3b82f6', '#ef4444', '#84cc16',
    '#06b6d4', '#a855f7', '#d946ef', '#64748b',
  ];

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
            <span style={{
                padding: '11px 16px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                background: '#f9fafb',
                color: '#374151',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
              <Users size={15} style={{ color: '#10b981' }} />
              Ver. Carol Dantas
            </span>
          </div>
        </div>
      </header>

      {isNovaProposicao ? (
        <PlsNovaProposicao onBack={() => setIsNovaProposicao(false)} />
      ) : (
        <>
          {/* ── Metrics Header ── */}
          {!loading && !error && (
            <div className={styles.metricsGrid}>
              {[
                { label: 'Total', value: totalGeral, icon: <ScrollText size={20} />, bg: '#ecfdf5', color: '#10b981', border: '#a7f3d0' },
                { label: 'PLLs', value: plls, icon: <FileText size={20} />, bg: '#eff6ff', color: '#3b82f6', border: '#bfdbfe' },
                { label: 'Rascunhos ALIA', value: plsInternos.filter(p => p.status === 'RASCUNHO').length, icon: <Edit3 size={20} />, bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' },
                { label: 'Decretos', value: pdls, icon: <Archive size={20} />, bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
              ].map(m => (
                <div key={m.label} className={styles.metricCard}>
                  <div className={styles.metricIcon} style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
                    {m.icon}
                  </div>
                  <div>
                    <div className={styles.metricValue}>{m.value}</div>
                    <div className={styles.metricLabel}>{m.label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Rascunhos ALIA integrados antes dos cards SAPL */}
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', borderBottom: '1px solid #e5e7eb', paddingBottom: '16px', overflowX: 'auto' }}>
            {[
          { id: 'Todos', label: 'Todos', count: totalGeral },
          { id: 'PLL', label: 'Projetos de Lei (PLL)', count: plls },
          { id: 'PDL', label: 'Decretos (PDL)', count: pdls },
          { id: 'PRE', label: 'Resoluções (PRE)', count: pres }
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

      {/* PL Cards Grid — Rascunhos ALIA + SAPL unificados */}
      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
          {/* Rascunhos ALIA primeiro */}
          {plsInternos.filter(p => activeTab === 'Todos' || p.tipo === activeTab).map(pl => {
            const statusColors: Record<string, { bg: string; color: string; border: string }> = {
              'RASCUNHO': { bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' },
              'TRAMITANDO': { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
              'COMISSAO': { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
              'APROVADO': { bg: '#f0fdf4', color: '#059669', border: '#bbf7d0' },
              'ARQUIVADO': { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
            };
            const sc = statusColors[pl.status] || statusColors['RASCUNHO'];
            return (
              <div key={`alia-${pl.id}`} style={{
                background: 'white', borderRadius: '12px', padding: '24px',
                border: `2px solid ${sc.border}`, borderLeft: `4px solid ${sc.color}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                display: 'flex', flexDirection: 'column', gap: '12px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ background: sc.bg, color: sc.color, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>
                      {pl.status}
                    </span>
                    <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                      ALIA
                    </span>
                    {pl.tema && (
                      <span style={{ color: '#9ca3af', fontSize: '11px' }}>{pl.tema}</span>
                    )}
                  </div>
                  <Bot size={16} color="#7c3aed" />
                </div>
                <p style={{ fontSize: '15px', color: '#374151', lineHeight: '1.5', fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', margin: 0 }}>
                  {pl.ementa || 'Rascunho sem ementa'}
                </p>
                <div style={{ fontSize: '12px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px', marginTop: 'auto' }}>
                  <Edit3 size={12} />
                  {pl.aprovado_em
                    ? `Aprovado em ${new Date(pl.aprovado_em).toLocaleDateString('pt-BR')}`
                    : `Atualizado ${new Date(pl.updated_at).toLocaleDateString('pt-BR')}`}
                </div>
              </div>
            );
          })}
          {/* Cards SAPL */}
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

      {!loading && !error && displayedResults.length === 0 && plsInternos.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px', color: '#6b7280', background: 'white', borderRadius: '12px', border: '1px dashed #d1d5db' }}>
          <Script size={48} color="#d1d5db" style={{ margin: '0 auto 16px' }} />
          <p style={{ fontSize: '16px', fontWeight: 500, color: '#374151' }}>Nenhuma proposição encontrada</p>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>Tente ajustar os filtros ou crie uma nova proposição com a ALIA.</p>
        </div>
      )}

      {/* Distribuição temática — PLs do gabinete */}
      {temas.length > 0 && !loading && (
        <div className={styles.chartContainer} style={{ marginTop: '24px' }}>
          <div className={styles.chartTitle}>
            <BarChart3 size={16} color="#6366f1" />
            Distribuição Temática — PLs do Gabinete ({temasTotal})
          </div>
          {temas.slice(0, 8).map((t, i) => {
            const maxCount = temas[0]?.count || 1;
            const pct = Math.round((t.count / maxCount) * 100);
            return (
              <div key={t.tema} className={styles.chartBar}>
                <div className={styles.chartBarLabel} title={t.tema}>{t.tema}</div>
                <div className={styles.chartBarTrack}>
                  <div
                    className={styles.chartBarFill}
                    style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                </div>
                <div className={styles.chartBarCount}>{t.count}</div>
              </div>
            );
          })}
        </div>
      )}

      </>
      )}
    </div>
  );
}

const Script = ({ size, color, style }: any) => <FileText size={size} color={color} style={style} />;

