'use client';

import { useState, useEffect } from 'react';
import styles from './whatsapp-manager.module.css';

export default function WhatsappManager() {
  const [status, setStatus] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/whatsapp/status');
      if (!res.ok) throw new Error('Falha ao obter status');
      const data = await res.json();
      setStatus(data.state || data.instance?.state || 'unknown');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchQrCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/whatsapp/qrcode');
      if (!res.ok) throw new Error('Falha ao gerar QR Code');
      const data = await res.json();
      if (data.base64) {
        setQrCode(data.base64);
      } else {
        setError('Instância já conectada ou erro ao gerar QR');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>Conexão WhatsApp (Evolution API)</h2>
      <p className={styles.cardDesc}>
        Vincule o número do Gabinete escaneando o QR Code abaixo para a ALIA (Agente IA) poder interagir.
      </p>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.statusBox}>
        <strong>Status da Instância:</strong>{' '}
        {loading && !qrCode ? (
          <span className={styles.statusBadge}>Verificando...</span>
        ) : status === 'open' ? (
          <span className={`${styles.statusBadge} ${styles.connected}`}>Conectado</span>
        ) : (
          <span className={`${styles.statusBadge} ${styles.disconnected}`}>Desconectado</span>
        )}
      </div>

      <div className={styles.actions}>
        <button className={styles.btnSecondary} onClick={fetchStatus} disabled={loading}>
          Atualizar Status
        </button>

        {status !== 'open' && (
          <button className={styles.btnPrimary} onClick={fetchQrCode} disabled={loading}>
            Gerar QR Code
          </button>
        )}
      </div>

      {qrCode && status !== 'open' && (
        <div className={styles.qrContainer}>
          <p>⏳ Aguardando leitura do QR Code pelo WhatsApp do Gabinete...</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="WhatsApp QR Code" className={styles.qrImage} />
        </div>
      )}
      
      {status === 'open' && (
        <div className={styles.successBox}>
          ✅ Tudo certo! A ALIA está vinculada e pronta para receber mensagens.
        </div>
      )}
    </div>
  );
}
