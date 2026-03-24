'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ShieldAlert, Zap, Users, Loader2, UserCheck, UserX, Eye, Shield } from 'lucide-react';
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
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  superadmin: '🔑 Super Admin',
  admin: '🛡 Admin',
  vereador: '⭐ Vereador(a)',
  assessor: '👤 Assessor',
  visitante: '👁 Visitante',
};

const ROLE_OPTIONS = ['superadmin', 'admin', 'vereador', 'assessor', 'visitante'];

export default function SuperAdminDashboard() {
  const [gabinetes, setGabinetes] = useState<Gabinete[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingGab, setLoadingGab] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadData() {
      // Gabinetes
      const { data: gabs } = await supabase
        .from('gabinetes')
        .select('*')
        .order('created_at', { ascending: false });
      setGabinetes(gabs || []);
      setLoadingGab(false);

      // Usuários
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, gabinete_id, created_at')
        .order('created_at', { ascending: false });
      setUsers(profs || []);
      setLoadingUsers(false);
    }
    loadData();
  }, [supabase]);

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
    if (!confirm(`Alterar role de ${user.full_name || user.email} para "${ROLE_LABELS[newRole]}"?`)) return;

    setUpdatingRole(userId);
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    if (!error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } else {
      alert('Erro ao atualizar role: ' + error.message);
    }
    setUpdatingRole(null);
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

  return (
    <div>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>
          <ShieldAlert color="#dc2626" /> Controle Mestre (Super ADMIN)
        </h1>
        <p className={styles.subtitle}>
          Gerencie gabinetes, usuários, roles e cotas de IA.
        </p>
      </div>

      {/* ── Seção: Usuários ── */}
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#1e293b', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Users size={20} /> Usuários do Sistema
        </h2>

        {loadingUsers ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: '#64748b' }}>
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Usuário</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role Atual</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Alterar Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, idx) => {
                  const badgeStyle = roleBadgeStyle(user.role);
                  return (
                    <tr key={user.id} style={{ borderBottom: idx < users.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                          {user.full_name || '—'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {new Date(user.created_at).toLocaleDateString('pt-BR')}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '0.875rem', color: '#475569' }}>
                        {user.email}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: badgeStyle.bg,
                          color: badgeStyle.color,
                        }}>
                          {ROLE_LABELS[user.role] || user.role}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {updatingRole === user.id ? (
                          <Loader2 size={16} className="animate-spin" style={{ color: '#64748b' }} />
                        ) : (
                          <select
                            value={user.role}
                            onChange={(e) => handleRoleChange(user.id, e.target.value)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: '6px',
                              border: '1px solid #e5e7eb',
                              fontSize: '0.8rem',
                              color: '#374151',
                              cursor: 'pointer',
                              background: 'white',
                            }}
                          >
                            {ROLE_OPTIONS.map(r => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {users.length === 0 && (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                Nenhum usuário encontrado.
              </div>
            )}
          </div>
        )}

        {/* Instruções visitante */}
        <div style={{ marginTop: '16px', padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '0.85rem', color: '#166534' }}>
          <strong>Para criar conta visitante:</strong> Peça ao investidor para criar conta no{' '}
          <a href="/login" style={{ color: '#15803d', fontWeight: 600 }}>/login</a> com o email dele,
          depois altere o role para <strong>👁 Visitante</strong> nesta tabela.
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
                    <button
                      className={styles.btnPrimary}
                      onClick={() => handleUpdateQuota(gab.id, config, 1000000)}
                    >
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
