'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { PasswordInput } from '@/components/ui/password-input';
import styles from '../../login/login.module.css';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    // Supabase automaticamente troca o token do hash fragment por uma sessão
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });
  }, [supabase.auth]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  };

  return (
    <div className={styles.container}>
      <div className={styles.bgGlow} />

      <div className={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <div style={{
            width: '100%',
            height: '80px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            marginBottom: '1rem'
          }}>
            <div style={{ position: 'relative', width: '64px', height: '64px', flexShrink: 0 }}>
              <Image src="/nova-logo-icon.svg" alt="Ícone Gabinete Virtual" fill style={{ objectFit: 'contain' }} priority />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'var(--font-family)', color: 'var(--primary-800)', fontWeight: 800, fontSize: '1.4rem', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                Gabinete
              </span>
              <span style={{ fontFamily: 'var(--font-family)', color: 'var(--primary-800)', fontWeight: 800, fontSize: '1.75rem', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                Virtual
              </span>
            </div>
          </div>
        </div>
        <p className={styles.subtitle}>Redefinir Senha</p>

        {success ? (
          <div className={styles.pendingBox}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#22c55e', marginBottom: '8px' }}>
              Senha alterada com sucesso!
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--gray-400)', lineHeight: 1.5 }}>
              Redirecionando...
            </p>
          </div>
        ) : !sessionReady ? (
          <div className={styles.pendingBox}>
            <p style={{ fontSize: '0.875rem', color: 'var(--gray-400)', lineHeight: 1.5, marginBottom: '20px' }}>
              Verificando link de recuperação...
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', lineHeight: 1.5 }}>
              Se esta tela persistir, o link pode ter expirado.{' '}
              <a href="/login" style={{ color: 'var(--accent-500)', textDecoration: 'underline' }}>
                Solicite um novo link
              </a>.
            </p>
          </div>
        ) : (
          <form onSubmit={handleReset} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>Nova Senha</label>
              <PasswordInput
                id="password"
                className="input"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="confirmPassword" className={styles.label}>Confirmar Nova Senha</label>
              <PasswordInput
                id="confirmPassword"
                className="input"
                placeholder="Repita a senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className={styles.error}>{error}</div>
            )}

            <button
              type="submit"
              className={`btn btn-primary ${styles.submitBtn}`}
              disabled={loading}
              style={{ marginTop: '8px' }}
            >
              {loading ? 'Salvando...' : 'Redefinir Senha'}
            </button>
          </form>
        )}

        <p className={styles.footer}>
          Powered by <strong>Wone Technology</strong>
        </p>
      </div>
    </div>
  );
}
