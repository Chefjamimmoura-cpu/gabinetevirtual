'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Zap, BrainCircuit, Sparkles, CheckCircle2, ShoppingCart } from 'lucide-react';
import styles from './ia-plan-manager.module.css';

interface IaConfig {
  engine: 'gemini' | 'claude' | 'openai';
  monthly_quota: number;
  tokens_used: number;
}

export default function IAPlanManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [gabineteId, setGabineteId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState<string | null>(null);
  const [iaConfig, setIaConfig] = useState<IaConfig>({
    engine: 'gemini',
    monthly_quota: 1000000,
    tokens_used: 125430
  });

  const supabase = createClient();

  useEffect(() => {
    async function loadConfig() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('gabinete_id, role')
          .eq('id', user.id)
          .single();

        setIsAdmin(profile?.role === 'admin' || profile?.role === 'vereador');

        if (profile?.gabinete_id) {
          setGabineteId(profile.gabinete_id);
          const { data: gab } = await supabase
            .from('gabinetes')
            .select('config_json')
            .eq('id', profile.gabinete_id)
            .single();

          if (gab?.config_json && (gab.config_json as any).ia_config) {
            setIaConfig({ ...iaConfig, ...(gab.config_json as any).ia_config });
          }
        }
      } catch (err) {
        console.error('Erro ao carregar configurações de IA:', err);
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!isAdmin) {
      alert('Apenas administradores podem alterar as configurações de IA.');
      return;
    }

    setSaving(true);
    setMessage({ text: '', type: '' });

    try {
      // Primeiro pega o config atual para fazer merge
      const { data: gab } = await supabase
        .from('gabinetes')
        .select('config_json')
        .eq('id', gabineteId)
        .single();
      
      const currentConfig = gab?.config_json || {};
      const newConfig = { ...currentConfig, ia_config: iaConfig };

      const { error } = await supabase
        .from('gabinetes')
        .update({ config_json: newConfig })
        .eq('id', gabineteId);

      if (error) throw error;
      setMessage({ text: 'Configurações de IA salvas com sucesso!', type: 'success' });
    } catch (err: any) {
      console.error(err);
      setMessage({ text: `Erro ao salvar: ${err.message}`, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
    }
  };

  const handleCompra = async (packageId: string, tokens: number) => {
    if (!isAdmin) {
      alert('Apenas administradores podem adquirir créditos.');
      return;
    }

    setIsCheckoutLoading(packageId);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gabineteId, packageId, tokens })
      });
      
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // Redireciona pro Checkout (Stripe)
      } else {
        alert(data.error || 'Erro ao processar pagamento.');
      }
    } catch (err) {
      console.error(err);
      alert('Ocorreu um erro ao comunicar com a operadora de pagamentos.');
    } finally {
      setIsCheckoutLoading(null);
    }
  };

  if (loading) {
    return <div className={styles.container}><Loader2 className="animate-spin" size={24} /> Carregando infraestrutura...</div>;
  }

  const usagePercent = Math.min((iaConfig.tokens_used / iaConfig.monthly_quota) * 100, 100);
  const progressClass = usagePercent > 90 ? styles.danger : usagePercent > 75 ? styles.warning : '';

  return (
    <div className={styles.container}>
      <div className={styles.planCard}>
        <div className={styles.planHeader}>
          <div className={styles.planTitle}>
            <Sparkles size={24} /> Plano IA Gerenciado (SaaS)
          </div>
          <span className={styles.planBadge}>Ativo</span>
        </div>

        <p style={{fontSize: '0.875rem', color: 'var(--color-text-muted)'}}>
          O Gabinete Virtual utiliza infraestrutura de IA hospedada em nuvem. As chaves de API estão protegidas nos nossos servidores, garantindo privacidade e estabilidade contínua para suas análises e procuradorias automatizadas.
        </p>

        <div className={styles.usageSection}>
          <div className={styles.usageStats}>
            <span>Tokens Utilizados (Mês Atual)</span>
            <span>
              <strong>{iaConfig.tokens_used.toLocaleString('pt-BR')}</strong> / {iaConfig.monthly_quota.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className={styles.progressBar}>
            <div className={`${styles.progressFill} ${progressClass}`} style={{ width: `${usagePercent}%` }} />
          </div>
          {usagePercent > 90 && (
            <p style={{fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '0.25rem'}}>Atenção: Sua cota mensal está quase esgotada.</p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button 
            className={styles.upgradeBtn} 
            onClick={() => handleCompra('pkg_1m', 1000000)}
            disabled={isCheckoutLoading !== null}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#488DC7', color: 'white', padding: '12px', borderRadius: '8px', border: 'none', fontWeight: 600, cursor: 'pointer' }}
          >
            {isCheckoutLoading === 'pkg_1m' ? <Loader2 size={18} className="animate-spin" /> : <ShoppingCart size={18} />}
            Comprar +1M Tokens (R$ 89)
          </button>
          <button 
            className={styles.upgradeBtn} 
            onClick={() => handleCompra('pkg_5m', 5000000)}
            disabled={isCheckoutLoading !== null}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#1e293b', color: 'white', padding: '12px', borderRadius: '8px', border: 'none', fontWeight: 600, cursor: 'pointer' }}
          >
            {isCheckoutLoading === 'pkg_5m' ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            Comprar +5M Tokens (R$ 399)
          </button>
        </div>
      </div>

      <div className={styles.engineSection}>
        <h3 style={{fontSize: '1.125rem', fontWeight: 600}}>Motor de Geração Principal</h3>
        <p style={{fontSize: '0.875rem', color: 'var(--color-text-muted)'}}>Escolha o modelo de Inteligência Artificial que alimentará a análise de documentos, geração de pareceres e o agente do RAG. Alterações entrarão em vigor instantaneamente.</p>
        
        <div className={styles.engineGrid}>
          {/* Gemini Engine */}
          <div 
            className={`${styles.engineCard} ${iaConfig.engine === 'gemini' ? styles.active : ''}`}
            onClick={() => isAdmin && setIaConfig({ ...iaConfig, engine: 'gemini' })}
          >
            <div className={styles.engineName}>
              <span style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}><Zap size={18} fill="currentColor" color="#4285F4" /> Gemini 2.5 Flash</span>
              {iaConfig.engine === 'gemini' && <CheckCircle2 size={18} color="var(--color-primary)" />}
            </div>
            <div className={styles.engineDesc}>
              Modelo padrão do Google. Desempenho ultra-rápido, janela de contexto gigante (1M) e custo por ficha otimizado. Excelente para ler Súmulas extensas simultaneamente.
            </div>
          </div>

          {/* Claude Engine */}
          <div 
            className={`${styles.engineCard} ${iaConfig.engine === 'claude' ? styles.active : ''}`}
            onClick={() => isAdmin && setIaConfig({ ...iaConfig, engine: 'claude' })}
          >
            <div className={styles.engineName}>
              <span style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}><BrainCircuit size={18} color="#D97757" /> Claude 3.5 Sonnet</span>
              {iaConfig.engine === 'claude' && <CheckCircle2 size={18} color="var(--color-primary)" />}
            </div>
            <div className={styles.engineDesc}>
              A rede neural da Anthropic, excepcional em lógica, argumentação jurídica requintada e formatação rigorosa de textos densos. Maior consumo de créditos.
            </div>
          </div>
        </div>
      </div>

      <div className={styles.saveArea}>
        {message.text && (
          <span className={`${styles.message} ${styles[message.type]}`}>
            {message.text}
          </span>
        )}
        <button className={styles.saveBtn} onClick={handleSave} disabled={saving || !isAdmin}>
          {saving ? <Loader2 className="animate-spin" size={18} /> : null}
          Salvar Configurações da IA
        </button>
      </div>

    </div>
  );
}

