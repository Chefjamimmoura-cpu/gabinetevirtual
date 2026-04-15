'use client';
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, History, RotateCcw } from 'lucide-react';
import styles from './comissao-wizard.module.css';
import { Reuniao } from './types';

interface ReunioesHistoricoProps {
  reunioes: Reuniao[];
  onReabrir: (reuniao: Reuniao) => void;
}

export function ReunioesHistorico({ reunioes, onReabrir }: ReunioesHistoricoProps) {
  const [open, setOpen] = useState(false);

  if (reunioes.length === 0) return null;

  return (
    <div className={styles.historicoCard}>
      <div className={styles.historicoHeader} onClick={() => setOpen(o => !o)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>
          <History size={14} /> Reuniões anteriores ({reunioes.length})
        </span>
        {open ? <ChevronUp size={16} color="#6b7280" /> : <ChevronDown size={16} color="#6b7280" />}
      </div>
      {open && (
        <div className={styles.historicoList}>
          {reunioes.map(r => (
            <div key={r.id} className={styles.historicoItem}>
              <div>
                <span style={{ fontWeight: 600, color: '#374151' }}>
                  {new Date(r.data_sessao + 'T00:00:00').toLocaleDateString('pt-BR')}
                </span>
                <span style={{ marginLeft: 8, fontSize: '0.72rem', color: '#6b7280' }}>
                  {r.total_materias} matéria{r.total_materias !== 1 ? 's' : ''}
                </span>
                <span style={{ marginLeft: 8, fontSize: '0.68rem', fontWeight: 600, color: r.pareceres_gerados === r.total_materias ? '#15803d' : '#b45309' }}>
                  {r.pareceres_gerados}/{r.total_materias} pareceres
                </span>
              </div>
              <button onClick={() => onReabrir(r)}
                style={{ padding: '4px 12px', background: '#eaf1f8', color: '#16325B', border: '1px solid #c6d9ed', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RotateCcw size={12} /> Reabrir
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
