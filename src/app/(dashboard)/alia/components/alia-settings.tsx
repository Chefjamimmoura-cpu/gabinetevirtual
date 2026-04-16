'use client';

import React, { useState, useEffect } from 'react';
import { Save, Loader2, Sparkles, BookOpen, Flag, Scale, UserCircle } from 'lucide-react';
import styles from '../alia-dashboard.module.css';

interface AliaConfig {
  political_alignment: string;
  philosophy: string;
  flags: string;
  relevant_projects: string;
  custom_instructions: string;
}

export default function AliaSettings() {
  const [config, setConfig] = useState<AliaConfig>({
    political_alignment: '',
    philosophy: '',
    flags: '',
    relevant_projects: '',
    custom_instructions: '',
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetch('/api/alia/config')
      .then(res => res.json())
      .then(data => {
        if (data && data.alia_config) {
          setConfig({
            political_alignment: data.alia_config.political_alignment || '',
            philosophy: data.alia_config.philosophy || '',
            flags: data.alia_config.flags || '',
            relevant_projects: data.alia_config.relevant_projects || '',
            custom_instructions: data.alia_config.custom_instructions || '',
          });
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/alia/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!res.ok) throw new Error('Falha ao salvar');

      setMessage({ text: 'Configurações de personalidade salvas com sucesso!', type: 'success' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error(err);
      setMessage({ text: 'Erro ao salvar. Tente novamente.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.loadingContainer} style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <Loader2 className={styles.spinner} style={{ animation: 'spin 1s linear infinite' }} size={24} />
      </div>
    );
  }

  return (
    <div className={styles.settingsPanel} style={{ 
      background: 'rgba(255, 255, 255, 0.7)', 
      backdropFilter: 'blur(10px)', 
      borderRadius: '12px', 
      padding: '24px',
      border: '1px solid rgba(255, 255, 255, 0.5)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.05)'
    }}>
      <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #e2e8f0' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b' }}>
          <Sparkles size={20} color="#488DC7" /> 
          Personalidade & Contexto da ALIA
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
          Configure o alinhamento político, estilo e diretrizes da vereadora para moldar o raciocínio da ALIA nos pareceres e atendimento.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Alinhamento Político */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '8px' }}>
            <Scale size={16} /> Alinhamento Político / Postura
          </label>
          <input
            type="text"
            value={config.political_alignment}
            onChange={(e) => setConfig({ ...config, political_alignment: e.target.value })}
            placeholder="Ex: Posição de centro-direita (situação), focada em responsabilidade fiscal..."
            style={{ 
              width: '100%', padding: '10px 12px', borderRadius: '8px', 
              border: '1px solid #cbd5e1', outline: 'none', background: 'white'
            }}
          />
        </div>

        {/* Filosofia / Estilo */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '8px' }}>
            <BookOpen size={16} /> Filosofia de Mandato
          </label>
          <textarea
            value={config.philosophy}
            onChange={(e) => setConfig({ ...config, philosophy: e.target.value })}
            placeholder="Ex: Mandato participativo, focado na zeladoria dos bairros e modernização digital da saúde municipal."
            rows={3}
            style={{ 
              width: '100%', padding: '10px 12px', borderRadius: '8px', 
              border: '1px solid #cbd5e1', outline: 'none', background: 'white', resize: 'vertical'
            }}
          />
        </div>

        {/* Bandeiras */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '8px' }}>
            <Flag size={16} /> Bandeiras de Ação
          </label>
          <textarea
            value={config.flags}
            onChange={(e) => setConfig({ ...config, flags: e.target.value })}
            placeholder="Ex: Causa Animal, Empreendedorismo Feminino, Infraestrutura Urbana..."
            rows={2}
            style={{ 
              width: '100%', padding: '10px 12px', borderRadius: '8px', 
              border: '1px solid #cbd5e1', outline: 'none', background: 'white', resize: 'vertical'
            }}
          />
        </div>

        {/* Projetos Relevantes */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '8px' }}>
            <UserCircle size={16} /> Projetos Relevantes (Histórico da Vereadora)
          </label>
          <textarea
            value={config.relevant_projects}
            onChange={(e) => setConfig({ ...config, relevant_projects: e.target.value })}
            placeholder="Ex: Autora da Lei das Câmeras em Creches, Co-autora do Marco Legal das Startups Municipais..."
            rows={3}
            style={{ 
              width: '100%', padding: '10px 12px', borderRadius: '8px', 
              border: '1px solid #cbd5e1', outline: 'none', background: 'white', resize: 'vertical'
            }}
          />
        </div>

        {/* Custom Instructions */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '8px' }}>
            <Sparkles size={16} /> Instruções Comportamentais Customizadas
          </label>
          <textarea
            value={config.custom_instructions}
            onChange={(e) => setConfig({ ...config, custom_instructions: e.target.value })}
            placeholder="Ex: Responder cidadãos sempre no tom amigável e usar emojis."
            rows={4}
            style={{ 
              width: '100%', padding: '10px 12px', borderRadius: '8px', 
              border: '1px solid #cbd5e1', outline: 'none', background: 'white', resize: 'vertical'
            }}
          />
        </div>

        {/* Ações */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
          <div>
            {message && (
              <span style={{ 
                fontSize: '0.875rem', 
                color: message.type === 'success' ? '#16a34a' : '#ef4444',
                background: message.type === 'success' ? '#dcfce7' : '#fee2e2',
                padding: '4px 8px',
                borderRadius: '4px'
              }}>
                {message.text}
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={styles.saveButton}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: '#488DC7', color: 'white', border: 'none',
              padding: '10px 20px', borderRadius: '8px', fontWeight: 500,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.7 : 1,
              transition: 'background 0.2s'
            }}
          >
            {isSaving ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={18} />}
            {isSaving ? 'Salvando...' : 'Salvar Personalidade'}
          </button>
        </div>
      </div>
    </div>
  );
}

