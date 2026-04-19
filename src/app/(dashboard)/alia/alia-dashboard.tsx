'use client';

/**
 * @deprecated Substituído pelo shell layout em `/alia/layout.tsx` + sub-páginas
 * (atendimento, orquestracao, conhecimento, ajustes) na Fase 1a.
 *
 * Mantido por enquanto porque `src/app/(dashboard)/indicacoes/indicacoes-dashboard.tsx`
 * ainda renderiza <AliaDashboard /> embedado na aba ALIA. Migração desse caller
 * fica como follow-up (provavelmente substituir por <Link href="/alia">).
 */

import React, { useState } from 'react';
import { Zap, MessageSquare, Activity, BookUser, Settings } from 'lucide-react';
import styles from './alia-dashboard.module.css';
import AliaChat from './components/alia-chat';
import AliaMonitor from './components/alia-monitor';
import AliaSettings from './components/alia-settings';

type Aba = 'chat' | 'monitor' | 'cadin' | 'settings';

export default function AliaDashboard() {
  const [abaAtiva, setAbaAtiva] = useState<Aba>('monitor');

  return (
    <div className={styles.dashboardContainer}>
      <header className={styles.header}>
        <div className={styles.iconWrapper}>
          <Zap size={24} color="#488DC7" />
        </div>
        <div>
          <h1 className={styles.title}>Centro de Comando IA (ALIA)</h1>
          <p className={styles.subtitle}>Supervisão e Interação com a Inteligência Artificial do Gabinete</p>
        </div>
      </header>

      <div className={styles.tabsContainer}>
        <button
          className={`${styles.tabButton} ${abaAtiva === 'monitor' ? styles.tabButtonActive : ''}`}
          onClick={() => setAbaAtiva('monitor')}
        >
          <Activity size={18} /> Monitor
        </button>
        <button
          className={`${styles.tabButton} ${abaAtiva === 'chat' ? styles.tabButtonActive : ''}`}
          onClick={() => setAbaAtiva('chat')}
        >
          <MessageSquare size={18} /> Chat ALIA
        </button>
        <button
          className={`${styles.tabButton} ${abaAtiva === 'cadin' ? styles.tabButtonActive : ''}`}
          onClick={() => setAbaAtiva('cadin')}
        >
          <BookUser size={18} /> Agente CADIN
        </button>
        <button
          className={`${styles.tabButton} ${abaAtiva === 'settings' ? styles.tabButtonActive : ''}`}
          onClick={() => setAbaAtiva('settings')}
        >
          <Settings size={18} /> Personalidade & Ajustes
        </button>
      </div>

      <div className={styles.tabContent}>
        {abaAtiva === 'monitor' && <AliaMonitor />}
        {abaAtiva === 'chat' && <AliaChat agente="alia" />}
        {abaAtiva === 'cadin' && <AliaChat agente="cadin" />}
        {abaAtiva === 'settings' && <AliaSettings />}
      </div>
    </div>
  );
}

