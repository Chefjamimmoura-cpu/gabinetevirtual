'use client';

import React, { useState } from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import styles from './a4-document-viewer.module.css';

interface A4DocumentViewerProps {
  children: React.ReactNode;
  showWatermark?: boolean;
}

export function A4DocumentViewer({ children, showWatermark = false }: A4DocumentViewerProps) {
  const [zoom, setZoom] = useState(0.85);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.1, 1.5));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.1, 0.4));
  const handleZoomReset = () => setZoom(0.85);

  return (
    <div className={styles.viewerContainer}>
      <div className={styles.toolbar}>
        <button onClick={handleZoomOut} title="Diminuir Zoom">
          <ZoomOut size={16} />
        </button>
        <span style={{ fontSize: '13px', fontWeight: 600, minWidth: '4ch', textAlign: 'center', color: '#334155' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={handleZoomIn} title="Aumentar Zoom">
          <ZoomIn size={16} />
        </button>
        <button onClick={handleZoomReset} title="Tamanho Padrão" style={{ marginLeft: '8px' }}>
          <Maximize size={16} />
        </button>
      </div>

      <div className={styles.paperWrapper} style={{ transform: `scale(${zoom})` }}>
        <div className={styles.a4Paper}>
          {showWatermark && (
            <img src="/marca_dagua_carol.jpeg" alt="Marca d'água" className={styles.watermark} />
          )}
          <div className={styles.header}>
            {/* O brasão importado está na pasta public/brasao.png */}
            {/* <img src="/brasao.png" alt="Brasão CMBV" /> */}
            <p style={{ margin: 0, fontSize: '10pt', color: '#6b7280', fontFamily: 'Times New Roman' }}>&quot;BRASIL: DO CABURAÍ AO CHUÍ&quot;</p>
            <p style={{ margin: '4px 0', fontSize: '12pt', fontWeight: 'bold', color: '#374151', fontFamily: 'Times New Roman' }}>CÂMARA MUNICIPAL DE BOA VISTA</p>
            <p style={{ margin: 0, fontSize: '11pt', color: '#6b7280', fontFamily: 'Times New Roman' }}>GABINETE PARLAMENTAR</p>
          </div>

          <div className={styles.contentBody}>
            {children}
          </div>

          <div className={styles.footer}>
            <p style={{ margin: '0 0 2px 0' }}><strong>Câmara Municipal de Boa Vista</strong></p>
            <p style={{ margin: '0 0 2px 0' }}>Palácio João Evangelista Pereira de Melo</p>
            <p style={{ margin: '0 0 2px 0' }}>Avenida Capitão Ene Garcês, 922, - São Francisco CEP 69.301-160 <a href="https://www.boavista.rr.leg.br" style={{ color: '#1c4076', textDecoration: 'none' }}>www.boavista.rr.leg.br</a> Boa Vista – RR</p>
            <p style={{ margin: 0 }}><a href="mailto:gabinete@camara.leg.br" style={{ color: '#1c4076', textDecoration: 'none' }}>gabinete@camara.leg.br</a></p>
          </div>
        </div>
      </div>
    </div>
  );
}

