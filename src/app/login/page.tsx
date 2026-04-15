'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Clock, Mail, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PasswordInput } from '@/components/ui/password-input';
import styles from './login.module.css';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingApproval, setPendingApproval] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [isForgotMode, setIsForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('pending') === '1') {
      setPendingApproval(true);
    }
  }, [searchParams]);

  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setPendingApproval(false);

    const { data: signInData, error: authError } = await supabase.auth.signInWithPassword({
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

    // Verifica se a conta está aprovada
    if (signInData.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('approved')
        .eq('id', signInData.user.id)
        .single();

      if (profile?.approved === false) {
        setPendingApproval(true);
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }
    }

    window.location.href = '/';
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || email.split('@')[0] },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    setPendingApproval(true);
    setIsSignUpMode(false);
    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setResetSent(true);
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

        {pendingApproval ? (
          <div className={styles.pendingBox}>
            <Clock size={40} style={{ color: '#f59e0b', marginBottom: '12px' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--gray-100)', marginBottom: '8px' }}>
              Aguardando Aprovação
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--gray-400)', lineHeight: 1.5, marginBottom: '20px' }}>
              Sua conta foi criada com sucesso! Um administrador precisa aprovar seu acesso antes de você poder entrar.
            </p>
            <button
              className="btn btn-ghost"
              onClick={() => { setPendingApproval(false); setIsSignUpMode(false); }}
              style={{ border: '1px solid var(--gray-700)', fontSize: '0.85rem' }}
            >
              Voltar ao Login
            </button>
          </div>
        ) : isForgotMode ? (
          resetSent ? (
            <div className={styles.pendingBox}>
              <CheckCircle size={40} style={{ color: '#22c55e', marginBottom: '12px' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--gray-100)', marginBottom: '8px' }}>
                Email Enviado!
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--gray-400)', lineHeight: 1.5, marginBottom: '20px' }}>
                Enviamos um link de recuperação para <strong style={{ color: 'var(--gray-300)' }}>{email}</strong>. Verifique sua caixa de entrada e spam.
              </p>
              <button
                className="btn btn-ghost"
                onClick={() => { setIsForgotMode(false); setResetSent(false); setError(''); }}
                style={{ border: '1px solid var(--gray-700)', fontSize: '0.85rem' }}
              >
                Voltar ao Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className={styles.form}>
              <p style={{ fontSize: '0.875rem', color: 'var(--gray-400)', lineHeight: 1.5, textAlign: 'center', marginBottom: '4px' }}>
                Digite seu email para receber um link de recuperação de senha.
              </p>

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

              {error && (
                <div className={styles.error}>{error}</div>
              )}

              <button
                type="submit"
                className={`btn btn-primary ${styles.submitBtn}`}
                disabled={loading}
                style={{ marginTop: '8px' }}
              >
                {loading ? 'Enviando...' : 'Enviar Link de Recuperação'}
              </button>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setIsForgotMode(false); setError(''); }}
                style={{ border: '1px solid var(--gray-700)', fontSize: '0.85rem' }}
              >
                Voltar ao Login
              </button>
            </form>
          )
        ) : isSignUpMode ? (
          <form onSubmit={handleSignUp} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="fullName" className={styles.label}>Seu Nome</label>
              <input
                id="fullName"
                type="text"
                className="input"
                placeholder="Nome completo"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
              />
            </div>

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
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>Senha</label>
              <PasswordInput
                id="password"
                className="input"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? 'Criando conta...' : 'Solicitar Acesso'}
            </button>

            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { setIsSignUpMode(false); setError(''); }}
              style={{ border: '1px solid var(--gray-700)', fontSize: '0.85rem' }}
            >
              Já tenho conta → Entrar
            </button>
          </form>
        ) : (
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
              <PasswordInput
                id="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => { setIsForgotMode(true); setError(''); }}
                className={styles.forgotLink}
              >
                Esqueci minha senha
              </button>
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
              {loading ? 'Aguarde...' : 'Entrar'}
            </button>

            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { setIsSignUpMode(true); setError(''); }}
              style={{ border: '1px solid var(--gray-700)', fontSize: '0.85rem' }}
            >
              Não tenho conta → Criar Acesso
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
