'use client';
import React, { useState } from 'react';
import { ArrowLeft, Check, Loader2, ExternalLink, Building2 } from 'lucide-react';
import { DocumentPreview } from './DocumentPreview';
import styles from './comissao-wizard.module.css';

interface MateriaFila {
  id: number;
  tipo_sigla: string;
  numero: number;
  ano: number;
  ementa: string;
  autores: string;
  sapl_url?: string;
  [key: string]: unknown;
}

interface ParecerResult { texto: string; voto: string; }

interface Step3PareceresProps {
  materias: MateriaFila[];
  parecerResults: Map<number, ParecerResult>;
  isGerando: boolean;
  onGerarParecer: (materiaId: number, voto: string) => void;
  onExportOdt: (materiaId: number) => void;
  onExportDocx: (materiaId: number) => void;
  onVoltar: () => void;
  onConcluir: () => void;
}

export function Step3Pareceres({
  materias, parecerResults, isGerando, onGerarParecer, onExportOdt, onExportDocx, onVoltar, onConcluir
}: Step3PareceresProps) {
  const [activeMateriaId, setActiveMateriaId] = useState<number>(materias[0]?.id ?? 0);
  const [votos, setVotos] = useState<Map<number, string>>(() => new Map(materias.map(m => [m.id, 'FAVORÁVEL'])));

  const activeMateria = materias.find(m => m.id === activeMateriaId);
  const activeResult = parecerResults.get(activeMateriaId);
  const activeVoto = votos.get(activeMateriaId) || 'FAVORÁVEL';
  const doneCount = parecerResults.size;
  const totalCount = materias.length;
  const allDone = doneCount === totalCount;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  const setVoto = (materiaId: number, voto: string) => {
    setVotos(prev => new Map(prev).set(materiaId, voto));
  };

  return (
    <div className={styles.pareceresGrid}>
      {/* SIDEBAR */}
      <div className={styles.pareceresSidebar}>
        <div className={styles.sidebarHeader}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pareceres</span>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.68rem', color: '#6b7280' }}>Progresso</span>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#16325B' }}>{doneCount} de {totalCount}</span>
            </div>
            <div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progressPct}%` }} /></div>
          </div>
        </div>

        {materias.map((m, idx) => {
          const isDone = parecerResults.has(m.id);
          const isActive = m.id === activeMateriaId;
          const result = parecerResults.get(m.id);
          return (
            <div key={m.id} className={`${styles.sidebarItem} ${isActive ? styles.sidebarItemActive : ''} ${isDone ? styles.sidebarItemDone : ''}`}
              onClick={() => setActiveMateriaId(m.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isDone ? '#15803d' : isActive ? '#16325B' : '#374151' }}>
                  {m.tipo_sigla} {m.numero}/{m.ano}
                </span>
                {isDone ? (
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Check size={12} color="#fff" strokeWidth={3} />
                  </div>
                ) : (
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#6b7280' }}>{idx + 1}</span>
                  </div>
                )}
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: '#6b7280', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {m.ementa || '(sem ementa)'}
              </p>
              {isDone && result ? (
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <span className={`${styles.statusBadge} ${styles.badgeDone}`}>Parecer gerado</span>
                  <span className={`${styles.statusBadge} ${styles.badgeDone}`}>{result.voto}</span>
                </div>
              ) : (
                <span className={`${styles.statusBadge} ${styles.badgePending}`}>Aguardando parecer</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ÁREA PRINCIPAL */}
      <div className={styles.parecerMain}>
        {activeMateria && (
          <>
            <div className={styles.parecerHeader}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#16325B' }}>
                    {activeMateria.tipo_sigla} {activeMateria.numero}/{activeMateria.ano}
                  </span>
                  <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#374151', lineHeight: 1.4 }}>{activeMateria.ementa}</p>
                  <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: '#6b7280' }}>Autor: {activeMateria.autores || '—'}</p>
                </div>
                {activeMateria.sapl_url && (
                  <a href={activeMateria.sapl_url as string} target="_blank" rel="noopener noreferrer"
                    style={{ flexShrink: 0, padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', color: '#374151', fontSize: '0.72rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ExternalLink size={11} /> SAPL
                  </a>
                )}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#374151' }}>Voto:</span>
                {(['FAVORÁVEL', 'CONTRÁRIO', 'SEGUIR RELATOR'] as const).map(v => (
                  <button key={v} type="button" onClick={() => setVoto(activeMateriaId, v)}
                    className={`${styles.votoBtn} ${activeVoto === v ? (v === 'FAVORÁVEL' ? styles.votoFavoravel : v === 'CONTRÁRIO' ? styles.votoContrario : styles.votoSeguirRelator) : ''}`}
                    style={{ flex: v === 'SEGUIR RELATOR' ? 1.3 : 1 }}>
                    {v === 'FAVORÁVEL' ? '✓ FAVORÁVEL' : v === 'CONTRÁRIO' ? '✗ CONTRÁRIO' : '↪ SEGUIR RELATOR'}
                  </button>
                ))}
                <div style={{ marginLeft: 'auto' }}>
                  <button className={styles.btnPrimary} onClick={() => onGerarParecer(activeMateriaId, activeVoto)} disabled={isGerando}>
                    {isGerando ? <><Loader2 size={16} className={styles.spinIcon} /> Gerando...</> : <><Building2 size={16} /> Gerar Parecer</>}
                  </button>
                </div>
              </div>
            </div>

            <div className={styles.parecerContent}>
              {isGerando && (
                <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <Loader2 size={48} color="#94a3b8" className={styles.spinIcon} />
                  <p style={{ color: '#6b7280', fontSize: '0.82rem', marginTop: 12 }}>Gerando parecer...</p>
                </div>
              )}
              {activeResult && !isGerando && (
                <>
                  <div className={styles.successBanner}>
                    <div className={styles.successIcon}><Check size={14} color="#fff" strokeWidth={3} /></div>
                    <span style={{ fontWeight: 600, color: '#15803d', fontSize: '0.82rem' }}>Parecer gerado! Baixe ou avance para a próxima matéria.</span>
                  </div>
                  <DocumentPreview content={activeResult.texto} tipo="parecer"
                    onExportOdt={() => onExportOdt(activeMateriaId)} onExportDocx={() => onExportDocx(activeMateriaId)} />
                </>
              )}
              {!activeResult && !isGerando && (
                <div style={{ padding: '48px 16px', textAlign: 'center', color: '#9ca3af' }}>
                  <Building2 size={36} color="#d1d5db" />
                  <p style={{ marginTop: 8, fontSize: '0.82rem' }}>Selecione o voto e clique em "Gerar Parecer".</p>
                </div>
              )}
            </div>

            <div className={styles.parecerFooter}>
              <button className={styles.btnSecondary} onClick={onVoltar}><ArrowLeft size={15} /> Voltar para ATA</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{doneCount} de {totalCount} pareceres gerados</span>
                {allDone && <button className={styles.btnGreen} onClick={onConcluir}><Check size={16} /> Concluir Reunião</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
