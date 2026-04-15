'use client';

import { useState } from 'react';
import { X, User, Shield, CreditCard, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import IAPlanManager from '@/components/configuracoes/ia-plan-manager';
import styles from './user-settings-modal.module.css';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

type Tab = 'perfil' | 'plano';

export default function UserSettingsModal({ isOpen, onClose, userEmail }: UserSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('perfil');
  const supabase = createClient();

  if (!isOpen) return null;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Minha Conta</h2>
            <p className={styles.subtitle}>{userEmail}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.sidebar}>
            <button 
              className={`${styles.tabBtn} ${activeTab === 'perfil' ? styles.active : ''}`}
              onClick={() => setActiveTab('perfil')}
            >
              <User size={18} /> Perfil e Segurança
            </button>
            <button 
              className={`${styles.tabBtn} ${activeTab === 'plano' ? styles.active : ''}`}
              onClick={() => setActiveTab('plano')}
            >
              <CreditCard size={18} /> Meu Plano (SaaS)
            </button>
            <div className={styles.divider} />
            <button 
              className={`${styles.tabBtn} ${styles.logoutBtn}`}
              onClick={handleLogout}
            >
              <LogOut size={18} /> Sair da Conta
            </button>
          </div>

          <div className={styles.content}>
            {activeTab === 'perfil' && (
              <div className={styles.perfilSection}>
                <h3 className={styles.sectionTitle}>Detalhes da Conta</h3>
                
                <div className={styles.field}>
                  <label>Email de Acesso</label>
                  <input type="text" value={userEmail} disabled className={styles.input} />
                  <span className={styles.hint}>O email usado para login não pode ser alterado por aqui.</span>
                </div>

                <div className={styles.field} style={{ marginTop: '1.5rem' }}>
                  <label>Segurança</label>
                  <button className={styles.actionBtn}>
                    <Shield size={16} /> Redefinir Senha
                  </button>
                  <span className={styles.hint}>Enviaremos um link de recuperação para o seu email.</span>
                </div>
              </div>
            )}

            {activeTab === 'plano' && (
              <div className={styles.planoSection}>
                <IAPlanManager />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
