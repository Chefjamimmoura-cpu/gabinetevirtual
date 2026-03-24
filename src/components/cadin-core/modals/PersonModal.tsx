'use client';
import React, { useState } from 'react';
import { X } from 'lucide-react';
import styles from './modal.module.css';

interface PersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  person?: any; // null if creating new
}

export default function PersonModal({ isOpen, onClose, onSave, person }: PersonModalProps) {
  const [formData, setFormData] = useState({
    name: person?.name || '',
    phone: person?.phone || '',
    email: person?.email || '',
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modalContent}>
        <header className={styles.modalHeader}>
          <h2>{person ? 'Editar Pessoa' : 'Nova Pessoa'}</h2>
          <button onClick={onClose} className={styles.closeBtn} type="button">
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className={styles.formBody}>
          <div className={styles.formGroup}>
            <label>Nome Completo (Autoridade)</label>
            <input 
              type="text" 
              className={styles.input}
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              required
              placeholder="Ex: João da Silva"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label>Telefone / WhatsApp</label>
              <input 
                type="text" 
                className={styles.input}
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                placeholder="(95) 99999-9999"
              />
            </div>
            <div className={styles.formGroup}>
              <label>Email Institucional</label>
              <input 
                type="email" 
                className={styles.input}
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="autoridade@orgao.rr.gov.br"
              />
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" onClick={onClose} className={styles.btnGhost}>Cancelar</button>
            <button type="submit" className={styles.btnPrimary}>Salvar Registro</button>
          </div>
        </form>
      </div>
    </div>
  );
}
