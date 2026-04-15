'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, Bell, User, HelpCircle, LogOut, Settings } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import UserSettingsModal from './ui/user-settings-modal';
import SystemHelpModal from './ui/system-help-modal';
import styles from './topbar.module.css';

interface TopbarProps {
  title: string;
  subtitle?: string;
}

export default function Topbar({ title, subtitle }: TopbarProps) {
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Fechar menus ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Pegar e-mail do usuário logado
  useEffect(() => {
    async function getUser() {
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) {
        setUserEmail(data.user.email);
      }
    }
    getUser();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.left}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>

        <div className={styles.right}>
          {/* Busca global removida — cada módulo tem busca interna própria (ex: Ctrl+F na transcrição) */}

          <div className={styles.relativeBox} ref={notifRef}>
            <button 
              className={styles.iconBtn} 
              title="Notificações"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
            >
              <Bell size={20} />
              <span className={styles.notifDot} />
            </button>
            {isNotifOpen && (
              <div className={styles.dropdownMenu}>
                <div className={styles.dropdownHeader}>Notificações</div>
                <div className={styles.dropdownBody}>
                  <div className={styles.notifItem}>
                    <strong>Atualização (v1.2)</strong>
                    <span>Nova interface centralizada</span>
                  </div>
                  <div className={styles.notifItem}>
                    <strong>ALIA IA</strong>
                    <span>Varredura de aniversariantes concluída.</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={styles.relativeBox} ref={userRef}>
            <div 
              className={styles.avatar} 
              title="Cynthia"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            >
              C
            </div>
            {isUserMenuOpen && (
              <div className={`${styles.dropdownMenu} ${styles.userMenu}`}>
                <div className={styles.userMenuHeader}>
                  <strong title={userEmail}>{userEmail || 'Usuário'}</strong>
                  <span>Gabinete Relator</span>
                </div>
                <button className={styles.menuItem} onClick={() => { setIsSettingsOpen(true); setIsUserMenuOpen(false); }}>
                  <User size={16} /> Meu Perfil
                </button>
                <button className={styles.menuItem} onClick={() => { setIsSettingsOpen(true); setIsUserMenuOpen(false); }}>
                  <Settings size={16} /> Configurações SaaS
                </button>
                <div className={styles.dropdownDivider} />
                <button className={styles.menuItem} onClick={() => { setIsHelpOpen(true); setIsUserMenuOpen(false); }}>
                  <HelpCircle size={16} /> Ajuda do Sistema
                </button>
                <div className={styles.dropdownDivider} />
                <button className={`${styles.menuItem} ${styles.danger}`} onClick={handleLogout}>
                  <LogOut size={16} /> Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <UserSettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        userEmail={userEmail}
      />
      
      <SystemHelpModal 
        isOpen={isHelpOpen} 
        onClose={() => setIsHelpOpen(false)} 
      />
    </>
  );
}
