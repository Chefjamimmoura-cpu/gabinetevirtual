'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ALL_MODULES, fullPermissions, emptyPermissions, hasFullAccess, ROLE_LABELS, ROLE_OPTIONS, type Permissions } from '@/lib/permissions';
import { ShieldAlert, Zap, Users, Loader2, UserCheck, UserX, Eye, Shield, CheckCircle2, XCircle, ChevronDown, ChevronUp, Bell, BellRing, Clock, CircleDot, RefreshCw, UserPlus, Ban, KeyRound, X } from 'lucide-react';
import styles from './page.module.css';

interface Gabinete {
  id: string;
  nome: string;
  config_json: Record<string, unknown>;
  created_at: string;
}

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  gabinete_id: string | null;
  approved: boolean;
  permissions: Partial<Permissions>;
  created_at: string;
  last_sign_in_at?: string | null;
}

const ROLE_ICONS: Record<string, string> = {
  superadmin: '🔑',
  admin: '🛡',
  vereador: '⭐',
  assessor: '👤',
  visitante: '👁',
};

/** Labels com ícone para exibição no superadmin */
const ROLE_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_LABELS).map(([k, v]) => [k, `${ROLE_ICONS[k] || ''} ${v}`])
);

/** Formata tempo relativo em português */
function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Nunca acessou';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Agora mesmo';
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d atrás`;
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

export default function SuperAdminDashboard() {
  const [gabinetes, setGabinetes] = useState<Gabinete[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingGab, setLoadingGab] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [savingPerms, setSavingPerms] = useState<string | null>(null);
  const [newVisitorEmail, setNewVisitorEmail] = useState('');
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorPassword, setNewVisitorPassword] = useState('');
  const [creatingVisitor, setCreatingVisitor] = useState(false);
  const [newPendingAlert, setNewPendingAlert] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [disablingUser, setDisablingUser] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const prevPendingCountRef = useRef(0);

  const supabase = createClient();

  const loadUsers = useCallback(async () => {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, gabinete_id, approved, permissions, created_at')
      .order('created_at', { ascending: false });

    // Busca last_sign_in_at via API admin
    let statusMap: Record<string, string | null> = {};
    try {
      const res = await fetch('/api/admin/users-status');
      if (res.ok) statusMap = await res.json();
    } catch {
      // Ignora erro — exibe sem last_sign_in
    }

    const enriched = (profs || []).map(p => ({
      ...p,
      last_sign_in_at: statusMap[p.id] || null,
    }));

    setUsers(enriched);
    setLoadingUsers(false);
  }, [supabase]);

  useEffect(() => {
    async function loadData() {
      // Identifica o superadmin logado
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);

      const { data: gabs } = await supabase
        .from('gabinetes')
        .select('*')
        .order('created_at', { ascending: false });
      setGabinetes(gabs || []);
      setLoadingGab(false);
      await loadUsers();
    }
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Realtime: escutar novos profiles (novos cadastros) ──
  useEffect(() => {
    const channel = supabase
      .channel('superadmin-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          // Recarrega a lista quando qualquer profile mudar
          loadUsers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, loadUsers]);

  // ── Alerta visual quando surgem novos pendentes ──
  useEffect(() => {
    const pendingCount = users.filter(u => u.approved === false).length;
    if (pendingCount > prevPendingCountRef.current && prevPendingCountRef.current >= 0) {
      setNewPendingAlert(true);
      // Tenta tocar um som de notificação
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH+Jj4+Mh4J8d3R0eH+EiYyNjIiDfXh0cnJ2fIKHi42NjIeDfXdzcXF1e4GGi42OjYqFf3p1cnBydnyBhoyOj46LhoF7dnJwcHR6gIWKjY+PjYmEfnl1cXBydnyBhouOj4+NiYR+eXRxcHJ2fIGGi46Pj42JhH55dXFwcnZ8gYaLjo+PjYmEfnl1cXBydnyBhouOj4+NiYR+eXVxcHJ2fIGGi46Pj42JhH55dXFwcnZ8');
        audio.volume = 0.3;
        audio.play().catch(() => {});
      } catch {
        // Ignora se não suportar audio
      }
      setTimeout(() => setNewPendingAlert(false), 5000);
    }
    prevPendingCountRef.current = pendingCount;
  }, [users]);

  const handleUpdateQuota = async (id: string, currentConfig: Record<string, unknown>, amount: number) => {
    if (!confirm(`Deseja adicionar ${amount.toLocaleString('pt-BR')} tokens a este gabinete cortesia?`)) return;
    const newConfig = { ...currentConfig } as Record<string, unknown>;
    const iaConfig = (newConfig.ia_config as Record<string, number>) || { engine: 'gemini', monthly_quota: 1000000, tokens_used: 0 };
    newConfig.ia_config = { ...iaConfig, monthly_quota: (iaConfig.monthly_quota || 1000000) + amount };
    const { error } = await supabase.from('gabinetes').update({ config_json: newConfig }).eq('id', id);
    if (!error) setGabinetes(prev => prev.map(g => g.id === id ? { ...g, config_json: newConfig } : g));
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    // Proteção: superadmin não pode rebaixar a si mesmo
    if (userId === currentUserId && newRole !== 'superadmin') {
      alert('Você não pode rebaixar seu próprio role de Super Administrador.');
      return;
    }

    if (!confirm(`Alterar role de ${user.full_name || user.email} para "${ROLE_DISPLAY[newRole]}"?`)) return;

    setUpdatingRole(userId);

    // Se mudou para visitante, zera permissões. Se saiu de visitante, dá acesso total.
    const newPermissions = newRole === 'visitante' ? emptyPermissions() : fullPermissions();

    const { error } = await supabase.from('profiles').update({
      role: newRole,
      permissions: newPermissions,
    }).eq('id', userId);

    if (!error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole, permissions: newPermissions } : u));
    } else {
      alert('Erro ao atualizar role: ' + error.message);
    }
    setUpdatingRole(null);
  };

  const handleDisableUser = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    if (userId === currentUserId) {
      alert('Você não pode desativar sua própria conta.');
      return;
    }
    if (!confirm(`Desativar o acesso de ${user.full_name || user.email}? O usuário não poderá mais fazer login.`)) return;

    setDisablingUser(userId);
    const { error } = await supabase.from('profiles').update({ approved: false }).eq('id', userId);
    if (!error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, approved: false } : u));
    } else {
      alert('Erro ao desativar: ' + error.message);
    }
    setDisablingUser(null);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showPasswordModal || !newPassword || newPassword.length < 6) return;
    setResettingPassword(true);
    try {
      const res = await fetch(`/api/admin/equipe/${showPasswordModal}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao resetar senha');
      const user = users.find(u => u.id === showPasswordModal);
      alert(`Senha de ${user?.full_name || user?.email} atualizada com sucesso!`);
      setShowPasswordModal(null);
      setNewPassword('');
    } catch (err: any) {
      alert('Erro: ' + err.message);
    }
    setResettingPassword(false);
  };

  const handleApprove = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    // Aprovar com role visitante e permissões vazias (admin marca depois)
    const perms = emptyPermissions();
    const { error } = await supabase.from('profiles').update({
      approved: true,
      role: 'visitante',
      permissions: perms,
    }).eq('id', userId);

    if (!error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, approved: true, role: 'visitante', permissions: perms } : u));
      setExpandedUser(userId); // Abre checkboxes para configurar
    } else {
      alert('Erro ao aprovar: ' + error.message);
    }
  };

  const handleReject = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    if (!confirm(`Rejeitar e remover a conta de ${user.full_name || user.email}?`)) return;

    // Remove o profile (o auth user fica, mas sem profile não entra)
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (!error) {
      setUsers(prev => prev.filter(u => u.id !== userId));
    } else {
      alert('Erro ao rejeitar: ' + error.message);
    }
  };

  const handleTogglePermission = async (userId: string, moduleId: string, currentValue: boolean) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const newPerms = { ...user.permissions, [moduleId]: !currentValue };

    setSavingPerms(userId);
    const { error } = await supabase.from('profiles').update({ permissions: newPerms }).eq('id', userId);

    if (!error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, permissions: newPerms } : u));
    } else {
      alert('Erro ao salvar permissão: ' + error.message);
    }
    setSavingPerms(null);
  };

  const handleToggleAll = async (userId: string, enable: boolean) => {
    const perms = enable ? fullPermissions() : emptyPermissions();
    setSavingPerms(userId);
    const { error } = await supabase.from('profiles').update({ permissions: perms }).eq('id', userId);
    if (!error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, permissions: perms } : u));
    }
    setSavingPerms(null);
  };

  const roleBadgeStyle = (role: string) => {
    const colors: Record<string, { bg: string; color: string }> = {
      superadmin: { bg: '#fef2f2', color: '#dc2626' },
      admin: { bg: '#eff6ff', color: '#1d4ed8' },
      vereador: { bg: '#fefce8', color: '#a16207' },
      assessor: { bg: '#f0fdf4', color: '#166534' },
      visitante: { bg: '#f8fafc', color: '#64748b' },
    };
    return colors[role] || colors.assessor;
  };

  // Separa pendentes dos aprovados
  const pendingUsers = users.filter(u => u.approved === false);
  const approvedUsers = users.filter(u => u.approved !== false);

  return (
    <div>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>
          <ShieldAlert color="#dc2626" /> Controle Mestre (Super ADMIN)
        </h1>
        <p className={styles.subtitle}>
          Gerencie gabinetes, usuários, roles, permissões e cotas de IA.
        </p>
      </div>

      {/* ── Seção: Contas Pendentes (sempre visível) ── */}
      <div style={{
        marginBottom: '32px',
        background: pendingUsers.length > 0 ? '#fffbeb' : '#f8fafc',
        border: `2px solid ${pendingUsers.length > 0 ? '#fbbf24' : '#e5e7eb'}`,
        borderRadius: '16px',
        padding: '20px 24px',
        transition: 'all 0.3s ease',
        animation: newPendingAlert ? 'pulse 0.5s ease-in-out 3' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: pendingUsers.length > 0 ? '16px' : '0' }}>
          <h2 style={{
            fontSize: '1.125rem',
            fontWeight: 700,
            color: pendingUsers.length > 0 ? '#b45309' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            margin: 0,
          }}>
            {pendingUsers.length > 0 ? (
              <>{newPendingAlert ? <BellRing size={20} className="animate-bounce" /> : <Bell size={20} />} Solicitações de Acesso ({pendingUsers.length})</>
            ) : (
              <><UserCheck size={20} /> Nenhuma solicitação pendente</>
            )}
          </h2>
          <button
            onClick={() => loadUsers()}
            title="Atualizar lista"
            style={{
              padding: '6px',
              background: 'transparent',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              color: '#64748b',
            }}
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {pendingUsers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pendingUsers.map((user) => (
              <div key={user.id} style={{
                background: 'white',
                border: '1px solid #fde68a',
                borderRadius: '12px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserPlus size={16} color="#b45309" />
                    {user.full_name || user.email.split('@')[0]}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                    {user.email} · Solicitou em {new Date(user.created_at).toLocaleDateString('pt-BR')} às {new Date(user.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleApprove(user.id)}
                    style={{
                      padding: '8px 20px',
                      background: '#166534',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <CheckCircle2 size={16} /> Aprovar
                  </button>
                  <button
                    onClick={() => handleReject(user.id)}
                    style={{
                      padding: '8px 20px',
                      background: '#fef2f2',
                      color: '#dc2626',
                      border: '1px solid #fecaca',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <XCircle size={16} /> Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {pendingUsers.length === 0 && (
          <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            Novas solicitações aparecerão aqui automaticamente em tempo real.
          </p>
        )}
      </div>

      {/* ── Seção: Usuários Aprovados ── */}
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#1e293b', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Users size={20} /> Usuários do Sistema ({approvedUsers.length})
        </h2>

        {loadingUsers ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: '#64748b' }}>
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {approvedUsers.map((user) => {
              const badgeStyle = roleBadgeStyle(user.role);
              const isExpanded = expandedUser === user.id;
              const isFullAccess = hasFullAccess(user.role);
              const perms = user.permissions || {};
              const isSelf = user.id === currentUserId;

              return (
                <div key={user.id} style={{
                  background: isSelf ? '#fefce8' : 'white',
                  border: `1px solid ${isSelf ? '#fde68a' : '#e5e7eb'}`,
                  borderRadius: '12px',
                  overflow: 'hidden',
                }}>
                  {/* Row principal */}
                  <div style={{
                    padding: '14px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    flexWrap: 'wrap',
                  }}>
                    {/* Nome + email + último acesso */}
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {user.full_name || '—'}
                        {isSelf && (
                          <span style={{ fontSize: '0.65rem', background: '#fbbf24', color: '#78350f', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>VOCÊ</span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.email}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <Clock size={11} />
                        Cadastro: {new Date(user.created_at).toLocaleDateString('pt-BR')}
                        {user.last_sign_in_at && (
                          <> · Último acesso: {timeAgo(user.last_sign_in_at)}</>
                        )}
                      </div>
                    </div>

                    {/* Badge role */}
                    <span style={{
                      display: 'inline-block',
                      padding: '3px 10px',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: badgeStyle.bg,
                      color: badgeStyle.color,
                      whiteSpace: 'nowrap',
                    }}>
                      {ROLE_DISPLAY[user.role] || user.role}
                    </span>

                    {/* Select role */}
                    {updatingRole === user.id ? (
                      <Loader2 size={16} className="animate-spin" style={{ color: '#64748b' }} />
                    ) : (
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        disabled={isSelf}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb',
                          fontSize: '0.8rem',
                          color: '#374151',
                          cursor: isSelf ? 'not-allowed' : 'pointer',
                          background: isSelf ? '#f1f5f9' : 'white',
                          opacity: isSelf ? 0.6 : 1,
                        }}
                      >
                        {ROLE_OPTIONS.map(r => (
                          <option key={r} value={r}>{ROLE_DISPLAY[r]}</option>
                        ))}
                      </select>
                    )}

                    {/* Botão expandir permissões */}
                    <button
                      onClick={() => setExpandedUser(isExpanded ? null : user.id)}
                      style={{
                        padding: '6px 12px',
                        background: isExpanded ? '#eff6ff' : '#f8fafc',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: isExpanded ? '#1d4ed8' : '#64748b',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      Permissões
                    </button>

                    {/* Botão resetar senha (não aparece para si mesmo) */}
                    {!isSelf && (
                      <button
                        onClick={() => setShowPasswordModal(user.id)}
                        title="Resetar senha deste usuário"
                        style={{
                          padding: '6px 10px',
                          background: '#f0f9ff',
                          border: '1px solid #bae6fd',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: '#0369a1',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <KeyRound size={14} />
                        Senha
                      </button>
                    )}

                    {/* Botão desativar (não aparece para si mesmo) */}
                    {!isSelf && (
                      <button
                        onClick={() => handleDisableUser(user.id)}
                        disabled={disablingUser === user.id}
                        title="Desativar acesso deste usuário"
                        style={{
                          padding: '6px 10px',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: '#dc2626',
                          cursor: disablingUser === user.id ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          whiteSpace: 'nowrap',
                          opacity: disablingUser === user.id ? 0.5 : 1,
                        }}
                      >
                        {disablingUser === user.id ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                        Desativar
                      </button>
                    )}
                  </div>

                  {/* Painel de permissões expandido */}
                  {isExpanded && (
                    <div style={{
                      padding: '16px 20px',
                      borderTop: '1px solid #e5e7eb',
                      background: '#f8fafc',
                    }}>
                      {isFullAccess ? (
                        <div style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 500 }}>
                          ✓ O role <strong>{ROLE_DISPLAY[user.role]}</strong> tem acesso total a todos os módulos automaticamente.
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151' }}>
                              Módulos liberados para este usuário:
                            </span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => handleToggleAll(user.id, true)}
                                disabled={savingPerms === user.id}
                                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #bbf7d0', background: '#f0fdf4', fontSize: '0.7rem', fontWeight: 600, color: '#166534', cursor: 'pointer' }}
                              >
                                Marcar Todos
                              </button>
                              <button
                                onClick={() => handleToggleAll(user.id, false)}
                                disabled={savingPerms === user.id}
                                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #fecaca', background: '#fef2f2', fontSize: '0.7rem', fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}
                              >
                                Desmarcar Todos
                              </button>
                            </div>
                          </div>

                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                            gap: '8px',
                          }}>
                            {ALL_MODULES.map((mod) => {
                              const enabled = perms[mod.id] === true;
                              return (
                                <label
                                  key={mod.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '10px 14px',
                                    background: enabled ? '#f0fdf4' : 'white',
                                    border: `1px solid ${enabled ? '#86efac' : '#e5e7eb'}`,
                                    borderRadius: '8px',
                                    cursor: savingPerms === user.id ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.15s',
                                    opacity: savingPerms === user.id ? 0.6 : 1,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={() => handleTogglePermission(user.id, mod.id, enabled)}
                                    disabled={savingPerms === user.id}
                                    style={{ width: '16px', height: '16px', accentColor: '#166534', cursor: 'pointer' }}
                                  />
                                  <div>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: enabled ? '#166534' : '#374151' }}>
                                      {mod.label}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                                      {mod.description}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Criar conta visitante */}
        <div style={{ marginTop: '20px', padding: '20px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#166534', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Eye size={18} /> Criar Conta Visitante (direto, sem aprovação)
          </h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nome</label>
              <input
                type="text"
                placeholder="Ex: Ismael TI"
                value={newVisitorName}
                onChange={(e) => setNewVisitorName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
              />
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Email</label>
              <input
                type="email"
                placeholder="email@exemplo.com"
                value={newVisitorEmail}
                onChange={(e) => setNewVisitorEmail(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
              />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Senha</label>
              <input
                type="text"
                placeholder="senha123"
                value={newVisitorPassword}
                onChange={(e) => setNewVisitorPassword(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
              />
            </div>
            <button
              onClick={async () => {
                if (!newVisitorEmail || !newVisitorPassword) {
                  alert('Preencha email e senha.');
                  return;
                }
                setCreatingVisitor(true);
                try {
                  const res = await fetch('/api/admin/equipe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      email: newVisitorEmail,
                      password: newVisitorPassword,
                      full_name: newVisitorName || newVisitorEmail.split('@')[0],
                      role: 'visitante',
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    alert('Erro: ' + (data.error || 'Falha ao criar'));
                  } else {
                    alert(`Conta visitante criada!\n\nEmail: ${newVisitorEmail}\nSenha: ${newVisitorPassword}\n\nJá pode fazer login. Configure as permissões abaixo.`);
                    setNewVisitorEmail('');
                    setNewVisitorName('');
                    setNewVisitorPassword('');
                    await loadUsers();
                  }
                } catch (err: any) {
                  alert('Erro: ' + err.message);
                }
                setCreatingVisitor(false);
              }}
              disabled={creatingVisitor}
              style={{
                padding: '8px 20px',
                background: creatingVisitor ? '#94a3b8' : '#166534',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: creatingVisitor ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {creatingVisitor ? 'Criando...' : 'Criar Visitante'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Seção: Gabinetes ── */}
      <div>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#1e293b', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={20} /> Gabinetes Instanciados
        </h2>

        {loadingGab ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: '#64748b' }}>
            <Loader2 className="animate-spin" size={32} />
          </div>
        ) : (
          <div className={styles.grid}>
            {gabinetes.map((gab) => {
              const config = (gab.config_json || {}) as Record<string, unknown>;
              const iaConfig = (config.ia_config as Record<string, number>) || { engine: 'gemini', monthly_quota: 1000000, tokens_used: 0 };
              const usagePercent = Math.min(((iaConfig.tokens_used || 0) / (iaConfig.monthly_quota || 1)) * 100, 100) || 0;
              const progressClass = usagePercent > 90 ? styles.danger : usagePercent > 75 ? styles.warning : '';

              return (
                <div key={gab.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div>
                      <h3 className={styles.gabineteName}>{(config.gabinete_nome as string) || 'Gabinete Piloto'}</h3>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>ID: {gab.id.split('-')[0]}...</div>
                    </div>
                    <span className={styles.badge}>{String(iaConfig.engine) === 'gemini' ? 'Gemini 2.5' : 'Claude 3.5'}</span>
                  </div>

                  <div className={styles.statGrid}>
                    <div className={styles.statsRow}>
                      <span className={styles.statsLabel}>IA Tokens (Mês)</span>
                      <span className={styles.statsValue}>
                        {(iaConfig.tokens_used || 0).toLocaleString('pt-BR')} / {(iaConfig.monthly_quota || 0).toLocaleString('pt-BR')}
                      </span>
                      <div className={styles.progressBar}>
                        <div className={`${styles.progressFill} ${progressClass}`} style={{ width: `${usagePercent}%` }}></div>
                      </div>
                    </div>
                    <div className={styles.statsRow}>
                      <span className={styles.statsLabel}>Personalidade</span>
                      <span className={styles.statsValue} style={{ fontSize: '0.75rem' }}>
                        {config.ia_system_prompt ? 'Customizada' : 'Padrão (Político Local)'}
                      </span>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <button className={styles.btnPrimary} onClick={() => handleUpdateQuota(gab.id, config, 1000000)}>
                      <Zap size={14} /> +1M Tokens (Free)
                    </button>
                    <button className={styles.btnPrimary} title="Configuração Avançada">
                      <Users size={14} /> Setup IA/Acessos
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal: Resetar Senha ── */}
      {showPasswordModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div style={{
            background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '420px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <KeyRound size={20} color="#0369a1" /> Redefinir Senha
              </h3>
              <button onClick={() => { setShowPasswordModal(null); setNewPassword(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
              Nova senha para <strong>{users.find(u => u.id === showPasswordModal)?.full_name || users.find(u => u.id === showPasswordModal)?.email}</strong>. O usuário será desconectado e precisará usar a nova senha.
            </p>
            <form onSubmit={handleResetPassword}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>Nova Senha</label>
                <input
                  required
                  type="text"
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
              </div>
              <button
                type="submit"
                disabled={resettingPassword || newPassword.length < 6}
                style={{
                  width: '100%', padding: '10px', background: resettingPassword ? '#94a3b8' : '#0369a1',
                  color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600,
                  cursor: resettingPassword ? 'not-allowed' : 'pointer',
                }}
              >
                {resettingPassword ? 'Salvando...' : 'Salvar Nova Senha'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Créditos ── */}
      <div style={{ marginTop: '48px', padding: '20px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
        <div style={{ fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
          Gabinete Virtual — Sistema de Gestão Parlamentar
        </div>
        <div>
          Desenvolvido por <strong style={{ color: '#1e293b' }}>Jamim Santos</strong> · Todos os direitos reservados © {new Date().getFullYear()}
        </div>
        <div style={{ marginTop: '4px', fontSize: '0.75rem' }}>
          Em parceria com <strong>WoneTechnology</strong> · Expansão e infraestrutura de TI
        </div>
        <div style={{ marginTop: '8px', fontSize: '0.7rem', color: '#94a3b8' }}>
          Powered by Gemini 2.5 · Supabase · Next.js · SAPL CMBV
        </div>
      </div>
    </div>
  );
}
