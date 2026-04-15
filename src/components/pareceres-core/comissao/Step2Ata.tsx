'use client';
import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, FileText, Loader2, Building2, Users, Check } from 'lucide-react';
import { DocumentPreview } from './DocumentPreview';
import styles from './comissao-wizard.module.css';
import { MateriaFila, ComissaoMembro, ComissaoConfig } from './types';

interface Step2AtaProps {
  materias: MateriaFila[];
  comissao: ComissaoConfig;
  membros: ComissaoMembro[];
  membrosLoading: boolean;
  ataResult: string | null;
  isGerando: boolean;
  onGerarAta: (params: { data: string; horaInicio: string; horaFim: string }) => void;
  onExportOdt: () => void;
  onExportDocx: () => void;
  onVoltar: () => void;
  onAvancar: () => void;
}

export function Step2Ata({
  materias, comissao, membros, membrosLoading, ataResult, isGerando,
  onGerarAta, onExportOdt, onExportDocx, onVoltar, onAvancar
}: Step2AtaProps) {
  const [data, setData] = useState(new Date().toISOString().split('T')[0]);
  const [horaInicio, setHoraInicio] = useState('OITO HORAS');
  const [horaFim, setHoraFim] = useState('NOVE HORAS');
  const cargoBadge = (cargo: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      presidente: { bg: '#eaf1f8', color: '#16325B', label: 'Presidente' },
      'vice-presidente': { bg: '#dbeafe', color: '#1d4ed8', label: 'Vice' },
      membro: { bg: '#f1f5f9', color: '#475569', label: 'Membro' },
      suplente: { bg: '#f8fafc', color: '#94a3b8', label: 'Suplente' },
    };
    return map[cargo.toLowerCase()] ?? { bg: '#f1f5f9', color: '#475569', label: cargo };
  };

  return (
    <div className={styles.ataGrid}>
      {/* COLUNA ESQUERDA: Formulário */}
      <div className={styles.ataForm}>
        {/* Resumo matérias */}
        <div className={styles.materiasResumo}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#16325B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Matérias da Reunião ({materias.length})
          </span>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {materias.map(m => (
              <div key={m.id} className={styles.materiasResumoItem}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#16325B' }}>{m.tipo_sigla} {m.numero}/{m.ano}</span>
                <span style={{ fontSize: '0.68rem', color: '#6b7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.ementa?.substring(0, 60)}...
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Info comissão + membros */}
        <div className={styles.comissaoInfo}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #c6d9ed', background: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: '#16325B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Building2 size={14} color="#fff" />
            </div>
            <div>
              <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#16325B' }}>{comissao.sigla}</span>
              <p style={{ margin: 0, fontSize: '0.68rem', color: '#6b7280' }}>{comissao.nome}</p>
            </div>
          </div>
          <div style={{ padding: '10px 14px' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Users size={12} /> Membros
              {membrosLoading && <Loader2 size={12} color="#94a3b8" className={styles.spinIcon} />}
            </span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {membros.map((m, i) => {
                const badge = cargoBadge(m.cargo);
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: '#fff', borderRadius: 6, border: '1px solid #c6d9ed' }}>
                    <span style={{ fontSize: '0.75rem', color: '#1f2937', fontWeight: 500 }}>Ver. {m.nome}</span>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: badge.bg, color: badge.color }}>{badge.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Campos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Data da Reunião</label>
            <input type="date" value={data} onChange={e => setData(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.82rem', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Início (extenso)</label>
              <input type="text" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} placeholder="OITO HORAS"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.8rem', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Fim (extenso)</label>
              <input type="text" value={horaFim} onChange={e => setHoraFim(e.target.value)} placeholder="NOVE HORAS"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.8rem', boxSizing: 'border-box' }} />
            </div>
          </div>
        </div>

        {/* Navegação */}
        <div className={styles.stepFooter}>
          <button className={styles.btnSecondary} onClick={onVoltar}><ArrowLeft size={15} /> Voltar</button>
          <button className={styles.btnTeal} onClick={() => onGerarAta({ data, horaInicio, horaFim })} disabled={isGerando}>
            {isGerando ? <><Loader2 size={16} className={styles.spinIcon} /> Gerando ATA...</> : <><FileText size={16} /> Gerar ATA ({materias.length} matéria{materias.length !== 1 ? 's' : ''})</>}
          </button>
        </div>
      </div>

      {/* COLUNA DIREITA: Preview */}
      <div className={styles.ataPreview}>
        {isGerando && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '48px 16px', textAlign: 'center', background: '#fff' }}>
            <Loader2 size={48} color="#94a3b8" className={styles.spinIcon} />
            <p style={{ color: '#6b7280', fontSize: '0.82rem', marginTop: 12 }}>Gerando ATA...</p>
          </div>
        )}
        {ataResult && !isGerando && (
          <>
            <div className={styles.successBanner}>
              <div className={styles.successIcon}><Check size={18} color="#fff" strokeWidth={3} /></div>
              <div>
                <div className={styles.successText}>ATA gerada com sucesso!</div>
                <p className={styles.successSub}>{materias.length} matéria{materias.length !== 1 ? 's' : ''} incluída{materias.length !== 1 ? 's' : ''}. Baixe o documento ou avance para os Pareceres.</p>
              </div>
            </div>
            <DocumentPreview content={ataResult} tipo="ata" onExportOdt={onExportOdt} onExportDocx={onExportDocx} />
            <button className={styles.btnPrimary} onClick={onAvancar} style={{ alignSelf: 'stretch', justifyContent: 'center' }}>
              Avançar para Pareceres <ArrowRight size={16} />
            </button>
          </>
        )}
        {!ataResult && !isGerando && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '48px 16px', textAlign: 'center', background: '#fafafa' }}>
            <FileText size={36} color="#d1d5db" />
            <p style={{ color: '#9ca3af', fontSize: '0.82rem', marginTop: 8 }}>Preencha os dados e clique em "Gerar ATA" para ver o preview aqui.</p>
          </div>
        )}
      </div>
    </div>
  );
}
