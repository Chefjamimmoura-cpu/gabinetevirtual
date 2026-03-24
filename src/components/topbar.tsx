'use client';

import { Search, Bell } from 'lucide-react';
import styles from './topbar.module.css';

interface TopbarProps {
  title: string;
  subtitle?: string;
}

export default function Topbar({ title, subtitle }: TopbarProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>

      <div className={styles.right}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Buscar..."
            className={styles.searchInput}
          />
        </div>

        <button className={styles.iconBtn} title="Notificações">
          <Bell size={20} />
          <span className={styles.notifDot} />
        </button>

        <div className={styles.avatar} title="Cynthia">
          C
        </div>
      </div>
    </header>
  );
}
