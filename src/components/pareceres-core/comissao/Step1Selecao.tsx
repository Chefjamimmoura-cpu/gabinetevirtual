'use client';
import React, { useMemo, useState } from 'react';
import { Search, Info, ArrowRight, Loader2 } from 'lucide-react';
import styles from './comissao-wizard.module.css';
import { MateriaFila } from './types';

interface Step1SelecaoProps {
  materias: MateriaFila[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onAvancar: () => void;
  onIrDiretoPareceres?: () => void;
  loading: boolean;
}

type SortBy = 'data_desc' | 'data_asc' | 'numero_asc' | 'numero_desc';

function formatRelativeDate(dateStr: string | null | undefined): { relative: string; full: string } {
  if (!dateStr) return { relative: '—', full: '—' };
  const date = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const full = date.toLocaleDateString('pt-BR');

  if (diffDays < 0) return { relative: 'futuro', full };
  if (diffDays === 0) return { relative: 'hoje', full };
  if (diffDays === 1) return { relative: 'ontem', full };
  if (diffDays < 30) return { relative: `há ${diffDays} dias`, full };
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return { relative: `há ${months} ${months === 1 ? 'mês' : 'meses'}`, full };
  }
  const years = Math.floor(diffDays / 365);
  return { relative: `há ${years} ${years === 1 ? 'ano' : 'anos'}`, full };
}

function isOldMateria(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr + 'T00:00:00');
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return date < sixMonthsAgo;
}

export function Step1Selecao({
  materias, selectedIds, onToggle, onSelectAll, onDeselectAll, onAvancar, onIrDiretoPareceres, loading
}: Step1SelecaoProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('data_desc');
  const [filterTipo, setFilterTipo] = useState<string | null>(null);

  const tiposCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    materias.forEach(m => { counts[m.tipo_sigla] = (counts[m.tipo_sigla] || 0) + 1; });
    return counts;
  }, [materias]);

  const filtered = useMemo(() => {
    let result = [...materias];
    if (filterTipo) result = result.filter(m => m.tipo_sigla === filterTipo);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(m => {
        const numStr = `${m.tipo_sigla} ${m.numero}/${m.ano}`.toLowerCase();
        const numStr2 = `${m.tipo_sigla} ${m.numero}`.toLowerCase();
        const ementaMatch = (m.ementa || '').toLowerCase().includes(q);
        return numStr.includes(q) || numStr2.includes(q) || ementaMatch || String(m.numero).includes(q);
      });
    }
    result.sort((a, b) => {
      switch (sortBy) {
        case 'data_desc': return (b.data_tramitacao || '1900-01-01').localeCompare(a.data_tramitacao || '1900-01-01');
        case 'data_asc': return (a.data_tramitacao || '1900-01-01').localeCompare(b.data_tramitacao || '1900-01-01');
        case 'numero_asc': return a.numero - b.numero;
        case 'numero_desc': return b.numero - a.numero;
        default: return 0;
      }
    });
    return result;
  }, [materias, searchQuery, sortBy, filterTipo]);

  const allSelected = selectedIds.size === materias.length && materias.length > 0;

  if (loading) {
    return (
      <div style={{ padding: '32px 12px', textAlign: 'center' }}>
        <Loader2 size={24} color="#94a3b8" className={styles.spinIcon} />
        <p style={{ color: '#9ca3af', fontSize: '0.78rem', marginTop: 8 }}>Carregando fila...</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div className={styles.searchBar}>
        <div className={styles.searchInputWrapper}>
          <Search size={15} className={styles.searchIcon} />
          <input type="text" placeholder="Buscar por número, tipo ou texto... (ex: PLL 32)"
            className={styles.searchInput} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <select className={styles.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}>
          <option value="data_desc">Mais recentes primeiro</option>
          <option value="data_asc">Mais antigas primeiro</option>
          <option value="numero_desc">Número (decrescente)</option>
          <option value="numero_asc">Número (crescente)</option>
        </select>
      </div>

      <div className={styles.filterChips}>
        <button className={`${styles.chip} ${!filterTipo ? styles.chipActive : ''}`} onClick={() => setFilterTipo(null)}>
          Todos ({materias.length})
        </button>
        {Object.entries(tiposCounts).sort().map(([tipo, count]) => (
          <button key={tipo} className={`${styles.chip} ${filterTipo === tipo ? styles.chipActive : ''}`}
            onClick={() => setFilterTipo(filterTipo === tipo ? null : tipo)}>
            {tipo} ({count})
          </button>
        ))}
      </div>

      <div className={styles.instructionBanner}>
        <Info size={16} color="#15803d" style={{ flexShrink: 0 }} />
        Selecione as matérias que serão discutidas na reunião da comissão. Elas comporão a ATA e os Pareceres.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflowY: 'auto', paddingRight: 4 }}>
        {!loading && filtered.length === 0 && (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#9ca3af', fontSize: '0.82rem' }}>
            {searchQuery || filterTipo ? 'Nenhuma matéria encontrada com esses filtros.' : 'Nenhuma matéria na fila desta comissão.'}
          </div>
        )}
        {filtered.map(m => {
          const sel = selectedIds.has(m.id);
          const old = isOldMateria(m.data_tramitacao);
          const { relative, full } = formatRelativeDate(m.data_tramitacao);
          return (
            <div key={m.id}
              className={`${styles.materiaItem} ${sel ? styles.materiaItemSelected : ''} ${old && !sel ? styles.materiaItemOld : ''}`}
              onClick={() => onToggle(m.id)}>
              <input type="checkbox" checked={sel} onChange={() => onToggle(m.id)} onClick={e => e.stopPropagation()}
                style={{ accentColor: '#16325B', width: 16, height: 16, cursor: 'pointer' }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`${styles.materiaNumber} ${sel ? styles.materiaNumberSelected : ''}`}>
                    {m.tipo_sigla} {m.numero}/{m.ano}
                  </span>
                  <span className={styles.materiaDate} title={full}>{relative}</span>
                </div>
                <p className={styles.materiaEmenta}>{m.ementa || '(sem ementa)'}</p>
                <span className={styles.materiaAutor}>{m.autores ? `Autor: ${m.autores}` : ''}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.stepFooter}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 600 }}>
            {selectedIds.size} matéria{selectedIds.size !== 1 ? 's' : ''} selecionada{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <button onClick={allSelected ? onDeselectAll : onSelectAll}
            style={{ fontSize: '0.72rem', color: '#16325B', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onIrDiretoPareceres && (
            <button className={styles.btnSecondary} onClick={onIrDiretoPareceres}>
              Ir direto aos Pareceres →
            </button>
          )}
          <button className={styles.btnPrimary} onClick={onAvancar} disabled={selectedIds.size === 0}>
            Avançar para ATA <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
