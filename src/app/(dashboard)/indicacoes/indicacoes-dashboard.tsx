'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Search, Plus, CheckCircle, Clock, FileWarning, Filter, Loader2, ExternalLink, Send, X, Archive, Shield, ClipboardList, Map as MapIcon, Zap } from 'lucide-react';
import styles from './indicacoes-dashboard.module.css';
import { CampoKanban } from './components/campo-kanban';
import { IndicacoesMapa } from './components/indicacoes-mapa';
import LaiaDashboard from '../laia/laia-dashboard';
import { IndicacoesModeracao } from './components/indicacoes-moderacao';
import { FalaCidadaoInbox } from './components/fala-cidadao-inbox';

type Aba = 'fala_cidadao' | 'moderacao' | 'sapl' | 'mapa' | 'alia';

interface IndicacaoSAPL {
  id: number;
  numero: number;
  ano: number;
  tipo_sigla: string;
  ementa: string;
  em_tramitacao: boolean;
  data_apresentacao: string;
  sapl_url: string;
  ultima_tramitacao: {
    data: string;
    status: string;
    destino: string;
  } | null;
}

export default function IndicacoesDashboard() {
  const [abaAtiva, setAbaAtiva] = useState<Aba>('moderacao');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tipoFilter, setTipoFilter] = useState('ALL');
  const [anoFilter, setAnoFilter] = useState('');
  const [autorFilter, setAutorFilter] = useState('127');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<IndicacaoSAPL[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Configuration and Feature Flags
  const [hasFalaCidadao, setHasFalaCidadao] = useState(false);

  // Auto-Protocolo Modal
  const [showProtocolModal, setShowProtocolModal] = useState(false);
  const [protocolLoading, setProtocolLoading] = useState(false);
  const [protocolData, setProtocolData] = useState({ ementa: '', tipo_sigla: 'IND', observacao: '' });
  const [protocolMessage, setProtocolMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/indicacoes/sapl', window.location.origin);
      url.searchParams.append('page', page.toString());
      url.searchParams.append('page_size', '20');
      if (searchTerm) url.searchParams.append('q', searchTerm);
      if (anoFilter) url.searchParams.append('ano', anoFilter);
      if (tipoFilter !== 'ALL') url.searchParams.append('tipo', tipoFilter);
      if (statusFilter !== 'all') url.searchParams.append('em_tramitacao', statusFilter);
      if (autorFilter) url.searchParams.append('autor', autorFilter);
      
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error('Falha ao buscar dados do SAPL');
      
      const result = await response.json();
      setData(result.results || []);
      setTotal(result.total || 0);
      setTotalPages(result.total_pages || 1);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, page, anoFilter, tipoFilter, statusFilter, autorFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm, page, anoFilter, tipoFilter, statusFilter, autorFilter, fetchData]);

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch('/api/gabinete/config');
        if (res.ok) {
          const config = await res.json();
          setHasFalaCidadao(config.has_fala_cidadao === true);
        }
      } catch (err) {
        console.error('Failed to load configs', err);
      }
    }
    loadConfig();
  }, []);

  // Handle Page Change
  const handleNextPage = () => { if (page < totalPages) setPage(p => p + 1); };
  const handlePrevPage = () => { if (page > 1) setPage(p => p - 1); };

  const filteredData = data.filter(ind => {
    // Client-side status filter if statusFilter !== 'Todos'
    // SAPL doesn't always have a clean 1-to-1 match for our UI badges, 
    // so we derive a mapped status for filtering
    const mappedStatus = getMappedStatus(ind);
    const matchesStatus = statusFilter === 'Todos' || mappedStatus === statusFilter;
    return matchesStatus;
  });

  function getMappedStatus(ind: IndicacaoSAPL) {
    if (!ind.em_tramitacao) return 'Finalizada / Arquivada';
    if (!ind.ultima_tramitacao) return 'Enviada';
    const s = ind.ultima_tramitacao.status.toLowerCase();
    if (s.includes('aprovad') || s.includes('execut')) return 'Executada';
    if (s.includes('recebid') || s.includes('lida')) return 'Enviada';
    return 'Em Análise';
  }

  const getStatusBadgeClass = (status: string) => {
    switch(status) {
      case 'Enviada': return styles.statusEnviada;
      case 'Em Análise': return styles.statusAnalise;
      case 'Executada': return styles.statusExecutada;
      case 'Finalizada / Arquivada': return styles.statusNegada;
      default: return styles.statusAnalise;
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    // Format YYYY-MM-DD to DD/MM/YYYY
    const [y, m, d] = dateString.split('-');
    if (y && m && d) return `${d}/${m}/${y}`;
    return dateString;
  };

  const handleProtocolar = async (e: React.FormEvent) => {
    e.preventDefault();
    setProtocolLoading(true);
    setProtocolMessage(null);
    try {
      const res = await fetch('/api/sapl/protocolar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descricao: protocolData.ementa,
          tipo_sigla: protocolData.tipo_sigla,
          observacao: protocolData.observacao
        })
      });
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 503) {
           setProtocolMessage({ text: data.error || data.mensagem || 'Token não configurado. Verifique o .env da VPS.', type: 'warning' });
        } else {
           throw new Error(data.error || 'Erro ao protocolar matéria.');
        }
        return;
      }
      
      setProtocolMessage({ text: `Sucesso! Matéria lançada no SAPL: ${data.numero_proposicao} (${data.tipo_sigla}).`, type: 'success' });
      
      // Limpa após 3 seg
      setTimeout(() => {
        setShowProtocolModal(false);
        setProtocolData({ ementa: '', tipo_sigla: 'IND', observacao: '' });
        setProtocolMessage(null);
        fetchData();
      }, 3000);

    } catch (err: any) {
      setProtocolMessage({ text: err.message, type: 'error' });
    } finally {
      setProtocolLoading(false);
    }
  };

  return (
    <div className={styles.dashboardContainer}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.iconWrapper}>
            <MapPin size={24} color="#f59e0b" />
          </div>
          <div>
            <h1 className={styles.title}>Indicações & Requerimentos</h1>
            <p className={styles.subtitle}>Sincronizado em tempo real com o SAPL da CMBV</p>
          </div>
        </div>
        <div className={styles.headerActions}>
            <button 
              onClick={() => setShowProtocolModal(true)}
              className={styles.btnProtocolar}
            >
              <Send size={18} /> Protocolar no SAPL
            </button>
        </div>
      </header>

      {/* Navegação por abas */}
      <div className={styles.tabBar}>
        {([
          ...(hasFalaCidadao ? [{ id: 'fala_cidadao', label: <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}><Archive size={16} /> Inbox (Bruto)</div>, title: 'Triagem de E-mails e Redes Sociais' }] : []),
          { id: 'moderacao', label: <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}><Shield size={16} /> Kanban / Moderação ALIA</div>, title: 'Caixa de entrada multimídia e Kanban das Indicações' },
          { id: 'sapl',  label: <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}><ClipboardList size={16} /> SAPL</div>,  title: 'Indicações registradas no SAPL' },
          { id: 'mapa',  label: <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}><MapIcon size={16} /> Mapa</div>,  title: 'Mapa geoespacial das indicações' },
          { id: 'alia',  label: <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}><Zap size={16} /> Chat ALIA</div>,  title: 'Análise de Inteligência' },
        ] as { id: Aba; label: React.ReactNode; title: string }[]).map(aba => (
          <button
            key={aba.id}
            title={aba.title}
            onClick={() => setAbaAtiva(aba.id)}
            className={`${styles.tabButton} ${abaAtiva === aba.id ? styles.tabButtonActive : ''}`}
          >
            {aba.label}
          </button>
        ))}
      </div>

      {/* Aba Fala Cidadao Inbox */}
      {abaAtiva === 'fala_cidadao' && <FalaCidadaoInbox />}

      {/* Aba Moderação */}
      {abaAtiva === 'moderacao' && <IndicacoesModeracao />}

      {/* Aba Mapa */}
      {abaAtiva === 'mapa' && <IndicacoesMapa />}

      {/* Aba ALIA */}
      {abaAtiva === 'alia' && <LaiaDashboard />}

      {/* Aba SAPL — conteúdo original */}
      {abaAtiva === 'sapl' && <>

      {/* Metrics Row */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span className={styles.metricTitle}>Total Autorias (SAPL)</span>
            <FileWarning size={18} className={styles.metricIcon} />
          </div>
          <div className={styles.metricValue}>{loading ? '...' : total}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span className={styles.metricTitle}>Em Tramitação</span>
            <Clock size={18} className={styles.metricIcon} />
          </div>
          <div className={styles.metricValue}>{loading ? '...' : data.filter(d => d.em_tramitacao).length} <span style={{fontSize: '0.8rem', color: '#6b7280', fontWeight: 'normal'}}>nesta pág.</span></div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span className={styles.metricTitle}>Arquivadas / Lid.</span>
            <CheckCircle size={18} className={styles.metricIcon} />
          </div>
          <div className={styles.metricValue}>{loading ? '...' : data.filter(d => !d.em_tramitacao).length} <span style={{fontSize: '0.8rem', color: '#6b7280', fontWeight: 'normal'}}>nesta pág.</span></div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span className={styles.metricTitle}>Situação</span>
            <MapPin size={18} className={styles.metricIcon} />
          </div>
          <div className={styles.metricValue} style={{color: '#10b981'}}>Online</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchGroup} style={{ flex: 1 }}>
          <Search size={18} className={styles.searchIcon} />
          <input 
            type="text" 
            placeholder="Buscar nas ementas..." 
            className={styles.searchInput}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className={styles.filterGroup}>
          <Filter size={18} className={styles.metricIcon} />
          
          <select 
            className={styles.selectFilter}
            value={tipoFilter}
            onChange={(e) => { setTipoFilter(e.target.value); setPage(1); }}
          >
            <option value="ALL">IND+REQ+MOC</option>
            <option value="IND">Indicações (IND)</option>
            <option value="REQ">Requerimentos (REQ)</option>
            <option value="MOC">Moções (MOC)</option>
          </select>
          
          <select 
            className={styles.selectFilter}
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            style={{ width: '130px' }}
          >
            <option value="all">Todas</option>
            <option value="true">Em tramitação</option>
            <option value="false">Arquivadas</option>
          </select>

          <input 
            type="number"
            className={styles.selectFilter}
            placeholder="Ano"
            style={{ width: '80px', paddingLeft: '8px' }}
            value={anoFilter}
            onChange={(e) => { setAnoFilter(e.target.value); setPage(1); }}
          />

          <select 
            className={styles.selectFilter}
            value={autorFilter}
            onChange={(e) => { setAutorFilter(e.target.value); setPage(1); }}
            style={{ width: '160px', fontWeight: 500 }}
          >
            <option value="127">Vereadora Carol Dantas</option>
            <option value="124">Vereador Ítalo Otávio</option>
            <option value="123">Vereador Dr. Ilderson</option>
            <option value="128">Vereador Bruno Perez</option>
            <option value="114">Vereador Zélio Mota</option>
            <option value="117">Vereador Júlio Medeiros</option>
            <option value="121">Vereadora Tuti Lopes</option>
            <option value="122">Vereadora Aline Rezende</option>
            <option value="">Todos os Vereadores</option>
          </select>
        </div>
      </div>

      {/* Data Table */}
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Protocolo</th>
              <th>Ementa / Assunto</th>
              <th>Status SAPL</th>
              <th>Data</th>
              <th>UI Status</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>
                  <Loader2 size={24} className={styles.spinIcon} style={{ margin: '0 auto', color: '#f59e0b' }} />
                  <p style={{ marginTop: '8px', color: '#6b7280' }}>Buscando base do SAPL...</p>
                </td>
              </tr>
            )}
            
            {error && !loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: '#ef4444' }}>
                  Erro ao carregar dados: {error}
                </td>
              </tr>
            )}

            {!loading && !error && data.map((ind, index) => {
              const uStatus = getMappedStatus(ind);
              // Badge color depending on type
              let typeBg = '#e0e7ff';
              let typeColor = 'var(--primary-600)';
              if (ind.tipo_sigla === 'REQ') { typeBg = '#fef3c7'; typeColor = '#d97706'; }
              if (ind.tipo_sigla === 'MOC') { typeBg = '#f3e8ff'; typeColor = '#9333ea'; }

              return (
                <tr key={ind.id || index}>
                  <td className={styles.tdId}>
                    <span style={{ fontWeight: 'bold', color: typeColor, backgroundColor: typeBg, padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', marginRight: '6px' }}>{ind.tipo_sigla}</span> 
                    <strong>{ind.numero}/{ind.ano}</strong>
                  </td>
                  <td className={styles.tdSubject} style={{ maxWidth: '400px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ind.ementa}
                  </td>
                  <td className={styles.tdRegion}>
                    {ind.ultima_tramitacao ? ind.ultima_tramitacao.status : 'Sem tramitação'}
                  </td>
                  <td className={styles.tdDate}>{formatDate(ind.data_apresentacao)}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${getStatusBadgeClass(uStatus)}`}>
                      {uStatus}
                    </span>
                  </td>
                  <td>
                    <a href={ind.sapl_url} target="_blank" rel="noopener noreferrer" style={{ color: '#488DC7', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ExternalLink size={14} /> Abrir
                    </a>
                  </td>
                </tr>
              );
            })}
            
            {!loading && !error && data.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
                  Nenhuma indicação encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {!loading && !error && (
        <div className={styles.pagination}>
          <div className={styles.paginationInfo}>
            Mostrando página {page} de {totalPages} (Total: {total} matérias)
          </div>
          <div className={styles.paginationButtons}>
            <button 
              onClick={handlePrevPage} 
              disabled={page === 1}
              className={`${styles.btnPage} ${page === 1 ? styles.btnPageDisabled : ''}`}
            >
              Anterior
            </button>
            <button 
              onClick={handleNextPage} 
              disabled={page >= totalPages}
              className={`${styles.btnPage} ${page >= totalPages ? styles.btnPageDisabled : ''}`}
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Protocolar no SAPL */}
      {showProtocolModal && (
        <div className={styles.protocolOverlay}>
          <div className={styles.protocolModal}>
            <div className={styles.modalHeaderRow}>
              <h2 className={styles.modalTitle}>
                <Send size={20} color="#488DC7"/> Novo Protocolo SAPL
              </h2>
              <button onClick={() => setShowProtocolModal(false)} className={styles.btnCloseModal}><X size={20}/></button>
            </div>

            {protocolMessage && (
              <div className={`${styles.protocolAlert} ${
                protocolMessage.type === 'success' ? styles.alertSuccess : 
                protocolMessage.type === 'warning' ? styles.alertWarning : 
                styles.alertError
              }`}>
                {protocolMessage.text}
              </div>
            )}

            <form onSubmit={handleProtocolar} className={styles.protocolForm}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Tipo de Matéria</label>
                <select
                  value={protocolData.tipo_sigla}
                  onChange={e => setProtocolData({...protocolData, tipo_sigla: e.target.value})}
                  className={styles.formSelect}
                >
                  <option value="IND">Indicação (IND)</option>
                  <option value="REQ">Requerimento (REQ)</option>
                  <option value="MOC">Moção (MOC)</option>
                  <option value="PLL">Projeto de Lei Leg. (PLL)</option>
                  <option value="PDL">Projeto Decreto Leg. (PDL)</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Ementa (Assunto Principal) *</label>
                <textarea
                  required
                  minLength={10}
                  rows={4}
                  value={protocolData.ementa}
                  onChange={e => setProtocolData({...protocolData, ementa: e.target.value})}
                  placeholder="Ex: Indica ao poder executivo a realização de serviços de limpeza..."
                  className={styles.formTextarea}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel}>Observações (opcional)</label>
                <input
                  type="text"
                  value={protocolData.observacao}
                  onChange={e => setProtocolData({...protocolData, observacao: e.target.value})}
                  placeholder="Notas internas do protocolo"
                  className={styles.formInput}
                />
              </div>

              <button
                type="submit"
                disabled={protocolLoading}
                className={styles.btnSubmitProtocol}
              >
                {protocolLoading ? <Loader2 size={18} className={styles.spinIcon} /> : 'Protocolar no Sistema'}
              </button>
            </form>
          </div>
        </div>
      )}

      </>}

    </div>
  );
}

