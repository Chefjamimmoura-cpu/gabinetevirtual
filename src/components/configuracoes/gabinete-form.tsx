'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Save, Loader2 } from 'lucide-react';
import styles from './gabinete-form.module.css';

export default function GabineteForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const supabase = createClient();

  // Form State
  const [gabineteId, setGabineteId] = useState<string>('');
  const [name, setName] = useState('');
  const [vereadorName, setVereadorName] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [comissoes, setComissoes] = useState<string[]>([]);
  const [relatorNomePadrao, setRelatorNomePadrao] = useState('');

  // Comissões CMBV Hardcoded (as we need them here but they are also in prompts-relator.ts)
  const TODAS_COMISSOES = ['CLJRF', 'COF', 'COUTH', 'CECEJ', 'CSASM', 'CDCDHAISU', 'CEDP', 'CASP', 'CPMAIPD', 'CAG'];

  useEffect(() => {
    async function loadGabinete() {
      try {
        // Obter o Profile do usuário logado para saber seu gabinete_id
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('gabinete_id, role')
          .eq('id', user.id)
          .single();

        if (profile?.gabinete_id) {
          const { data: gab } = await supabase
            .from('gabinetes')
            .select('*')
            .eq('id', profile.gabinete_id)
            .single();

          if (gab) {
            setGabineteId(gab.id);
            setName(gab.name || '');
            setVereadorName(gab.vereador_name || '');
            setMunicipio(gab.municipio || '');
            setComissoes(gab.comissoes_relatoria || []);
            setRelatorNomePadrao(gab.relator_nome_padrao || gab.vereador_name || '');
          }
        }
      } catch (err) {
        console.error('Erro ao carregar gabinete:', err);
      } finally {
        setLoading(false);
      }
    }

    loadGabinete();
  }, [supabase]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ text: '', type: '' });

    try {
      if (!gabineteId) throw new Error('ID do Gabinete não encontrado');

      const { error } = await supabase
        .from('gabinetes')
        .update({
          name,
          vereador_name: vereadorName,
          municipio,
          comissoes_relatoria: comissoes,
          relator_nome_padrao: relatorNomePadrao.trim() || vereadorName,
        })
        .eq('id', gabineteId);

      if (error) throw error;
      setMessage({ text: 'Configurações salvas com sucesso!', type: 'success' });
    } catch (err: any) {
      console.error(err);
      setMessage({ text: `Erro ao salvar: ${err.message}`, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
    }
  };

  if (loading) {
    return <div className={styles.form}><Loader2 className="animate-spin" size={24} /> Carregando dados...</div>;
  }

  if (!gabineteId) {
    return (
      <div className={styles.form}>
        <p className={`${styles.message} ${styles.error}`}>
          Nenhum gabinete vinculado à sua conta. Contate o suporte.
        </p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSave}>
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="name">Nome do Projeto/Gabinete Virtual</label>
        <input
          id="name"
          type="text"
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Gabinete Virtual - Carol Dantas"
          required
        />
        <span className={styles.hint}>O nome principal usado pela plataforma GV.</span>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="vereadorName">Nome do(a) Parlamentar</label>
        <input
          id="vereadorName"
          type="text"
          className={styles.input}
          value={vereadorName}
          onChange={(e) => setVereadorName(e.target.value)}
          placeholder="Ex: Vereadora Carol Dantas"
          required
        />
        <span className={styles.hint}>Utilizado na geração oficial de Ofícios e Pareceres.</span>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="municipio">Município</label>
        <input
          id="municipio"
          type="text"
          className={styles.input}
          value={municipio}
          onChange={(e) => setMunicipio(e.target.value)}
          placeholder="Ex: Boa Vista"
          required
        />
        <span className={styles.hint}>Usado para buscar o prefixo do Regimento ou SAPL local.</span>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="relatorNomePadrao">Nome Padrão do Relator</label>
        <input
          id="relatorNomePadrao"
          type="text"
          className={styles.input}
          value={relatorNomePadrao}
          onChange={(e) => setRelatorNomePadrao(e.target.value)}
          placeholder="Ex: Vereadora Carol Dantas"
        />
        <span className={styles.hint}>Pré-popula o campo Relator na aba Relatoria de Pareceres. Deixe igual ao nome parlamentar se for o mesmo.</span>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.label}>Comissões de Relatoria</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
          {TODAS_COMISSOES.map((sigla) => (
            <label key={sigla} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#334155', background: '#f8fafc', padding: '6px 12px', borderRadius: '4px', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={comissoes.includes(sigla)}
                onChange={(e) => {
                  if (e.target.checked) setComissoes([...comissoes, sigla]);
                  else setComissoes(comissoes.filter(c => c !== sigla));
                }}
                style={{ accentColor: 'var(--primary-600)' }}
              />
              {sigla}
            </label>
          ))}
        </div>
        <span className={styles.hint}>Selecione as comissões nas quais o parlamentar é relator ou presidente. O nome e a comissão preencherão automaticamente a guia Relatoria em Pareceres.</span>
      </div>

      <div className={styles.footer}>
        {message.text && (
          <span className={`${styles.message} ${styles[message.type]}`}>
            {message.text}
          </span>
        )}
        <button type="submit" className={styles.submitBtn} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          Salvar Alterações
        </button>
      </div>
    </form>
  );
}
