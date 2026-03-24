'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Users,
  Calendar,
  ScrollText,
  MapPin,
  Mail,
  BookUser,
  ChevronLeft,
  LogOut,
  Settings,
  Zap,
  ShieldAlert
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import styles from './sidebar.module.css';

const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { id: 'pareceres', label: 'Pareceres', icon: FileText, href: '/pareceres' },
  { id: 'agenda', label: 'Agenda', icon: Calendar, href: '/agenda' },
  { id: 'pls', label: 'Projetos de Lei', icon: ScrollText, href: '/pls' },
  { id: 'indicacoes', label: 'Indicações', icon: MapPin, href: '/indicacoes' },
  { id: 'oficios', label: 'Ofícios', icon: Mail, href: '/oficios' },
  { id: 'cadin', label: 'CADIN', icon: BookUser, href: '/cadin' },
  { id: 'alia', label: 'Assistente ALIA', icon: Zap, href: '/laia' },
  { id: 'configuracoes', label: 'Configurações', icon: Settings, href: '/configuracoes' },
] as const;

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const pathname = usePathname();
  const supabase = createClient();

  // Acoplando estado de recolhimento à tag body para que o CSS do Layout principal posssa reagir
  useEffect(() => {
    if (collapsed) {
      document.body.classList.add('sidebar-collapsed');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
  }, [collapsed]);

  useEffect(() => {
    async function checkRole() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
        
      if (data && data.role === 'superadmin') {
        setIsSuperAdmin(true);
      }
    }
    checkRole();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {/* Logo Area */}
      <div className={styles.logoArea}>
        <Link href="/" className={styles.logoContent}>
          <div className={styles.logoImageWrapper}>
            <Image src="/nova-logo-icon.svg" alt="Ícone Gabinete Virtual" fill style={{ objectFit: 'contain' }} priority />
          </div>
          {!collapsed && (
            <div className={styles.logoTextWrapper}>
              <span className={styles.logoTextLine1}>Gabinete</span>
              <span className={styles.logoTextLine2}>Virtual</span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          const active = isActive(mod.href);
          return (
            <Link
              key={mod.id}
              href={mod.href}
              className={`${styles.navItem} ${active ? styles.active : ''}`}
              title={collapsed ? mod.label : undefined}
            >
              <Icon size={20} />
              {!collapsed && <span>{mod.label}</span>}
              {active && <div className={styles.activeIndicator} />}
            </Link>
          );
        })}
        
        {isSuperAdmin && (
          <Link
            href="/superadmin"
            className={`${styles.navItem} ${isActive('/superadmin') ? styles.active : ''}`}
            title={collapsed ? 'SuperAdmin' : undefined}
            style={{ marginTop: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}
          >
            <ShieldAlert size={20} color="#dc2626" />
            {!collapsed && <span style={{ color: '#dc2626', fontWeight: 600 }}>SuperAdmin</span>}
            {isActive('/superadmin') && <div className={styles.activeIndicator} />}
          </Link>
        )}
      </nav>

      {/* Footer */}
      <div className={styles.footer}>
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expandir' : 'Recolher'}
        >
          <ChevronLeft
            size={18}
            style={{
              transform: collapsed ? 'rotate(180deg)' : 'none',
              transition: 'transform var(--transition-normal)',
            }}
          />
        </button>
        <button
          className={styles.logoutBtn}
          onClick={handleLogout}
          title="Sair"
        >
          <LogOut size={18} />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
