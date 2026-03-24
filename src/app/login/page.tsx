'use client';

import { useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message === 'Invalid login credentials'
        ? 'Email ou senha incorretos'
        : authError.message
      );
      setLoading(false);
      return;
    }

    window.location.href = '/';
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    alert('Conta criada com sucesso! Você já pode entrar.');
    setLoading(false);
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
        <p className={styles.subtitle}>Carol Dantas — Vereadora de Boa Vista</p>

        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>Email</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>Senha</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className={styles.error}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <button
              type="submit"
              className={`btn btn-primary ${styles.submitBtn}`}
              disabled={loading}
              style={{ flex: 1 }}
            >
              {loading ? 'Aguarde...' : 'Entrar'}
            </button>
            
            <button
              type="button"
              onClick={handleSignUp}
              className={`btn btn-ghost`}
              disabled={loading}
              style={{ flex: 1, border: '1px solid var(--gray-700)' }}
            >
              Criar Conta
            </button>
          </div>
        </form>

        <p className={styles.footer}>
          Powered by <strong>Wone Technology</strong>
        </p>
      </div>
    </div>
  );
}
