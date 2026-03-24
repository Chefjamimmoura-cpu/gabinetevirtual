'use client';

import { useState, useEffect, useCallback } from 'react';
import { GerarProtocolarModal } from './gerar-protocolar-modal';
import styles from './campo-kanban.module.css';
import { Plus, Search, MapPin, CheckCircle, FileText, Send, X, Camera, Clock } from 'lucide-react';

export interface IndicacaoCampo {
  id: string;
  titulo: string;
  bairro: string;
  logradouro: string;
  setores: string[];
  classificacao: string | null;
  responsavel_nome: string | null;
  status: string;
  fonte: string;
  documento_ementa: string | null;
  documento_gerado_md: string | null;
  protocolado_em: string | null;
  sapl_numero: string | null;
  fotos_urls: string[];
  geo_lat?: number | null;
  geo_lng?: number | null;
  created_at: string;
}

const COLUNAS = [
  { id: 'pendente',    label: 'Caixa de Entrada / ALIA', icon: <Search size={16}/>, cor: '#6b7280' },
  { id: 'protocolado', label: 'Protocolado (SAPL)',  icon: <Send size={16}/>, cor: '#488DC7' },
  { id: 'tramitacao',  label: 'Em Análise', icon: <Clock size={16}/>, cor: '#d97706' },
  { id: 'atendida',    label: 'Atendimento Concedido', icon: <CheckCircle size={16}/>, cor: '#10b981' },
  { id: 'arquivada',   label: 'Arquivada / Negada', icon: <X size={16}/>, cor: '#ef4444' }
] as const;

type ColId = typeof COLUNAS[number]['id'];

interface FiltrosCampo {
  responsavel: string;
  classificacao: string;
  bairro: string;
  search: string;
}

export function CampoKanban() {
  const [indicacoes, setIndicacoes] = useState<IndicacaoCampo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosCampo>({ responsavel: '', classificacao: '', bairro: '', search: '' });
  const [modalIndicacao, setModalIndicacao] = useState<IndicacaoCampo | null>(null);
  const [enviandoVisita, setEnviandoVisita] = useState<string | null>(null);
  const [novaModal, setNovaModal] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<ColId | null>(null);

  const fetchIndicacoes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fonte: 'campo' });
      if (filtros.responsavel) params.set('responsavel', filtros.responsavel);
      if (filtros.classificacao) params.set('classificacao', filtros.classificacao);
      if (filtros.bairro) params.set('bairro', filtros.bairro);
      if (filtros.search) params.set('q', filtros.search);

      const res = await fetch(`/api/indicacoes/campo?${params}`);
      if (res.ok) {
        const data = await res.json() as { results: IndicacaoCampo[] };
        setIndicacoes(data.results ?? []);
      }
    } catch (e) {
      console.error('Erro ao buscar indicações de campo:', e);
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  // Handle Drag and Drop
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('ind_id', id);
  };

  const handleDrop = async (e: React.DragEvent, targetColId: ColId) => {
    e.preventDefault();
    setDragOverCol(null);
    const indId = e.dataTransfer.getData('ind_id');
    if (!indId) return;

    // Optimistic UI Update
    setIndicacoes(prev => prev.map(ind => ind.id === indId ? { ...ind, status: targetColId } : ind));

    try {
      // Mock API call for the Backend Agent (Claude Opus) to implement later
      await fetch('/api/indicacoes/kanban-move', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indicacao_id: indId, novo_status: targetColId })
      });
    } catch (error) {
      console.error('Falha ao atualizar Kanban:', error);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnter = (colId: ColId) => {
    setDragOverCol(colId);
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  useEffect(() => { fetchIndicacoes(); }, [fetchIndicacoes]);

  async function enviarOrdemVisita(ind: IndicacaoCampo) {
    setEnviandoVisita(ind.id);
    try {
      const res = await fetch('/api/indicacoes/whatsapp/ordem-visita', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indicacao_id: ind.id }),
      });
      const data = await res.json() as { ok: boolean; error?: string; instrucao?: string };
      if (data.ok) {
        alert(`✅ Ordem de visita enviada para ${ind.responsavel_nome ?? 'equipe'}!`);
        fetchIndicacoes();
      } else {
        alert(`⚠️ ${data.error ?? 'Erro ao enviar'}\n${data.instrucao ?? ''}`);
      }
    } finally {
      setEnviandoVisita(null);
    }
  }

  const por_coluna = COLUNAS.reduce((acc, col) => {
    acc[col.id] = indicacoes.filter(ind => {
      // Mocked logic for the specific Kanban states
      if (col.id === 'pendente') return ind.status === 'pendente';
      if (col.id === 'protocolado') return ind.status === 'protocolado';
      if (col.id === 'tramitacao') return ind.status === 'tramitacao';
      if (col.id === 'atendida') return ind.status === 'atendida';
      if (col.id === 'arquivada') return ind.status === 'arquivada';
      return false;
    });
    return acc;
  }, {} as Record<ColId, IndicacaoCampo[]>);

  if (loading) {
    return (
      <div className={styles.kanbanContainer} style={{ alignItems: 'center', padding: '60px' }}>
        <p style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '8px' }}>
           Carregando indicações de campo...
        </p>
      </div>
    );
  }

  return (
    <div className={styles.kanbanContainer}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.filtros}>
          <input
            type="text"
            placeholder="🔍 Buscar logradouro, ementa..."
            value={filtros.search}
            onChange={e => setFiltros(f => ({ ...f, search: e.target.value }))}
            className={styles.input}
            style={{ width: '220px' }}
          />
          <input
            type="text"
            placeholder="Filtrar por Bairro"
            value={filtros.bairro}
            onChange={e => setFiltros(f => ({ ...f, bairro: e.target.value }))}
            className={styles.input}
            style={{ width: '160px' }}
          />
          <select
            value={filtros.classificacao}
            onChange={e => setFiltros(f => ({ ...f, classificacao: e.target.value }))}
            className={styles.select}
          >
            <option value="">Todas Classificações</option>
            <option value="urgencia">🔴 Urgência</option>
            <option value="prioridade">🟡 Prioridade</option>
            <option value="necessidade">🟢 Necessidade</option>
          </select>
          <input
            type="text"
            placeholder="Nome do Responsável"
            value={filtros.responsavel}
            onChange={e => setFiltros(f => ({ ...f, responsavel: e.target.value }))}
            className={styles.input}
            style={{ width: '160px' }}
          />
        </div>
        <button onClick={() => setNovaModal(true)} className={styles.btnNova}>
          <Plus size={16} /> Nova Indicação
        </button>
      </div>

      {/* Kanban */}
      <div className={styles.kanbanBoard}>
        {COLUNAS.map(col => {
          const cards = por_coluna[col.id] ?? [];
          return (
            <div 
              key={col.id} 
              className={`${styles.coluna} ${dragOverCol === col.id ? styles.colunaDragOver : ''}`}
              onDrop={(e) => handleDrop(e, col.id)}
              onDragOver={handleDragOver}
              onDragEnter={() => handleDragEnter(col.id)}
              onDragLeave={handleDragLeave}
            >
              <div className={styles.colunaHeader} style={{ borderColor: col.cor }}>
                <span style={{ color: col.cor, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {col.icon} {col.label}
                </span>
                <span className={styles.badge} style={{ background: col.cor }}>{cards.length}</span>
              </div>

              <div className={styles.cardsContainer}>
                {cards.length === 0 && (
                  <div className={styles.vazio}>Solte as indicações aqui...</div>
                )}
                {cards.map(ind => (
                  <CardIndicacao
                    key={ind.id}
                    ind={ind}
                    colId={col.id}
                    onEnviarVisita={() => enviarOrdemVisita(ind)}
                    onGerarProtocolar={() => setModalIndicacao(ind)}
                    enviando={enviandoVisita === ind.id}
                    onDragStart={(e) => handleDragStart(e, ind.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Gerar + Protocolar */}
      {modalIndicacao && (
        <GerarProtocolarModal
          indicacao={modalIndicacao}
          onClose={() => setModalIndicacao(null)}
          onSuccess={() => {
            setModalIndicacao(null);
            fetchIndicacoes();
          }}
        />
      )}

      {/* Modal Nova Indicação */}
      {novaModal && (
        <NovaIndicacaoModal
          onClose={() => setNovaModal(false)}
          onSuccess={() => { setNovaModal(false); fetchIndicacoes(); }}
        />
      )}
    </div>
  );
}

// ── Card da Indicação ─────────────────────────────────────────
function CardIndicacao({
  ind, colId, onEnviarVisita, onGerarProtocolar, enviando, onDragStart
}: {
  ind: IndicacaoCampo;
  colId: ColId;
  onEnviarVisita: () => void;
  onGerarProtocolar: () => void;
  enviando: boolean;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const urgEmoji = ind.classificacao === 'urgencia' ? '🔴' : ind.classificacao === 'prioridade' ? '🟡' : '🟢';
  const urgClass = ind.classificacao || 'necessidade';
  const idCurto = ind.id.substring(0, 8).toUpperCase();

  return (
    <div 
      className={styles.card}
      draggable
      onDragStart={onDragStart}
      style={{ cursor: 'grab' }}
    >
      <div className={styles.cardHeader}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className={styles.idBadge}>{idCurto}</span>
          <span title={urgClass} style={{ fontSize: '0.8rem' }}>{urgEmoji}</span>
        </div>
        {ind.fotos_urls?.length > 0 && <span title="Contém fotos" style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}><Camera size={14}/> {ind.fotos_urls.length}</span>}
      </div>

      <p className={styles.cardLocal}>
        <strong>{ind.logradouro}</strong><br />
        <span className={styles.bairroText}>{ind.bairro}</span>
      </p>

      {ind.setores?.length > 0 && (
        <div className={styles.setoresRow}>
          {ind.setores.slice(0, 3).map(s => (
            <span key={s} className={styles.setorTag}>{s}</span>
          ))}
          {ind.setores.length > 3 && <span className={styles.setorTag}>+{ind.setores.length - 3}</span>}
        </div>
      )}

      {ind.responsavel_nome && (
        <div className={styles.responsavel}>
          <span style={{ fontSize: '0.8rem' }}>👤</span> {ind.responsavel_nome}
        </div>
      )}

      {/* Ementa gerada */}
      {ind.documento_ementa && (
        <div className={styles.ementa} title={ind.documento_ementa}>
          {ind.documento_ementa.substring(0, 80)}...
        </div>
      )}

      {/* SAPL número */}
      {ind.sapl_numero && (
        <p style={{ color: '#059669', fontSize: '0.8rem', fontWeight: 700, marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <CheckCircle size={14} /> {ind.sapl_numero}
        </p>
      )}

      {/* Ações por coluna */}
      <div className={styles.cardActions}>
        {colId === 'pendente' && (
          <button
            onClick={onEnviarVisita}
            disabled={enviando}
            className={styles.btnCardSecundario}
          >
            {enviando ? 'Movendo...' : '📍 Passar para Protocolo'}
          </button>
        )}
        {(colId === 'pendente' || colId === 'protocolado' || colId === 'tramitacao') && (
          <button onClick={onGerarProtocolar} className={styles.btnCardPrimario}>
            {ind.documento_ementa ? (
              <><Send size={14} style={{ marginRight: '4px' }}/> Protocolar SAPL</>
            ) : (
              <><FileText size={14} style={{ marginRight: '4px' }}/> Gerar AI</>
            )}
          </button>
        )}
      </div>

      <div className={styles.dataCard}>
        <span>{new Date(ind.created_at).toLocaleDateString('pt-BR')}</span>
        <span>{ind.fonte === 'fala_cidadao' ? 'Fala Cidadão' : ind.fonte}</span>
      </div>
    </div>
  );
}

// ── Modal Nova Indicação ──────────────────────────────────────
function NovaIndicacaoModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ bairro: '', logradouro: '', setores: '', classificacao: 'necessidade', responsavel_nome: '', observacoes: '' });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  async function handleSubmit() {
    if (!form.bairro.trim() || !form.logradouro.trim()) {
      setErro('Bairro e logradouro são obrigatórios');
      return;
    }
    setLoading(true);
    setErro('');
    try {
      const res = await fetch('/api/indicacoes/nova', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bairro: form.bairro.trim(),
          logradouro: form.logradouro.trim(),
          setores: form.setores.split(',').map(s => s.trim()).filter(Boolean),
          classificacao: form.classificacao,
          responsavel_nome: form.responsavel_nome.trim() || undefined,
          observacoes: form.observacoes.trim() || undefined,
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        onSuccess();
      } else {
        setErro(data.error ?? 'Erro ao criar indicação');
      }
    } catch {
      setErro('Erro de conexão');
    } finally {
      setLoading(false);
    }
  }

  const campo = (label: string, key: keyof typeof form, placeholder = '', type: 'text' | 'select' | 'textarea' = 'text') => (
    <div key={key} className={styles.formGroup}>
      <label className={styles.label}>{label}</label>
      {type === 'select' ? (
        <select value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={styles.input} style={{ width: '100%' }}>
          <option value="necessidade">🟢 Necessidade</option>
          <option value="prioridade">🟡 Prioridade</option>
          <option value="urgencia">🔴 Urgência</option>
        </select>
      ) : type === 'textarea' ? (
        <textarea value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} className={`${styles.input} ${styles.textarea}`} style={{ width: '100%' }} />
      ) : (
        <input type="text" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} className={styles.input} style={{ width: '100%' }} />
      )}
    </div>
  );

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitulo}>Adicionar Indicação de Campo</h2>
          <button onClick={onClose} className={styles.btnFechar}><X size={20}/></button>
        </div>
        {campo('Bairro *', 'bairro', 'Ex: João de Barro')}
        {campo('Logradouro *', 'logradouro', 'Ex: Rua sem nome, Av. Principal')}
        {campo('Setores (separados por vírgula)', 'setores', 'Ex: Asfalto, Limpeza, Drenagem')}
        {campo('Classificação', 'classificacao', '', 'select')}
        {campo('Responsável pelo campo', 'responsavel_nome', 'Ex: José Ribamar')}
        {campo('Observações', 'observacoes', 'Notas do local...', 'textarea')}
        
        {erro && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '12px' }}>{erro}</p>}
        
        <div className={styles.btnRow}>
          <button onClick={onClose} className={styles.btnCardSecundario} style={{ padding: '8px 16px', flex: 'none' }}>Cancelar</button>
          <button onClick={handleSubmit} disabled={loading} className={styles.btnNova} style={{ flex: 'none' }}>
            {loading ? 'Salvando...' : 'Criar Indicação'}
          </button>
        </div>
      </div>
    </div>
  );
}

