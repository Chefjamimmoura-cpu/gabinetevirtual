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
  ShieldAlert,
  AudioLines
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { hasFullAccess, hasPermission, type Permissions } from '@/lib/permissions';
import styles from './sidebar.module.css';

const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { id: 'pareceres', label: 'Pareceres', icon: FileText, href: '/pareceres' },
  { id: 'agenda', label: 'Agenda', icon: Calendar, href: '/agenda' },
  { id: 'pls', label: 'Projetos de Lei', icon: ScrollText, href: '/pls' },
  { id: 'indicacoes', label: 'Indicações', icon: MapPin, href: '/indicacoes' },
  { id: 'oficios', label: 'Ofícios', icon: Mail, href: '/oficios' },
  { id: 'cadin', label: 'CADIN', icon: BookUser, href: '/cadin' },
  { id: 'sessoes', label: 'Transcrições', icon: AudioLines, href: '/sessoes' },
  { id: 'alia', label: 'Assistente ALIA', icon: Zap, href: '/alia' },
  { id: 'configuracoes', label: 'Configurações', icon: Settings, href: '/configuracoes' },
] as const;

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [userPermissions, setUserPermissions] = useState<Partial<Permissions> | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
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
        .select('role, permissions')
        .eq('id', user.id)
        .single();

      if (data) {
        setUserRole(data.role);
        setUserPermissions(data.permissions);
        if (data.role === 'superadmin') {
          setIsSuperAdmin(true);
          // Carrega contagem de pendentes
          const { count } = await supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('approved', false);
          setPendingCount(count || 0);
        }
      }
    }
    checkRole();
  }, [supabase]);

  // Realtime: atualiza badge de pendentes no sidebar
  useEffect(() => {
    if (!isSuperAdmin) return;

    const channel = supabase
      .channel('sidebar-pending-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        async () => {
          const { count } = await supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('approved', false);
          setPendingCount(count || 0);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSuperAdmin, supabase]);

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
        {MODULES.filter((mod) => {
          // Roles com acesso total veem tudo
          if (hasFullAccess(userRole)) return true;
          // Visitante e outros: verificar permissão do módulo
          return hasPermission(userPermissions, mod.id);
        }).map((mod) => {
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
            title={collapsed ? `SuperAdmin${pendingCount > 0 ? ` (${pendingCount} pendente${pendingCount > 1 ? 's' : ''})` : ''}` : undefined}
            style={{ marginTop: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '16px', position: 'relative' }}
          >
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <ShieldAlert size={20} color="#dc2626" />
              {pendingCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-8px',
                  background: '#f59e0b',
                  color: 'white',
                  fontSize: '0.6rem',
                  fontWeight: 800,
                  minWidth: '16px',
                  height: '16px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 3px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  animation: 'pulse 2s infinite',
                }}>
                  {pendingCount}
                </span>
              )}
            </div>
            {!collapsed && (
              <span style={{ color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                SuperAdmin
                {pendingCount > 0 && (
                  <span style={{
                    background: '#fef3c7',
                    color: '#b45309',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '1px 8px',
                    borderRadius: '10px',
                    border: '1px solid #fde68a',
                  }}>
                    {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
                  </span>
                )}
              </span>
            )}
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
