'use client';
import React, { useState } from 'react';
import { X } from 'lucide-react';
import styles from './modal.module.css';

interface AppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  personName: string; // Vem selecionado da tela anterior
}

export default function AppointmentModal({ isOpen, onClose, onSave, personName }: AppointmentModalProps) {
  const [formData, setFormData] = useState({
    org_id: '',
    position_name: '',
    start_date: new Date().toISOString().split('T')[0],
    is_active: true,
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
          <h2>Nova Nomeação / Vínculo</h2>
          <button onClick={onClose} className={styles.closeBtn} type="button">
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className={styles.formBody}>
          <div className={styles.formGroup}>
            <label>Autoridade</label>
            <input 
              type="text" 
              className={styles.input}
              value={personName}
              disabled
              style={{ opacity: 0.7, cursor: 'not-allowed' }}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Órgão / Instituição de Lotação</label>
            <select 
              className={styles.input}
              value={formData.org_id}
              onChange={(e) => setFormData({...formData, org_id: e.target.value})}
              required
            >
              <option value="" disabled>Selecione um Órgão Cadastrado...</option>
              {/* Em produção, isso virá de uma query no banco de dados */}
              <option value="1">Secretaria de Estado da Saúde - SESAU</option>
              <option value="2">Polícia Militar de Roraima - PMRR</option>
              <option value="3">Procuradoria Geral do Estado - PGE</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Cargo / Função</label>
            <input 
              type="text" 
              className={styles.input}
              value={formData.position_name}
              onChange={(e) => setFormData({...formData, position_name: e.target.value})}
              required
              placeholder="Ex: Secretário Titular, Diretor, Comandante"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label>Data de Início</label>
              <input 
                type="date" 
                className={styles.input}
                value={formData.start_date}
                onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                required
              />
            </div>
            
            <div className={styles.formGroup} style={{ flexDirection: 'row', alignItems: 'center', gap: '12px', marginTop: '30px' }}>
              <input 
                type="checkbox" 
                id="activeCheck"
                checked={formData.is_active}
                onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                style={{ width: '18px', height: '18px', accentColor: 'var(--accent-500)' }}
              />
              <label htmlFor="activeCheck" style={{ margin: 0, cursor: 'pointer', color: 'var(--gray-100)' }}>
                Vínculo Ativo (Atual)
              </label>
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" onClick={onClose} className={styles.btnGhost}>Cancelar</button>
            <button type="submit" className={styles.btnPrimary}>Salvar Nomeação</button>
          </div>
        </form>
      </div>
    </div>
  );
}
