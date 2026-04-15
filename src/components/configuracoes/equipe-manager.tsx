'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/lib/permissions';
import { Loader2, Trash2, ShieldAlert, KeyRound, UserPlus, X } from 'lucide-react';
import { PasswordInput } from '@/components/ui/password-input';
import styles from './equipe-manager.module.css';

interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'vereador' | 'assessor';
  gabinete_id: string | null;
}

export default function EquipeManager() {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [gabineteId, setGabineteId] = useState<string | null>(null);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [currentUserRole, setCurrentUserRole] = useState<string>('assessor');
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState<string | null>(null);
  
  // Forms state
  const [newUser, setNewUser] = useState({ full_name: '', email: '', password: '', role: 'assessor' });
  const [newPassword, setNewPassword] = useState('');

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, [supabase]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: currentUser } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (currentUser?.gabinete_id) {
        setGabineteId(currentUser.gabinete_id);
        setCurrentUserRole(currentUser.role);

        const { data: team } = await supabase
          .from('profiles')
          .select('*')
          .eq('gabinete_id', currentUser.gabinete_id)
          .order('created_at', { ascending: true });

        if (team) {
          setProfiles(team as Profile[]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('create');
    try {
      const res = await fetch('/api/admin/equipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar usuário');
      
      showMessage('Usuário criado com sucesso!', 'success');
      setShowAddModal(false);
      setNewUser({ full_name: '', email: '', password: '', role: 'assessor' });
      await loadData();
    } catch (err: any) {
      showMessage(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'vereador') return;
    setActionLoading(userId);
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
      if (error) throw error;
      setProfiles(prev => prev.map(p => p.id === userId ? { ...p, role: newRole as any } : p));
      showMessage('Papel atualizado com sucesso.', 'success');
    } catch (err: any) {
      showMessage(`Erro: ${err.message}`, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showPasswordModal) return;
    setActionLoading('password');
    try {
      const res = await fetch(`/api/admin/equipe/${showPasswordModal}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao resetar senha');
      
      showMessage('Senha atualizada com sucesso!', 'success');
      setShowPasswordModal(null);
      setNewPassword('');
    } catch (err: any) {
      showMessage(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveMember = async (userId: string, userName: string) => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'vereador') return;
    if (!confirm(`Tem certeza que deseja DELETAR a conta de ${userName} permanentemente?`)) return;

    setActionLoading(userId);
    try {
      const res = await fetch(`/api/admin/equipe/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao remover membro');
      
      setProfiles(prev => prev.filter(p => p.id !== userId));
      showMessage('Membro deletado permanentemente.', 'success');
    } catch (err: any) {
      showMessage(`Erro ao remover: ${err.message}`, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <div className={styles.container}><Loader2 className="animate-spin" size={24} /> Carregando equipe...</div>;
  }

  const isAdmin = currentUserRole === 'admin' || currentUserRole === 'vereador' || currentUserRole === 'superadmin';

  return (
    <div className={styles.container}>
      {!isAdmin && (
        <div style={{ padding: '1rem', background: '#fff3cd', color: '#856404', borderRadius: '4px', display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '1rem' }}>
          <ShieldAlert size={18} />
          Você é um(a) <b>{ROLE_LABELS[currentUserRole] || 'Assessor(a)'}</b>. Apenas o(a) Assessor(a) Administrativo pode modificar os acessos da equipe.
        </div>
      )}

      {message.text && (
        <div className={`${styles.message} ${styles[message.type]}`}>
          {message.text}
        </div>
      )}

      {isAdmin && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button 
            className={styles.btnAdd}
            onClick={() => setShowAddModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.5rem 1rem', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}
          >
            <UserPlus size={18} /> Adicionar Assessor
          </button>
        </div>
      )}

      <div className={styles.tableArea}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Membro</th>
              <th>Papel / Permissão</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 ? (
              <tr><td colSpan={3}>Nenhum membro encontrado.</td></tr>
            ) : (
              profiles.map(profile => (
                <tr key={profile.id}>
                  <td>
                    <div className={styles.userMeta}>
                      <div className={styles.avatar}>
                        {profile.full_name?.substring(0, 2).toUpperCase() || 'US'}
                      </div>
                      <div>
                        <div className={styles.userName}>{profile.full_name}</div>
                        <div className={styles.userEmail}>{profile.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <select
                      className={styles.roleSelect}
                      value={profile.role}
                      disabled={!isAdmin || actionLoading === profile.id}
                      onChange={(e) => handleRoleChange(profile.id, e.target.value)}
                    >
                      <option value="assessor">{ROLE_LABELS.assessor} — {ROLE_DESCRIPTIONS.assessor}</option>
                      <option value="admin">{ROLE_LABELS.admin} — {ROLE_DESCRIPTIONS.admin}</option>
                      <option value="vereador">{ROLE_LABELS.vereador} — {ROLE_DESCRIPTIONS.vereador}</option>
                    </select>
                  </td>
                  <td>
                    <div className={styles.actionsBox} style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className={styles.actionBtn}
                        style={{ background: '#f3f4f6', color: '#4b5563', padding: '6px', borderRadius: '4px', border: '1px solid #d1d5db', cursor: isAdmin ? 'pointer' : 'not-allowed' }}
                        title="Resetar Senha"
                        disabled={!isAdmin || actionLoading === profile.id}
                        onClick={() => setShowPasswordModal(profile.id)}
                      >
                        <KeyRound size={16} />
                      </button>
                      <button
                        className={styles.actionBtn}
                        style={{ background: '#fee2e2', color: '#b91c1c', padding: '6px', borderRadius: '4px', border: '1px solid #fecaca', cursor: isAdmin ? 'pointer' : 'not-allowed' }}
                        title="Remover Conta"
                        disabled={!isAdmin || actionLoading === profile.id}
                        onClick={() => handleRemoveMember(profile.id, profile.full_name)}
                      >
                        {actionLoading === profile.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL: Adicionar Usuário */}
      {showAddModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3 style={{ margin: 0 }}>Criar Nova Conta</h3>
              <button className={styles.closeBtn} onClick={() => setShowAddModal(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateUser} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label>Nome Completo</label>
                <input required type="text" value={newUser.full_name} onChange={e => setNewUser({...newUser, full_name: e.target.value})} placeholder="Ex: João Silva" />
              </div>
              <div className={styles.formGroup}>
                <label>E-mail</label>
                <input required type="email" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} placeholder="joao@gabinete.com" />
              </div>
              <div className={styles.formGroup}>
                <label>Senha Provisória</label>
                <PasswordInput required minLength={6} value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} placeholder="Mínimo 6 caracteres" />
              </div>
              <div className={styles.formGroup}>
                <label>Permissão</label>
                <select value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
                  <option value="assessor">{ROLE_LABELS.assessor}</option>
                  <option value="admin">{ROLE_LABELS.admin}</option>
                </select>
              </div>
              <button type="submit" className={styles.submitBtn} disabled={actionLoading === 'create'}>
                {actionLoading === 'create' ? 'Criando...' : 'Criar Conta e Liberar Acesso'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Resetar Senha */}
      {showPasswordModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3 style={{ margin: 0 }}>Redefinir Senha</h3>
              <button className={styles.closeBtn} onClick={() => setShowPasswordModal(null)}><X size={20} /></button>
            </div>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
              Defina uma nova senha para o usuário. Ele será desconectado e precisará usar esta nova senha para entrar.
            </p>
            <form onSubmit={handleResetPassword} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label>Nova Senha</label>
                <input required type="text" minLength={6} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Digite a nova senha..." />
              </div>
              <button type="submit" className={styles.submitBtn} disabled={actionLoading === 'password'}>
                {actionLoading === 'password' ? 'Salvando...' : 'Salvar Nova Senha'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
