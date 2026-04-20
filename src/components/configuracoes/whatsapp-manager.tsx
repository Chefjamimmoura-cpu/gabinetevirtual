'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './whatsapp-manager.module.css';

const POLL_INTERVAL_WAITING_MS = 3000;
const POLL_INTERVAL_CONNECTED_MS = 15000;
const QR_TIMEOUT_MS = 2 * 60 * 1000;

export default function WhatsappManager() {
  const [status, setStatus] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrStartedAtRef = useRef<number | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    if (!opts?.silent) setError(null);
    try {
      const res = await fetch('/api/admin/whatsapp/status');
      if (!res.ok) throw new Error('Falha ao obter status');
      const data = await res.json();
      const newStatus = data.state || data.instance?.state || 'unknown';
      setStatus(newStatus);
      if (newStatus === 'open' && qrCode) {
        setQrCode(null);
        qrStartedAtRef.current = null;
      }
      return newStatus;
    } catch (err) {
      if (!opts?.silent) setError(err instanceof Error ? err.message : 'Erro desconhecido');
      return null;
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [qrCode]);

  const fetchQrCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/whatsapp/qrcode');
      if (!res.ok) throw new Error('Falha ao gerar QR Code');
      const data = await res.json();
      if (data.base64) {
        setQrCode(data.base64);
        qrStartedAtRef.current = Date.now();
      } else {
        setError('Instância já conectada ou erro ao gerar QR');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Desconectar o WhatsApp deste gabinete? A ALIA deixará de receber e enviar mensagens até um novo pareamento.')) {
      return;
    }
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/whatsapp/logout', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Falha ao desconectar');
      }
      setStatus('close');
      setQrCode(null);
      qrStartedAtRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setDisconnecting(false);
    }
  };

  useEffect(() => {
    clearPoll();

    const scheduleNext = (delay: number) => {
      pollTimerRef.current = setTimeout(async () => {
        const next = await fetchStatus({ silent: true });

        if (qrCode && qrStartedAtRef.current && Date.now() - qrStartedAtRef.current > QR_TIMEOUT_MS && next !== 'open') {
          setQrCode(null);
          qrStartedAtRef.current = null;
          setError('QR Code expirou sem ser escaneado. Gere um novo para tentar de novo.');
          scheduleNext(POLL_INTERVAL_CONNECTED_MS);
          return;
        }

        if (next === 'open') {
          scheduleNext(POLL_INTERVAL_CONNECTED_MS);
        } else if (qrCode) {
          scheduleNext(POLL_INTERVAL_WAITING_MS);
        } else {
          scheduleNext(POLL_INTERVAL_CONNECTED_MS);
        }
      }, delay);
    };

    const initialDelay = qrCode ? POLL_INTERVAL_WAITING_MS : POLL_INTERVAL_CONNECTED_MS;
    scheduleNext(initialDelay);

    return clearPoll;
  }, [qrCode, fetchStatus, clearPoll]);

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = status === 'open';
  const showQrButton = !isConnected && !qrCode;

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
        ) : isConnected ? (
          <span className={`${styles.statusBadge} ${styles.connected}`}>Conectado</span>
        ) : (
          <span className={`${styles.statusBadge} ${styles.disconnected}`}>Desconectado</span>
        )}
      </div>

      <div className={styles.actions}>
        <button
          className={styles.btnSecondary}
          onClick={() => fetchStatus()}
          disabled={loading || disconnecting}
        >
          Atualizar Status
        </button>

        {showQrButton && (
          <button
            className={styles.btnPrimary}
            onClick={fetchQrCode}
            disabled={loading || disconnecting}
          >
            Gerar QR Code
          </button>
        )}

        {isConnected && (
          <button
            className={styles.btnDanger}
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Desconectando...' : 'Desconectar'}
          </button>
        )}
      </div>

      {qrCode && !isConnected && (
        <div className={styles.qrContainer}>
          <p>⏳ Aguardando leitura do QR Code pelo WhatsApp do Gabinete...</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="WhatsApp QR Code" className={styles.qrImage} />
          <p className={styles.qrHint}>O status atualiza sozinho a cada 3 segundos. Assim que o telefone parear, este QR some.</p>
        </div>
      )}

      {isConnected && (
        <div className={styles.successBox}>
          ✅ Tudo certo! A ALIA está vinculada e pronta para receber mensagens.
        </div>
      )}
    </div>
  );
}
