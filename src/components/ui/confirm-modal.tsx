'use client';

import React from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

type ModalVariant = 'danger' | 'success' | 'info' | 'warning';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  variant?: ModalVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANTS: Record<ModalVariant, { icon: React.ReactNode; color: string; bg: string; btnBg: string }> = {
  danger: { icon: <AlertTriangle size={22} />, color: '#dc2626', bg: '#fef2f2', btnBg: '#dc2626' },
  success: { icon: <CheckCircle size={22} />, color: '#059669', bg: '#f0fdf4', btnBg: '#059669' },
  info: { icon: <Info size={22} />, color: '#2563eb', bg: '#eff6ff', btnBg: '#2563eb' },
  warning: { icon: <AlertTriangle size={22} />, color: '#d97706', bg: '#fffbeb', btnBg: '#d97706' },
};

export default function ConfirmModal({
  open, title, message, variant = 'info',
  confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  onConfirm, onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  const v = VARIANTS[variant];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
    }} onClick={onCancel}>
      <div style={{
        background: '#fff', borderRadius: '16px', padding: '0', width: '400px', maxWidth: '90vw',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden',
        animation: 'modalIn 0.2s ease-out',
      }} onClick={e => e.stopPropagation()}>

        {/* Header colorido */}
        <div style={{
          background: v.bg, padding: '20px 24px', display: 'flex', alignItems: 'flex-start', gap: '12px',
        }}>
          <div style={{ color: v.color, flexShrink: 0, marginTop: '2px' }}>{v.icon}</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1f2937' }}>{title}</h3>
            <p style={{ margin: '6px 0 0', fontSize: '0.88rem', color: '#4b5563', lineHeight: 1.5 }}>{message}</p>
          </div>
          <button onClick={onCancel} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px', flexShrink: 0,
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Footer com botoes */}
        <div style={{
          padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '8px',
          borderTop: '1px solid #f3f4f6',
        }}>
          <button onClick={onCancel} style={{
            padding: '8px 20px', borderRadius: '8px', border: '1px solid #d1d5db',
            background: '#fff', color: '#374151', fontWeight: 600, fontSize: '0.85rem',
            cursor: 'pointer',
          }}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm} style={{
            padding: '8px 20px', borderRadius: '8px', border: 'none',
            background: v.btnBg, color: '#fff', fontWeight: 600, fontSize: '0.85rem',
            cursor: 'pointer',
          }}>
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Toast de notificação (substitui alert) ──

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastProps {
  open: boolean;
  message: string;
  variant?: ModalVariant;
  onClose: () => void;
  action?: ToastAction;
  durationMs?: number;
}

export function Toast({ open, message, variant = 'info', onClose, action, durationMs }: ToastProps) {
  const v = VARIANTS[variant];
  const effectiveDuration = durationMs ?? (action ? 8000 : 4000);

  React.useEffect(() => {
    if (open) {
      const timer = setTimeout(onClose, effectiveDuration);
      return () => clearTimeout(timer);
    }
  }, [open, onClose, effectiveDuration]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
        background: '#fff', borderRadius: '12px', padding: '14px 18px',
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08)',
        borderLeft: `4px solid ${v.color}`,
        display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '440px',
        animation: 'toastIn 0.28s cubic-bezier(.2,.8,.2,1)',
      }}
    >
      <div style={{ color: v.color, flexShrink: 0, display: 'flex' }}>{v.icon}</div>
      <span style={{ fontSize: '0.86rem', color: '#1f2937', flex: 1, lineHeight: 1.4 }}>{message}</span>
      {action && (
        <button
          onClick={() => { action.onClick(); onClose(); }}
          style={{
            background: v.color, color: '#fff', border: 'none', borderRadius: '8px',
            padding: '6px 12px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
            flexShrink: 0, letterSpacing: '0.01em',
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          }}
        >
          {action.label}
        </button>
      )}
      <button
        onClick={onClose}
        aria-label="Fechar notificação"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px', flexShrink: 0 }}
      >
        <X size={14} />
      </button>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(60px) scale(0.96); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="status"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
