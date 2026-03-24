'use client';
import React, { useState } from 'react';
import { X } from 'lucide-react';
import styles from './modal.module.css';

interface OrgModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  organization?: any; 
}

export default function OrgModal({ isOpen, onClose, onSave, organization }: OrgModalProps) {
  const [formData, setFormData] = useState({
    name: organization?.name || '',
    type: organization?.type || 'SECRETARIA_ESTADUAL',
    hierarchy_level: organization?.hierarchy_level || 1,
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
          <h2>{organization ? 'Editar Órgão' : 'Novo Órgão Institucional'}</h2>
          <button onClick={onClose} className={styles.closeBtn} type="button">
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className={styles.formBody}>
          <div className={styles.formGroup}>
            <label>Nome do Órgão / Instituição</label>
            <input 
              type="text" 
              className={styles.input}
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              required
              placeholder="Ex: Secretaria de Estado da Saúde - SESAU"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label>Tipo Institucional</label>
              <select 
                className={styles.input}
                value={formData.type}
                onChange={(e) => setFormData({...formData, type: e.target.value})}
              >
                <option value="SECRETARIA_ESTADUAL">Secretaria Estadual</option>
                <option value="SECRETARIA_MUNICIPAL">Secretaria Municipal</option>
                <option value="PODER_LEGISLATIVO">Poder Legislativo</option>
                <option value="PODER_JUDICIARIO">Poder Judiciário</option>
                <option value="AUTARQUIA">Autarquia / Fundação</option>
                <option value="OUTROS">Outros</option>
              </select>
            </div>
            
            <div className={styles.formGroup}>
              <label>Nível de Precedência (Hierarquia)</label>
              <input 
                type="number" 
                className={styles.input}
                value={formData.hierarchy_level}
                onChange={(e) => setFormData({...formData, hierarchy_level: Number(e.target.value)})}
                min="1"
                max="99"
              />
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" onClick={onClose} className={styles.btnGhost}>Cancelar</button>
            <button type="submit" className={styles.btnPrimary}>Salvar Órgão</button>
          </div>
        </form>
      </div>
    </div>
  );
}
