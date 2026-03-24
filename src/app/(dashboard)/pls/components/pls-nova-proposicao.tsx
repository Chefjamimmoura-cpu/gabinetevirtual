'use client';

import React, { useState, useCallback } from 'react';
import {
  Bot, Search, Scale, Sparkles, FileText, CheckCircle,
  ChevronRight, ChevronLeft, Save, AlertTriangle, Loader2,
  Zap, BookOpen, Edit3, Shield, Download
} from 'lucide-react';
import styles from '../pls-dashboard.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

interface WizardState {
  // Etapa 0 — Entrada
  tema: string;
  descricao: string;
  contexto_politico: string;
  // Etapa 1 — Pesquisa
  pesquisa_similares: Record<string, unknown> | null;
  pesquisa_confirmada: boolean;
  // Etapa 2 — Jurídica
  parecer_juridico: Record<string, unknown> | null;
  juridica_confirmada: boolean;
  // Etapa 3 — Acessórios
  pls_acessorios: Record<string, unknown> | null;
  acessorios_confirmados: boolean;
  // Etapa 4 — Redação
  texto_gerado: Record<string, unknown> | null;
  texto_editado: string;
  redacao_confirmada: boolean;
  instrucoes_revisao: string;
}

const ETAPAS = [
  { id: 1, label: 'Pesquisa', icon: Search, desc: 'Similares e viabilidade' },
  { id: 2, label: 'Jurídica', icon: Scale, desc: 'Constitucionalidade' },
  { id: 3, label: 'Estratégia', icon: Zap, desc: 'PLs acessórios' },
  { id: 4, label: 'Redação', icon: FileText, desc: 'Texto LC 95/1998' },
  { id: 5, label: 'Revisão', icon: Edit3, desc: 'Aprovação humana' },
];

const ESTADO_INICIAL: WizardState = {
  tema: '', descricao: '', contexto_politico: '',
  pesquisa_similares: null, pesquisa_confirmada: false,
  parecer_juridico: null, juridica_confirmada: false,
  pls_acessorios: null, acessorios_confirmados: false,
  texto_gerado: null, texto_editado: '', redacao_confirmada: false,
  instrucoes_revisao: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export default function PlsNovaProposicao({ onBack }: { onBack: () => void }) {
  const [etapa, setEtapa] = useState(0); // 0 = entrada, 1-5 = wizard
  const [loading, setLoading] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>(ESTADO_INICIAL);

  // ── Download DOCX direto no browser ─────────────────────────────────────
  const downloadDocx = useCallback(async () => {
    if (!state.texto_editado) return;
    setDownloadingDocx(true);
    try {
      const res = await fetch('/api/pls/gerar-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pl_id: (state.texto_gerado as Record<string, unknown>)?._pl_id ?? `rascunho_${Date.now()}`,
          texto_aprovado: state.texto_editado,
          ementa: (state.texto_gerado as Record<string, unknown>)?.ementa ?? state.tema,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Falha ao gerar DOCX');

      // Se a API retornou URL pública, faz download via link
      if (json.url) {
        const a = document.createElement('a');
        a.href = json.url;
        a.download = `PL_${state.tema.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.docx`;
        a.click();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao baixar DOCX';
      setError(msg);
    } finally {
      setDownloadingDocx(false);
    }
  }, [state.texto_editado, state.texto_gerado, state.tema]);

  const updateState = useCallback((updates: Partial<WizardState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // ── Chamada genérica à API ────────────────────────────────────────────────
  const callAliaApi = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pls/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Erro ao consultar ALIA');
      }
      return json.data as Record<string, unknown>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Handlers de cada etapa ──────────────────────────────────────────────

  const iniciarWizard = () => {
    if (!state.tema.trim()) { setError('Descreva o tema do PL antes de continuar.'); return; }
    setError(null);
    setEtapa(1);
  };

  const consultarPesquisa = async () => {
    const data = await callAliaApi('pesquisar-similares', {
      tema: state.tema, descricao: state.descricao, contexto_politico: state.contexto_politico,
    });
    if (data) updateState({ pesquisa_similares: data, pesquisa_confirmada: false });
  };

  const consultarJuridica = async () => {
    const data = await callAliaApi('analise-juridica', {
      tema: state.tema,
      texto_preliminar: state.descricao,
      similares: (state.pesquisa_similares as Record<string, unknown>)?.similares_locais,
    });
    if (data) updateState({ parecer_juridico: data, juridica_confirmada: false });
  };

  const consultarAcessorios = async () => {
    const data = await callAliaApi('projetos-acessorios', {
      texto_do_pl_principal: state.texto_editado || state.descricao,
      tema: state.tema,
      parecer_juridico: state.parecer_juridico,
    });
    if (data) updateState({ pls_acessorios: data, acessorios_confirmados: false });
  };

  const gerarTexto = async (instrucoes?: string) => {
    const data = await callAliaApi('redigir', {
      tema: state.tema,
      descricao: state.descricao,
      contexto_politico: state.contexto_politico,
      parecer_juridico: state.parecer_juridico,
      similares: (state.pesquisa_similares as Record<string, unknown>)?.similares_locais,
      instrucoes_revisao: instrucoes || state.instrucoes_revisao || undefined,
    });
    if (data) {
      const textoFormatado = formatarPLTexto(data);
      updateState({ texto_gerado: data, texto_editado: textoFormatado, redacao_confirmada: false });
    }
  };

  const aprovarPL = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pls/aprovar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pl_id: (state.texto_gerado as Record<string, unknown>)?._pl_id ?? undefined,
          texto_aprovado: state.texto_editado,
          ementa: (state.texto_gerado as Record<string, unknown>)?.ementa,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao aprovar');
      setEtapa(6); // Concluído
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao aprovar PL');
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.novaContainer}>
      {/* Painel esquerdo: stepper */}
      <div className={styles.stepperPanel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', color: '#4f46e5', fontWeight: 700 }}>
          <Bot size={20} /> Workflow ALIA Legislativo
        </div>

        {ETAPAS.map((e) => {
          const Icon = e.icon;
          const isActive = etapa === e.id;
          const isDone = etapa > e.id;
          const isPending = etapa < e.id;
          return (
            <div key={e.id} className={`${styles.stepItem} ${isDone ? styles.stepDone : isActive ? styles.stepActive : styles.stepPending}`}>
              <div className={styles.stepIcon}>
                {isDone ? <CheckCircle size={16} /> : <Icon size={16} />}
              </div>
              {e.id < 5 && <div className={styles.stepLine} />}
              <div className={styles.stepContent}>
                <div className={styles.stepTitle}>{e.label}</div>
                <div className={styles.stepDesc}>{e.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Painel direito: conteúdo por etapa */}
      <div className={styles.actionPanel}>
        {/* ── Erro global ── */}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#b91c1c', fontSize: '14px' }}>
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {/* ════════════════════════════════════════════ ETAPA 0: Entrada */}
        {etapa === 0 && (
          <>
            <div className={styles.actionHeader}>
              <h2 style={{ color: '#4f46e5', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={20} /> Nova Proposição com ALIA
              </h2>
              <p>Descreva a ideia do Projeto de Lei. A ALIA conduzirá a pesquisa, análise jurídica e redação completa no padrão LC 95/1998.</p>
            </div>

            <div className={styles.inputGroup} style={{ marginBottom: '16px' }}>
              <label>Tema ou objeto do PL *</label>
              <textarea
                rows={3}
                value={state.tema}
                onChange={e => updateState({ tema: e.target.value })}
                placeholder="Ex: Criação de espaço para amamentação em estabelecimentos comerciais de Boa Vista"
              />
            </div>

            <div className={styles.inputGroup} style={{ marginBottom: '16px' }}>
              <label>Descrição detalhada (opcional)</label>
              <textarea
                rows={4}
                value={state.descricao}
                onChange={e => updateState({ descricao: e.target.value })}
                placeholder="Descreva o problema que o PL resolve, o público-alvo e o que a lei deverá estabelecer..."
              />
            </div>

            <div className={styles.inputGroup} style={{ marginBottom: '24px' }}>
              <label>Contexto político (opcional)</label>
              <textarea
                rows={2}
                value={state.contexto_politico}
                onChange={e => updateState({ contexto_politico: e.target.value })}
                placeholder="Ex: Demanda de associações de mulheres do Bairro Caranã, alinhada à agenda de direitos da mulher..."
              />
            </div>

            <button className={styles.runAliaButton} onClick={iniciarWizard} disabled={!state.tema.trim()}>
              <Bot size={18} /> Iniciar análise com ALIA
            </button>
          </>
        )}

        {/* ════════════════════════════════════════════ ETAPA 1: Pesquisa */}
        {etapa === 1 && (
          <EtapaContainer
            numero={1} titulo="Pesquisa de Similares" icone={<Search size={18} />}
            onConsultar={consultarPesquisa} loading={loading}
            consultado={!!state.pesquisa_similares}
            confirmado={state.pesquisa_confirmada}
            onConfirmar={() => updateState({ pesquisa_confirmada: true })}
            onAvancar={() => { setEtapa(2); setError(null); }}
            onVoltar={() => setEtapa(0)}
          >
            {state.pesquisa_similares && (
              <ResultadoPesquisa data={state.pesquisa_similares} />
            )}
          </EtapaContainer>
        )}

        {/* ════════════════════════════════════════════ ETAPA 2: Jurídica */}
        {etapa === 2 && (
          <EtapaContainer
            numero={2} titulo="Análise Jurídica" icone={<Scale size={18} />}
            onConsultar={consultarJuridica} loading={loading}
            consultado={!!state.parecer_juridico}
            confirmado={state.juridica_confirmada}
            onConfirmar={() => updateState({ juridica_confirmada: true })}
            onAvancar={() => { setEtapa(3); setError(null); }}
            onVoltar={() => setEtapa(1)}
          >
            {state.parecer_juridico && (
              <ResultadoJuridico data={state.parecer_juridico} />
            )}
          </EtapaContainer>
        )}

        {/* ════════════════════════════════════════════ ETAPA 3: Acessórios */}
        {etapa === 3 && (
          <EtapaContainer
            numero={3} titulo="Projetos Acessórios" icone={<Zap size={18} />}
            onConsultar={consultarAcessorios} loading={loading}
            consultado={!!state.pls_acessorios}
            confirmado={state.acessorios_confirmados}
            onConfirmar={() => updateState({ acessorios_confirmados: true })}
            onAvancar={() => { setEtapa(4); setError(null); }}
            onVoltar={() => setEtapa(2)}
          >
            {state.pls_acessorios && (
              <ResultadoAcessorios data={state.pls_acessorios} />
            )}
          </EtapaContainer>
        )}

        {/* ════════════════════════════════════════════ ETAPA 4: Redação */}
        {etapa === 4 && (
          <EtapaContainer
            numero={4} titulo="Redação do PL (LC 95/1998)" icone={<FileText size={18} />}
            onConsultar={() => gerarTexto()} loading={loading}
            consultado={!!state.texto_gerado}
            confirmado={state.redacao_confirmada}
            onConfirmar={() => updateState({ redacao_confirmada: true })}
            onAvancar={() => { setEtapa(5); setError(null); }}
            onVoltar={() => setEtapa(3)}
            labelConsultar={state.texto_gerado ? 'Regenerar com ALIA' : 'Gerar texto do PL'}
          >
            {state.texto_gerado && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {!!(state.texto_gerado as Record<string, unknown>)._aviso_rn03 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#92400e' }}>
                    ⚠️ {String((state.texto_gerado as Record<string, unknown>)._aviso_rn03)}
                  </div>
                )}
                <label style={{ fontWeight: 600, fontSize: '14px', color: '#374151' }}>
                  Editor — texto editável pela assessora:
                </label>
                <textarea
                  style={{ width: '100%', minHeight: '320px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6', padding: '16px', border: '1px solid #d1d5db', borderRadius: '8px', resize: 'vertical' }}
                  value={state.texto_editado}
                  onChange={e => updateState({ texto_editado: e.target.value })}
                />
                {/* Botão de download DOCX */}
                <button
                  onClick={downloadDocx}
                  disabled={downloadingDocx || !state.texto_editado}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#1d4ed8', color: 'white', padding: '10px 18px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', width: 'fit-content', opacity: downloadingDocx ? 0.7 : 1 }}
                >
                  {downloadingDocx ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {downloadingDocx ? 'Gerando DOCX...' : 'Baixar DOCX (rascunho)'}
                </button>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', color: '#6b7280' }}>Instruções de ajuste para a ALIA:</label>
                  <input
                    type="text"
                    style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
                    placeholder="Ex: Adicionar multa para descumprimento, simplificar artigo 3..."
                    value={state.instrucoes_revisao}
                    onChange={e => updateState({ instrucoes_revisao: e.target.value })}
                  />
                  <button
                    onClick={() => gerarTexto(state.instrucoes_revisao)}
                    disabled={loading}
                    style={{ padding: '8px 14px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
                    Ajustar
                  </button>
                </div>
              </div>
            )}
          </EtapaContainer>
        )}

        {/* ════════════════════════════════════════════ ETAPA 5: Revisão/Aprovação */}
        {etapa === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className={styles.actionHeader}>
              <h2 style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={20} /> Revisão Final e Aprovação
              </h2>
              <p style={{ color: '#374151' }}>
                Revise o texto abaixo. Ao aprovar, o PL será registrado no Gabinete Virtual e estará pronto para protocolamento no SAPL. <strong>Esta ação exige sua confirmação explícita.</strong>
              </p>
            </div>

            {/* Parecer resumido */}
            {state.parecer_juridico && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '14px 16px', fontSize: '13px' }}>
                <strong style={{ color: '#15803d' }}>Parecer Jurídico:</strong>{' '}
                {String((state.parecer_juridico as Record<string, unknown>).parecer_resumido || 'Análise concluída.')}
                <span style={{ marginLeft: '8px', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '999px', fontSize: '12px', fontWeight: 600 }}>
                  {String((state.parecer_juridico as Record<string, unknown>).risco_nivel || '').toUpperCase()}
                </span>
              </div>
            )}

            {/* Texto para aprovação */}
            <div>
              <label style={{ fontWeight: 600, fontSize: '14px', color: '#374151', display: 'block', marginBottom: '8px' }}>
                Texto final (ainda editável):
              </label>
              <textarea
                style={{ width: '100%', minHeight: '300px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6', padding: '16px', border: '2px solid #d1d5db', borderRadius: '8px', resize: 'vertical' }}
                value={state.texto_editado}
                onChange={e => updateState({ texto_editado: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => setEtapa(4)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontWeight: 500 }}>
                <ChevronLeft size={16} /> Voltar à Redação
              </button>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {/* Download DOCX na etapa de aprovação */}
                <button
                  onClick={downloadDocx}
                  disabled={downloadingDocx || !state.texto_editado}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', color: '#1d4ed8', padding: '10px 16px', border: '1px solid #1d4ed8', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', opacity: downloadingDocx ? 0.7 : 1 }}
                >
                  {downloadingDocx ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Baixar DOCX
                </button>

                <button
                  onClick={aprovarPL}
                  disabled={loading || !state.texto_editado.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#059669', color: 'white', padding: '12px 24px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '15px', opacity: loading ? 0.7 : 1 }}
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                  Aprovar e Registrar PL
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════ ETAPA 6: Concluído */}
        {etapa === 6 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '20px', padding: '48px 24px' }}>
            <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: '#ecfdf5', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle size={36} color="#10b981" />
            </div>
            <h2 style={{ color: '#059669', margin: 0 }}>PL Aprovado com Sucesso!</h2>
            <p style={{ color: '#4b5563', maxWidth: '400px' }}>
              O Projeto de Lei foi registrado no Gabinete Virtual e está pronto para ser protocolado manualmente no SAPL.
            </p>
            <button onClick={onBack} style={{ background: '#4f46e5', color: 'white', padding: '10px 24px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BookOpen size={16} /> Voltar ao Painel de PLs
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTES AUXILIARES
// ─────────────────────────────────────────────────────────────────────────────

function EtapaContainer({
  numero, titulo, icone, loading, consultado, confirmado,
  onConsultar, onConfirmar, onAvancar, onVoltar,
  labelConsultar = 'Consultar ALIA', children
}: {
  numero: number; titulo: string; icone: React.ReactNode;
  loading: boolean; consultado: boolean; confirmado: boolean;
  onConsultar: () => void; onConfirmar: () => void;
  onAvancar: () => void; onVoltar: () => void;
  labelConsultar?: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '14px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4f46e5' }}>
          {icone}
        </div>
        <div>
          <div style={{ fontWeight: 700, color: '#1f2937' }}>Etapa {numero} — {titulo}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Consulte a ALIA e confirme antes de avançar</div>
        </div>
        {consultado && !confirmado && (
          <span style={{ marginLeft: 'auto', background: '#fef3c7', color: '#92400e', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600 }}>
            Aguardando confirmação
          </span>
        )}
      </div>

      {/* Botão consultar */}
      <button
        onClick={onConsultar}
        disabled={loading}
        className={styles.runAliaButton}
        style={{ width: 'fit-content', padding: '10px 20px' }}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
        {loading ? 'ALIA processando...' : labelConsultar}
      </button>

      {/* Resultado */}
      {children}

      {/* Confirmação e navegação */}
      {consultado && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderTop: '1px solid #e5e7eb', paddingTop: '16px', marginTop: '8px' }}>
          <button onClick={onVoltar} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: '1px solid #d1d5db', color: '#6b7280', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 500, fontSize: '14px' }}>
            <ChevronLeft size={14} /> Voltar
          </button>

          {!confirmado ? (
            <button onClick={onConfirmar} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f5f3ff', border: '1px solid #c4b5fd', color: '#4f46e5', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>
              <CheckCircle size={14} /> Confirmar e avançar
            </button>
          ) : (
            <button onClick={onAvancar} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#4f46e5', color: 'white', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>
              Próxima etapa <ChevronRight size={14} />
            </button>
          )}

          <button title="Salvar rascunho" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
            <Save size={14} /> Salvar rascunho
          </button>
        </div>
      )}
    </div>
  );
}

function ResultadoPesquisa({ data }: { data: Record<string, unknown> }) {
  const {
    similares_locais,
    referencias_nacionais,
    referencias_internacionais,
    ideias_aproveitadas,
    recomendacao,
    justificativa,
    parecer_viabilidade,
    pontos_diferenciadores,
  } = data as {
    similares_locais?: Array<{ numero: string; ementa: string; grau_similaridade: string; diferencial?: string; url?: string }>;
    referencias_nacionais?: Array<{ origem: string; titulo: string; numero?: string; url?: string; nucleo?: string; melhores_ideias?: string[] }>;
    referencias_internacionais?: Array<{ pais: string; instituicao: string; descricao: string; url?: string; melhores_ideias?: string[] }>;
    ideias_aproveitadas?: { resumo?: string; sugestoes_para_incorporar?: string[] };
    recomendacao?: string;
    justificativa?: string;
    parecer_viabilidade?: string;
    pontos_diferenciadores?: string[];
  };

  const corParecer = parecer_viabilidade === 'VERDE' ? '#10b981' : parecer_viabilidade === 'AMARELO' ? '#f59e0b' : '#ef4444';
  const bgParecer = parecer_viabilidade === 'VERDE' ? '#f0fdf4' : parecer_viabilidade === 'AMARELO' ? '#fffbeb' : '#fef2f2';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '14px' }}>

      {/* Parecer de viabilidade */}
      <div style={{ background: bgParecer, border: `1px solid ${corParecer}40`, borderRadius: '10px', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ background: corParecer, color: 'white', padding: '4px 12px', borderRadius: '999px', fontWeight: 700, fontSize: '13px' }}>
            {parecer_viabilidade || 'N/A'}
          </span>
          <span style={{ fontWeight: 700, color: '#1f2937' }}>Parecer de Viabilidade</span>
          {recomendacao && (
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: '6px', fontWeight: 600, textTransform: 'uppercase' }}>
              {recomendacao}
            </span>
          )}
        </div>
        <p style={{ margin: 0, color: '#374151', lineHeight: '1.6' }}>{justificativa}</p>
        {pontos_diferenciadores && pontos_diferenciadores.length > 0 && (
          <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {pontos_diferenciadores.map((p, i) => (
              <span key={i} style={{ background: 'white', border: `1px solid ${corParecer}60`, color: '#374151', padding: '3px 10px', borderRadius: '6px', fontSize: '12px' }}>✦ {p}</span>
            ))}
          </div>
        )}
      </div>

      {/* Similares Locais (SAPL Boa Vista) */}
      <div>
        <div style={{ fontWeight: 700, color: '#1f2937', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🏛️ SAPL — Câmara Municipal de Boa Vista
        </div>
        {similares_locais && similares_locais.length > 0 ? (
          similares_locais.map((s, i) => (
            <div key={i} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#4f46e5' }}>
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: '#4f46e5', textDecoration: 'none' }}>{s.numero} ↗</a> : s.numero}
                </span>
                <span style={{ background: s.grau_similaridade === 'IDÊNTICO' ? '#fee2e2' : s.grau_similaridade === 'SIMILAR' ? '#fef3c7' : '#ede9fe', color: s.grau_similaridade === 'IDÊNTICO' ? '#b91c1c' : s.grau_similaridade === 'SIMILAR' ? '#92400e' : '#4f46e5', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                  {s.grau_similaridade}
                </span>
              </div>
              <div style={{ color: '#374151', fontSize: '13px', lineHeight: '1.4' }}>{s.ementa}</div>
              {s.diferencial && <div style={{ color: '#059669', fontSize: '12px', marginTop: '4px' }}>↳ Diferencial: {s.diferencial}</div>}
            </div>
          ))
        ) : (
          <div style={{ color: '#6b7280', fontStyle: 'italic', fontSize: '13px' }}>Nenhum similar local identificado no SAPL de Boa Vista — campo livre para propositura.</div>
        )}
      </div>

      {/* Referências Nacionais */}
      {referencias_nacionais && referencias_nacionais.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, color: '#1f2937', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            🇧🇷 Referências Nacionais
          </div>
          {referencias_nacionais.map((r, i) => (
            <div key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <div style={{ fontWeight: 600, color: '#1e40af' }}>
                  {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: '#1e40af', textDecoration: 'none' }}>{r.origem} ↗</a> : r.origem}
                </div>
                {r.numero && <span style={{ fontSize: '12px', color: '#6b7280' }}>{r.numero}</span>}
              </div>
              {r.titulo && <div style={{ color: '#374151', fontSize: '13px', fontStyle: 'italic', marginBottom: '6px' }}>{r.titulo}</div>}
              {r.nucleo && <div style={{ color: '#4b5563', fontSize: '13px' }}>{r.nucleo}</div>}
              {r.melhores_ideias && r.melhores_ideias.length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {r.melhores_ideias.map((ideia, j) => (
                    <div key={j} style={{ fontSize: '12px', color: '#059669', display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                      <span>💡</span> {ideia}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Referências Internacionais */}
      {referencias_internacionais && referencias_internacionais.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, color: '#1f2937', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            🌍 Referências Internacionais
          </div>
          {referencias_internacionais.map((r, i) => (
            <div key={i} style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '12px 14px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, color: '#0369a1' }}>{r.pais}</span>
                <span style={{ color: '#6b7280', fontSize: '13px' }}>—</span>
                <span style={{ color: '#374151', fontSize: '13px' }}>
                  {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: '#0369a1', textDecoration: 'none' }}>{r.instituicao} ↗</a> : r.instituicao}
                </span>
              </div>
              <div style={{ color: '#4b5563', fontSize: '13px', lineHeight: '1.5', marginBottom: '6px' }}>{r.descricao}</div>
              {r.melhores_ideias && r.melhores_ideias.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {r.melhores_ideias.map((ideia, j) => (
                    <div key={j} style={{ fontSize: '12px', color: '#0369a1', display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                      <span>💡</span> {ideia}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Síntese de Boas Práticas */}
      {ideias_aproveitadas && (
        <div style={{ background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            ✨ Síntese — Melhores ideias para incorporar ao PL
          </div>
          {ideias_aproveitadas.resumo && (
            <p style={{ margin: '0 0 10px 0', color: '#374151', lineHeight: '1.6', fontSize: '13px' }}>{ideias_aproveitadas.resumo}</p>
          )}
          {ideias_aproveitadas.sugestoes_para_incorporar && ideias_aproveitadas.sugestoes_para_incorporar.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {ideias_aproveitadas.sugestoes_para_incorporar.map((s, i) => (
                <li key={i} style={{ fontSize: '13px', color: '#5b21b6', lineHeight: '1.5' }}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}



function ResultadoJuridico({ data }: { data: Record<string, unknown> }) {
  const { risco_nivel, parecer_resumido, viabilidade, recomendacoes } = data as {
    risco_nivel?: string;
    parecer_resumido?: string;
    viabilidade?: string;
    recomendacoes?: string[];
  };
  const corRisco = risco_nivel === 'baixo' ? '#10b981' : risco_nivel === 'medio' ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '16px', fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>Risco:</span>
        <span style={{ background: corRisco, color: 'white', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase' }}>{risco_nivel || 'N/A'}</span>
        <span style={{ fontWeight: 700 }}>Viabilidade:</span>
        <span style={{ color: '#374151' }}>{viabilidade}</span>
      </div>
      {parecer_resumido && (
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '12px', color: '#374151', lineHeight: '1.6' }}>
          {parecer_resumido}
        </div>
      )}
      {recomendacoes && recomendacoes.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Recomendações:</div>
          {recomendacoes.map((r, i) => (
            <div key={i} style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>• {r}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultadoAcessorios({ data }: { data: Record<string, unknown> }) {
  const { pls_acessorios, estrategia_geral } = data as {
    pls_acessorios?: Array<{ titulo: string; objeto: string; relacao_tronco: string; viabilidade_politica: string; tipo_sugerido: string }>;
    estrategia_geral?: string;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
      {estrategia_geral && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 14px', color: '#1d4ed8', fontSize: '13px' }}>
          <strong>Estratégia:</strong> {estrategia_geral}
        </div>
      )}
      {pls_acessorios?.map((pl, i) => (
        <div key={i} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div style={{ fontWeight: 600, color: '#1f2937' }}>{pl.titulo}</div>
            <span style={{ background: '#f3f4f6', color: '#374151', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{pl.tipo_sugerido}</span>
          </div>
          <div style={{ color: '#4b5563', marginBottom: '4px' }}>{pl.objeto}</div>
          <div style={{ color: '#6b7280', fontSize: '13px' }}>Conexão: {pl.relacao_tronco}</div>
          <div style={{ marginTop: '6px' }}>
            <span style={{ fontSize: '12px', color: pl.viabilidade_politica === 'Alta' ? '#059669' : pl.viabilidade_politica === 'Média' ? '#d97706' : '#dc2626', fontWeight: 600 }}>
              Viabilidade: {pl.viabilidade_politica}
            </span>
          </div>
        </div>
      ))}
      {(!pls_acessorios || pls_acessorios.length === 0) && (
        <div style={{ color: '#6b7280', fontStyle: 'italic' }}>Nenhum PL acessório identificado para este tema.</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────────────────────────────────────

function formatarPLTexto(data: Record<string, unknown>): string {
  const artigos = (data.artigos as Array<{ numero: number; texto: string; paragrafos?: string[]; incisos?: string[] }>) || [];
  const lines: string[] = [];

  if (data.epigrafe) lines.push(String(data.epigrafe), '');
  if (data.ementa) lines.push(`Ementa: ${String(data.ementa)}`, '');
  if (data.preambulo) lines.push(String(data.preambulo), '');

  artigos.forEach(art => {
    const ordinal = art.numero <= 9 ? `Art. ${toOrdinal(art.numero)}` : `Art. ${art.numero}.`;
    lines.push(`${ordinal} ${art.texto}`);
    (art.incisos || []).forEach(i => lines.push(`  ${i}`));
    (art.paragrafos || []).forEach(p => lines.push(`  ${p}`));
    lines.push('');
  });

  if (data.clausula_vigencia) lines.push(String(data.clausula_vigencia), '');
  if (data.clausula_revogacao) lines.push(String(data.clausula_revogacao), '');
  if (data.justificativa) lines.push('', 'JUSTIFICATIVA', '──────────────────────────', String(data.justificativa));

  return lines.join('\n').trim();
}

function toOrdinal(n: number): string {
  const ord = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º'];
  return ord[n - 1] || `${n}.`;
}
