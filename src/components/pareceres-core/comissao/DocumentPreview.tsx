'use client';
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Maximize2, Minimize2, FileText, Download } from 'lucide-react';
import styles from './comissao-wizard.module.css';
import { ComissaoMembro } from './types';

interface DocumentPreviewProps {
  content: string;
  tipo: 'ata' | 'parecer';
  onExportOdt?: () => void;
  onExportDocx?: () => void;
  commissionNome?: string;
  membros?: ComissaoMembro[];
}

export function DocumentPreview({ content, tipo, onExportOdt, onExportDocx, commissionNome, membros = [] }: DocumentPreviewProps) {
  const [expanded, setExpanded] = useState(false);

  const cargoLabel: Record<string, string> = {
    presidente: 'Presidente',
    'vice-presidente': 'Vice-Presidente',
    membro: 'Membro',
    suplente: 'Suplente',
  };
  // Ordem oficial CMBV: Presidente → Vice-presidente → Membros → Suplentes
  const cargoOrdem: Record<string, number> = { presidente: 0, 'vice-presidente': 1, membro: 2, suplente: 3 };
  const membrosOrdenados = [...membros].sort((a, b) => (cargoOrdem[a.cargo] ?? 9) - (cargoOrdem[b.cargo] ?? 9));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
      <div className={styles.downloadBar}>
        {onExportOdt && (
          <button onClick={onExportOdt} className={styles.btnDownloadSapl}>
            <FileText size={14} /> SAPL (.odt)
          </button>
        )}
        {onExportDocx && (
          <button onClick={onExportDocx} className={styles.btnDownloadDocx}>
            <Download size={14} /> DOCX
          </button>
        )}
      </div>

      <div style={{ position: 'relative', flex: 1 }}>
        <button
          onClick={() => setExpanded(e => !e)}
          className={styles.expandButton}
          title={expanded ? 'Minimizar' : 'Expandir preview'}
        >
          {expanded ? <><Minimize2 size={12} /> Minimizar</> : <><Maximize2 size={12} /> Expandir</>}
        </button>
        <div className={`${styles.documentPreview} ${expanded ? styles.documentPreviewExpanded : ''}`}>
          {expanded && (
            <button
              onClick={() => setExpanded(false)}
              className={styles.expandButton}
              style={{ position: 'fixed', top: 12, right: 12, zIndex: 1001 }}
            >
              <Minimize2 size={12} /> Fechar
            </button>
          )}

          {/* Cabeçalho institucional */}
          {commissionNome && (
            <div style={{ textAlign: 'center', marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid #d1d5db' }}>
              <div style={{ fontSize: '0.72rem', color: '#374151', letterSpacing: '0.03em' }}>ESTADO DE RORAIMA</div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#374151' }}>CÂMARA MUNICIPAL DE BOA VISTA</div>
              <div style={{ fontSize: '0.72rem', color: '#374151' }}>{commissionNome.toUpperCase()}</div>
            </div>
          )}

          {tipo === 'ata' ? (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, fontSize: '0.85rem', lineHeight: 1.7 }}>
              {content}
            </pre>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          )}

          {/* Assinaturas dos membros — empilhadas verticalmente (um embaixo do outro) */}
          {membrosOrdenados.length > 0 && (
            <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
                {membrosOrdenados.map((m, i) => (
                  <div key={i} style={{ textAlign: 'center', minWidth: 240 }}>
                    <div style={{ borderBottom: '1px solid #9ca3af', width: 240, margin: '0 auto 4px' }} />
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>
                      {m.cargo === 'presidente' ? 'Vereadora' : 'Vereador(a)'} {m.nome}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#6b7280', fontStyle: 'italic' }}>
                      {cargoLabel[m.cargo] ?? m.cargo} da {commissionNome}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
