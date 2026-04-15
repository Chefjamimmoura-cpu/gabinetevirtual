'use client';

// ══════════════════════════════════════════════════════════
// SpeakerPicker — Popover ancorado para atribuir / editar locutores.
// Substitui o window.prompt() nativo.
//
// Duas ações distintas por linha:
//   • Clique na linha  → SELECIONA (merge): atribui o bloco atual a esse locutor.
//     Picker FECHA depois (ação terminal).
//   • Clique no ícone ✏ → EDITA o nome daquele locutor inline. Aplica a TODOS os
//     blocos com aquele speakerId. Picker PERMANECE ABERTO (edições em série).
// ══════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { X, Pencil, Check } from 'lucide-react';

export interface SpeakerOption {
  id: string;
  name: string;
  color: string;
  blockCount: number;
  isManualName: boolean;
}

interface SpeakerPickerProps {
  open: boolean;
  anchorRect: DOMRect | null;
  currentSpeakerId: string;
  speakers: SpeakerOption[];
  onSelect: (targetSpeakerId: string) => void;
  onRenameItem: (speakerId: string, newName: string) => void;
  onClose: () => void;
  /**
   * Quando true, abre já em modo edição do locutor atual (currentSpeakerId).
   * Usado pela canetinha ✏ ao lado do nome do bloco, onde a ação esperada é
   * renomear direto, sem precisar de um segundo clique.
   */
  autoEditCurrent?: boolean;
}

const POPOVER_WIDTH = 300;
const POPOVER_GAP = 6;

export function SpeakerPicker({
  open,
  anchorRect,
  currentSpeakerId,
  speakers,
  onSelect,
  onRenameItem,
  onClose,
  autoEditCurrent = false,
}: SpeakerPickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // Reset ao (re)abrir — e, se autoEditCurrent, entra já em edição do locutor atual
  useEffect(() => {
    if (open) {
      if (autoEditCurrent && currentSpeakerId) {
        const current = speakers.find(s => s.id === currentSpeakerId);
        setEditingId(currentSpeakerId);
        setEditDraft(current?.name || '');
      } else {
        setEditingId(null);
        setEditDraft('');
      }
    }
  }, [open, autoEditCurrent, currentSpeakerId, speakers]);

  // Foco no input ao entrar em modo edição
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Click fora fecha (se não estiver editando)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onClose]);

  // Esc: cancela edição em andamento; se não estiver editando, fecha o picker
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editingId) {
          setEditingId(null);
          setEditDraft('');
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, editingId, onClose]);

  if (!open || !anchorRect) return null;

  // Posicionamento
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 1080;
  let top = anchorRect.bottom + POPOVER_GAP;
  let left = anchorRect.left;
  if (left + POPOVER_WIDTH > viewportW - 12) left = viewportW - POPOVER_WIDTH - 12;
  if (left < 12) left = 12;
  const estimatedHeight = Math.min(60 + speakers.length * 40, 460);
  if (top + estimatedHeight > viewportH - 12) {
    const above = anchorRect.top - POPOVER_GAP - estimatedHeight;
    if (above >= 12) top = above;
  }

  const handleSelect = (targetId: string) => {
    if (targetId === currentSpeakerId) return;
    if (editingId) return; // durante edição, clique na linha não mescla
    onSelect(targetId);
  };

  const startEdit = (sp: SpeakerOption, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(sp.id);
    setEditDraft(sp.name);
  };

  const applyEdit = () => {
    if (!editingId) return;
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    onRenameItem(editingId, trimmed);
    setEditingId(null);
    setEditDraft('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Atribuir ou editar locutor"
      style={{
        position: 'fixed',
        top,
        left,
        width: POPOVER_WIDTH,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08)',
        zIndex: 10000,
        overflow: 'hidden',
        animation: 'speakerPickerIn 180ms cubic-bezier(.2,.8,.2,1)',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          background: '#f8fafc',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <span
          style={{
            fontSize: '0.66rem',
            fontWeight: 700,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Atribuir locutor
        </span>
        <button
          onClick={onClose}
          aria-label="Fechar"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#94a3b8',
            padding: 2,
            display: 'flex',
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Dica sutil */}
      <div style={{ padding: '7px 14px 3px', fontSize: '0.62rem', color: '#94a3b8' }}>
        Clique para atribuir · <Pencil size={9} style={{ display: 'inline', verticalAlign: -1 }} /> para renomear
      </div>

      {/* Lista de locutores */}
      <div style={{ maxHeight: 320, overflowY: 'auto', padding: '4px 0 8px' }}>
        {speakers.length === 0 ? (
          <div style={{ padding: '16px', fontSize: '0.78rem', color: '#9ca3af', textAlign: 'center' }}>
            Nenhum locutor disponível
          </div>
        ) : (
          speakers.map(sp => {
            const isCurrent = sp.id === currentSpeakerId;
            const isEditing = editingId === sp.id;

            return (
              <div
                key={sp.id}
                onClick={() => !isEditing && handleSelect(sp.id)}
                className="speaker-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 14px',
                  background: isEditing
                    ? '#fefce8'
                    : isCurrent
                    ? '#eff6ff'
                    : 'transparent',
                  color: isCurrent ? '#1c4076' : '#1f2937',
                  cursor: isEditing || isCurrent ? 'default' : 'pointer',
                  fontSize: '0.82rem',
                  transition: 'background 120ms ease',
                  minHeight: 38,
                }}
                onMouseEnter={e => {
                  if (!isCurrent && !isEditing) e.currentTarget.style.background = '#f3f4f6';
                }}
                onMouseLeave={e => {
                  if (!isCurrent && !isEditing) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: sp.color || '#cbd5e1',
                    flexShrink: 0,
                    boxShadow: '0 0 0 2px rgba(255,255,255,0.8)',
                  }}
                />

                {isEditing ? (
                  <>
                    <input
                      ref={inputRef}
                      value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyEdit();
                        }
                      }}
                      placeholder="Nome do locutor"
                      style={{
                        flex: 1,
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        padding: '5px 9px',
                        fontSize: '0.8rem',
                        outline: 'none',
                        color: '#1f2937',
                        minWidth: 0,
                      }}
                    />
                    <button
                      onClick={e => { e.stopPropagation(); applyEdit(); }}
                      disabled={!editDraft.trim()}
                      aria-label="Aplicar nome"
                      style={{
                        background: editDraft.trim() ? '#16a34a' : '#cbd5e1',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        padding: '5px 7px',
                        cursor: editDraft.trim() ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); cancelEdit(); }}
                      aria-label="Cancelar"
                      style={{
                        background: 'none',
                        border: '1px solid #cbd5e1',
                        color: '#64748b',
                        borderRadius: 6,
                        padding: '5px 7px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      style={{
                        flex: 1,
                        fontWeight: isCurrent ? 700 : 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      {sp.name}
                      {sp.isManualName && <Pencil size={9} style={{ opacity: 0.5, flexShrink: 0 }} />}
                      {isCurrent && (
                        <span style={{ fontSize: '0.66rem', fontWeight: 500, color: '#64748b', marginLeft: 4 }}>
                          (atual)
                        </span>
                      )}
                    </span>
                    <button
                      onClick={e => startEdit(sp, e)}
                      className="speaker-edit-btn"
                      aria-label={`Renomear ${sp.name}`}
                      title="Renomear (aplica a todos os blocos deste locutor)"
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 4,
                        borderRadius: 4,
                        cursor: 'pointer',
                        color: '#94a3b8',
                        display: 'flex',
                        alignItems: 'center',
                        opacity: 0,
                        transition: 'opacity 120ms ease, background 120ms ease, color 120ms ease',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = '#e0f2fe';
                        e.currentTarget.style.color = '#0369a1';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#94a3b8';
                      }}
                    >
                      <Pencil size={11} />
                    </button>
                    <span style={{ fontSize: '0.7rem', color: '#9ca3af', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {sp.blockCount} {sp.blockCount === 1 ? 'bloco' : 'blocos'}
                    </span>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <style>{`
        @keyframes speakerPickerIn {
          from { opacity: 0; transform: translateY(-4px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        /* ✏ aparece no hover da linha */
        .speaker-row:hover .speaker-edit-btn { opacity: 1; }
        /* Mantém visível quando editando */
        .speaker-row .speaker-edit-btn:focus-visible { opacity: 1; outline: 2px solid #0369a1; outline-offset: 1px; }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
