'use client';
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Maximize2, Minimize2, FileText, Download } from 'lucide-react';
import styles from './comissao-wizard.module.css';

interface DocumentPreviewProps {
  content: string;
  tipo: 'ata' | 'parecer';
  onExportOdt?: () => void;
  onExportDocx?: () => void;
}

export function DocumentPreview({ content, tipo, onExportOdt, onExportDocx }: DocumentPreviewProps) {
  const [expanded, setExpanded] = useState(false);

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
          {tipo === 'ata' ? (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, fontSize: '0.85rem', lineHeight: 1.7 }}>
              {content}
            </pre>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
