'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Workflow, BookOpen, Settings } from 'lucide-react';
import styles from './alia-dashboard.module.css';

const SECOES = [
  { href: '/alia/atendimento',  label: 'Atendimento',  icon: Activity },
  { href: '/alia/orquestracao', label: 'Orquestração', icon: Workflow },
  { href: '/alia/conhecimento', label: 'Conhecimento', icon: BookOpen },
  { href: '/alia/ajustes',      label: 'Ajustes',      icon: Settings },
];

export default function AliaLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.dashboardContainer}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Centro de Comando IA (ALIA)</h1>
          <p className={styles.subtitle}>Supervisão e Interação com a Inteligência Artificial do Gabinete</p>
        </div>
      </header>

      <nav className={styles.tabs}>
        {SECOES.map(({ href, label, icon: Icon }) => {
          const ativa = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`${styles.tab} ${ativa ? styles.tabAtiva : ''}`}
            >
              <Icon size={18} /> {label}
            </Link>
          );
        })}
      </nav>

      <main className={styles.tabContent}>{children}</main>
    </div>
  );
}
