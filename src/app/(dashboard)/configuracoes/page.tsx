'use client';

import { useState } from 'react';
import { Building2, Users, Bot } from 'lucide-react';
import GabineteForm from '@/components/configuracoes/gabinete-form';
import EquipeManager from '@/components/configuracoes/equipe-manager';
import WhatsappManager from '@/components/configuracoes/whatsapp-manager';
import styles from './page.module.css';

type Tab = 'gabinete' | 'equipe' | 'ia';

export default function ConfiguracoesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('gabinete');

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Configurações Administrativas</h1>
        <p className={styles.subtitle}>
          Gerencie os dados do gabinete, permissões da equipe e as configurações da inteligência artificial ALIA.
        </p>
      </header>

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${activeTab === 'gabinete' ? styles.active : ''}`}
          onClick={() => setActiveTab('gabinete')}
        >
          <Building2 size={18} /> Gabinete
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'equipe' ? styles.active : ''}`}
          onClick={() => setActiveTab('equipe')}
        >
          <Users size={18} /> Equipe (RBAC)
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'ia' ? styles.active : ''}`}
          onClick={() => setActiveTab('ia')}
        >
          <Bot size={18} /> Inteligência Artificial
        </button>
      </div>

      <div className={styles.contentArea}>
        {activeTab === 'gabinete' && (
          <div>
            <h3 style={{fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text)'}}>Detalhes do Gabinete</h3>
            <p style={{fontSize: '0.875rem', color: 'var(--color-text-muted)'}}>Formulário de alteração de nome do parlamentar, cidade, logo e cores do tema.</p>
            <GabineteForm />
          </div>
        )}

        {activeTab === 'equipe' && (
          <div>
            <h3 style={{fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text)'}}>Gestão de Assessores</h3>
            <p style={{fontSize: '0.875rem', color: 'var(--color-text-muted)'}}>Adicione ou remova assessores. Defina papéis (Admin vs Assessor) para restringir o acesso a abas de configuração.</p>
            <EquipeManager />
          </div>
        )}

        {activeTab === 'ia' && (
          <div>
            <h3 style={{fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text)'}}>ALIA - Inteligência Artificial</h3>
            <p style={{fontSize: '0.875rem', color: 'var(--color-text-muted)'}}>Gerencie e escolha os provedores base de LLM para as operações de IA do gabinete.</p>
            <WhatsappManager />
          </div>
        )}
      </div>
    </div>
  );
}
