'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Send, Loader2, Sparkles, Download, Building, Save, Trash2, FolderOpen, CheckCircle, Clock, Archive, PenLine, ChevronRight, Edit3 } from 'lucide-react';
import styles from './oficios-dashboard.module.css';
import { OficiosModeracao } from './components/oficios-moderacao';
import { A4DocumentViewer } from '@/components/ui/a4-document-viewer';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface OficioGerado {
  numero: string;
  cidadeData: string;
  pronomeTratamento: string;
  destinatarioFinal: string;
  cargoFinal: string;
  assuntoOficial: string;
  corpo: string;
  assinaturaNome: string;
  assinaturaCargo: string;
}

interface OficioSalvo {
  id: string;
  numero_seq: number;
  ano: number;
  destinatario: string;
  cargo_dest: string | null;
  assunto: string;
  status: 'rascunho' | 'enviado' | 'arquivado';
  dados_json: OficioGerado;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  enviado: 'Enviado',
  arquivado: 'Arquivado',
};

const STATUS_NEXT: Record<string, string> = {
  rascunho: 'enviado',
  enviado: 'arquivado',
  arquivado: 'rascunho',
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function OficiosDashboard() {
  const [abaAtiva, setAbaAtiva] = useState<'moderacao' | 'manual'>('moderacao');
  // Form
  const [destinatario, setDestinatario] = useState('');
  const [cargo, setCargo] = useState('');
  const [assunto, setAssunto] = useState('');
  const [mensagem, setMensagem] = useState('');

  // Auto-Complete / Sugestões
  const [routeSuggestion, setRouteSuggestion] = useState<string | null>(null);

  // Estados UI
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [result, setResult] = useState<OficioGerado | null>(null);

  // CADIN
  const [cadinOrgs, setCadinOrgs] = useState<any[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);

  // Histórico
  const [historico, setHistorico] = useState<OficioSalvo[]>([]);
  const [isLoadingHistorico, setIsLoadingHistorico] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ─── Carregar dados iniciais ────────────────────────────────────────────────

  useEffect(() => {
    async function loadOrgs() {
      try {
        const res = await fetch('/api/cadin/organizations');
        if (res.ok) setCadinOrgs(await res.json());
      } catch (err) {
        console.error('Falha ao carregar órgãos do CADIN', err);
      } finally {
        setIsLoadingOrgs(false);
      }
    }
    loadOrgs();
  }, []);

  const loadHistorico = useCallback(async () => {
    setIsLoadingHistorico(true);
    try {
      const res = await fetch('/api/oficios');
      if (res.ok) setHistorico(await res.json());
    } catch (err) {
      console.error('Falha ao carregar histórico', err);
    } finally {
      setIsLoadingHistorico(false);
    }
  }, []);

  useEffect(() => { loadHistorico(); }, [loadHistorico]);

  // ─── Sistema de Roteamento Simulado (V5-F1 Base) ───────────────────────────
  // No fluxo final isso baterá na LLM, mas para UI, mockaremos uma resposta quando 'mensagem' perder foco
  
  const handleMensagemBlur = () => {
    if (mensagem.length > 10) {
      const text = mensagem.toLowerCase();
      if (text.includes('buraco') || text.includes('asfalto') || text.includes('rua') || text.includes('pavimento')) {
        setRouteSuggestion("SMO - Secretaria Municipal de Obras");
      } else if (text.includes('lixo') || text.includes('entulho') || text.includes('limpeza')) {
        setRouteSuggestion("SMSP - Serviços Públicos");
      } else if (text.includes('escola') || text.includes('creche')) {
        setRouteSuggestion("SMEC - Educação");
      } else {
        setRouteSuggestion(null); // Pede para selecionar manualmente
      }
    } else {
      setRouteSuggestion(null);
    }
  };

  const aplicarSugestao = () => {
    if (routeSuggestion) {
      // Find within cadinOrgs matching the abbreviation
      const prefix = routeSuggestion.split(' - ')[0]; // eg. "SMO"
      const matchOrg = cadinOrgs.find(o => o.sigla === prefix || (o.nomeOrgao && o.nomeOrgao.includes(prefix)));
      
      if (matchOrg) {
        // Pseudo-selection
        setDestinatario(matchOrg.titularNome ? `${matchOrg.titularNome}` : matchOrg.nomeOrgao);
        setCargo(matchOrg.titularCargo || 'Secretário(a) Municipal');
      } else {
        setDestinatario(routeSuggestion.split(' - ')[1]);
        setCargo('Secretário(a) Municipal');
      }
      setRouteSuggestion(null);
    }
  };


  // ─── CADIN selection ────────────────────────────────────────────────────────

  const handleOrgSelection = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    if (!selectedId) { setDestinatario(''); setCargo(''); return; }
    const org = cadinOrgs.find(o => o.id === selectedId);
    if (org) {
      setDestinatario(org.titularNome ? `${org.titularNome}` : org.nomeOrgao);
      if (org.titularCargo) {
        setCargo(org.titularCargo);
      } else if (org.tipo === 'prefeitura') {
        setCargo('Prefeito(a) Municipal');
      } else if (org.tipo === 'secretaria') {
        setCargo('Secretário(a) Municipal');
      } else {
        setCargo('Diretor(a) / Presidente');
      }
    }
  };

  // ─── Gerar ─────────────────────────────────────────────────────────────────

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinatario || !assunto || !mensagem) return;

    setIsGenerating(true);
    setResult(null);
    setSavedId(null);

    try {
      const res = await fetch('/api/oficios/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinatario, cargo, assunto, mensagem }),
      });
      if (!res.ok) throw new Error('Falha na geração do ofício');
      setResult(await res.json());
    } catch (err) {
      console.error(err);
      alert('Ocorreu um erro ao gerar o ofício. Tente novamente.');
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Salvar ────────────────────────────────────────────────────────────────

  const handleSalvar = async () => {
    if (!result) return;
    setIsSaving(true);

    try {
      const res = await fetch('/api/oficios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinatario: result.destinatarioFinal,
          cargo: result.cargoFinal,
          assunto: result.assuntoOficial,
          corpo: result.corpo,
          dados_json: result,
        }),
      });

      if (!res.ok) throw new Error('Falha ao salvar');

      const saved = await res.json();
      setResult({ ...result, numero: saved.numero });
      setSavedId(saved.id);
      await loadHistorico();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar o ofício. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Abrir ofício salvo ─────────────────────────────────────────────────────

  const handleAbrir = (oficio: OficioSalvo) => {
    const numeroFormatado = `${String(oficio.numero_seq).padStart(3, '0')}/${oficio.ano}`;
    setResult({ ...oficio.dados_json, numero: numeroFormatado });
    setSavedId(oficio.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ─── Deletar ───────────────────────────────────────────────────────────────

  const handleDeletar = async (id: string) => {
    if (!confirm('Excluir este ofício permanentemente?')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/oficios/${id}`, { method: 'DELETE' });
      if (savedId === id) { setResult(null); setSavedId(null); }
      await loadHistorico();
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Atualizar status ──────────────────────────────────────────────────────

  const handleStatus = async (oficio: OficioSalvo) => {
    const novoStatus = STATUS_NEXT[oficio.status];
    try {
      await fetch(`/api/oficios/${oficio.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus }),
      });
      await loadHistorico();
    } catch (err) {
      console.error(err);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.dashboardContainer} style={{ flexDirection: 'column', width: '100%', display: 'flex' }}>
      {/* Navegação por abas */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #e5e7eb', marginBottom: '24px', flexWrap: 'nowrap', width: '100%' }}>
        {[
          { id: 'moderacao', label: '🛡️ Moderação ALIA', title: 'Filas de tarefas pendentes geradas pela IA' },
          { id: 'manual',  label: '✍️ Geração Manual',  title: 'Gerar ofício manualmente no painel' },
        ].map(aba => (
          <button
            key={aba.id}
            title={aba.title}
            onClick={() => setAbaAtiva(aba.id as any)}
            style={{
              padding: '12px 24px',
              border: 'none',
              borderBottom: abaAtiva === aba.id ? '3px solid #0ea5e9' : '3px solid transparent',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              color: abaAtiva === aba.id ? '#0ea5e9' : '#6b7280',
              fontSize: '0.95rem',
              marginBottom: '-2px',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {aba.label}
          </button>
        ))}
      </div>

      {/* PAINEL DE CONTROLE DE NUMERAÇÃO E BANCO DE DADOS */}
      <div style={{ background: 'white', padding: '16px 24px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: '#f0fdf4', padding: '10px', borderRadius: '8px' }}>
            <Save size={24} color="#16a34a" />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#1e293b' }}>Banco de Dados ALIA</h4>
            <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }}></span> Conectado (Supabase `oficios`)
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: '#eff6ff', padding: '10px', borderRadius: '8px' }}>
             <Clock size={24} color="#1c4076" />
          </div>
          <div>
             <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#1e293b' }}>Sequencial Oficial</h4>
             <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Próximo Número: <strong style={{color: '#1d4ed8', fontSize: '1rem'}}>
                   {historico.length > 0 ? String(Math.max(...historico.map(h => h.numero_seq || 0)) + 1).padStart(3, '0') : '001'}
                </strong>/{new Date().getFullYear()}
             </div>
          </div>
        </div>
      </div>

      {abaAtiva === 'moderacao' ? (
        <OficiosModeracao />
      ) : (
        <div className={styles.mainGrid}>

          {/* === Left Panel: Form + Histórico === */}
          <section className={styles.inputSection}>
          <form className={styles.formCard} onSubmit={handleGenerate}>
            
            <div className={styles.formGroup}>
              <label>Órgão Alvo (CADIN)</label>
              <div className={styles.inputWithIcon}>
                <Building className={styles.inputIcon} size={16} />
                <select
                  className={`${styles.select} ${styles.withIcon}`}
                  onChange={handleOrgSelection}
                  defaultValue=""
                  disabled={isLoadingOrgs}
                >
                  <option value="" disabled>
                    {isLoadingOrgs ? 'Carregando banco de dados...' : 'Selecione a Secretaria/Órgão...'}
                  </option>
                  {cadinOrgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.nomeOrgao} {org.titularNome ? `— ${org.titularNome}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <div className={styles.formGroup} style={{ flex: 1.2 }}>
                <label>Destinatário (Nome)</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Ex: Ana Maria"
                  value={destinatario}
                  onChange={(e) => setDestinatario(e.target.value)}
                  required
                />
              </div>
              <div className={styles.formGroup} style={{ flex: 0.8 }}>
                <label>Cargo</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Ex: Secretária Mun."
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label>Assunto</label>
              <input
                type="text"
                className={styles.input}
                placeholder="Ex: Manutenção asfáltica"
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label>Sintetize seu Pedido</label>
              <div className={styles.inputWithIcon}>
                <PenLine className={styles.inputIcon} size={16} style={{ top: '14px' }} />
                <textarea
                  className={`${styles.textarea} ${styles.withIcon}`}
                  placeholder="Descreva o que você precisa pedir neste ofício. A IA inferirá os pronomes adequados..."
                  value={mensagem}
                  onBlur={handleMensagemBlur}
                  onChange={(e) => {
                    setMensagem(e.target.value);
                    if (routeSuggestion) setRouteSuggestion(null); // reseta sugestão
                  }}
                  required
                ></textarea>
              </div>
              
              {/* V5-F1 Base: Exibição da Sugestão Smart Routing */}
              {routeSuggestion && (
                  <div style={{ 
                      marginTop: '8px', 
                      padding: '10px 12px', 
                      background: '#fef2f2', 
                      border: '1px solid #fecaca', 
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                  }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                         <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase' }}>📡 Roteamento Inteligente (Automático)</span>
                         <span style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 600 }}>Destino Sugerido: {routeSuggestion}</span>
                      </div>
                      <button 
                         type="button" 
                         onClick={aplicarSugestao}
                         style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                         Aplicar <ChevronRight size={14}/>
                      </button>
                  </div>
              )}
            </div>

            <button
              type="submit"
              className={styles.generateButton}
              disabled={isGenerating || !destinatario || !assunto || !mensagem}
            >
              {isGenerating ? (
                <><Loader2 size={18} className={styles.spinIcon} /> Estruturando Documento...</>
              ) : (
                <><Sparkles size={18} /> Redigir Ofício </>
              )}
            </button>
          </form>

          {/* === Histórico de Ofícios === */}
          <div className={styles.historicoCard}>
            <div className={styles.historicoHeader}>
              <FolderOpen size={16} color="var(--primary-600)" />
              <span>Rascunhos e Emitidos</span>
              <span className={styles.historicoBadge}>{historico.length} Docs</span>
            </div>

            {isLoadingHistorico ? (
              <div className={styles.historicoLoading}>
                <Loader2 size={16} className={styles.spinIcon} />
                <span>Carregando arquivo...</span>
              </div>
            ) : historico.length === 0 ? (
              <p className={styles.historicoVazio}>Nenhum documento gerado.</p>
            ) : (
              <ul className={styles.historicoList}>
                {historico.map((oficio) => {
                  const numero = `${String(oficio.numero_seq).padStart(3, '0')}/${oficio.ano}`;
                  const isActive = savedId === oficio.id;
                  return (
                    <li
                      key={oficio.id}
                      className={`${styles.historicoItem} ${isActive ? styles.historicoItemActive : ''}`}
                    >
                      <button
                        className={styles.historicoAbrir}
                        onClick={() => handleAbrir(oficio)}
                      >
                        <span className={styles.historicoNumero}>OF. NÃO OF. Nº {numero}</span>
                        <span className={styles.historicoDestinatario}>{oficio.destinatario}</span>
                        <span className={styles.historicoAssunto}>{oficio.assunto}</span>
                      </button>
                      <div className={styles.historicoAcoes}>
                        <button
                          className={`${styles.statusBadge} ${styles[`status_${oficio.status}`]}`}
                          onClick={() => handleStatus(oficio)}
                          title={`Alterar Status`}
                        >
                          {oficio.status === 'rascunho' && <Clock size={12} />}
                          {oficio.status === 'enviado' && <CheckCircle size={12} />}
                          {oficio.status === 'arquivado' && <Archive size={12} />}
                          {STATUS_LABEL[oficio.status]}
                        </button>
                        <button
                          className={styles.historicoDelete}
                          onClick={() => handleDeletar(oficio.id)}
                          disabled={deletingId === oficio.id}
                        >
                          {deletingId === oficio.id
                            ? <Loader2 size={14} className={styles.spinIcon} />
                            : <Trash2 size={14} />}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* === Right Panel: Output Document === */}
        <section className={styles.outputSection}>
          <div className={styles.outputCard}>

            {!result && !isGenerating && (
              <div className={styles.emptyState}>
                <Send size={48} color="var(--color-text-muted)" style={{ opacity: 0.3 }} />
                <p>O rascunho do Ofício aparecerá aqui.</p>
                <span>Formatado automaticamente em papel timbrado digital, processando os pronomes e jargão correto, pronto para assinatura.</span>
              </div>
            )}

            {isGenerating && (
              <div className={styles.generatingState}>
                <div className={styles.pulseDisk}>
                  <Sparkles size={32} color="var(--primary-600)" />
                </div>
                <p>Redigindo documento oficial...</p>
              </div>
            )}

            {result && (
              <div className={styles.documentViewer}>
                <div className={styles.documentToolbar}>
                  <div className={styles.documentIdBadge}>
                    NUMERAÇÃO: OF. {result.numero}
                    {savedId && <span className={styles.savedIndicator}>✓ Salvo</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {!savedId && (
                      <button
                        className={styles.saveButton}
                        onClick={handleSalvar}
                        disabled={isSaving}
                      >
                        {isSaving
                          ? <><Loader2 size={16} className={styles.spinIcon} /> Salvando BD...</>
                          : <><Save size={16} /> Salvar Cópia Oficial</>}
                      </button>
                    )}
                    <button
                      className={styles.exportButton}
                      onClick={async () => {
                        if (!result) return;
                        try {
                          const res = await fetch('/api/oficios/export-docx', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(result),
                          });
                          if (!res.ok) throw new Error('Falha ao gerar DOCX');
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `Oficio_${result.numero.replace(/\//g, '-')}_CMBV.docx`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (err) {
                          console.error('Erro ao exportar DOCX:', err);
                          alert('Erro ao gerar o documento DOCX. Tente novamente.');
                        }
                      }}
                    >
                      <Download size={16} /> Gerar DOCX
                    </button>
                  </div>
                </div>

                <A4DocumentViewer>
                  <div className={styles.paperHeader} style={{ textAlign: 'right', marginBottom: '40px', fontSize: '12pt' }}>
                    <div className={styles.paperCityDate}>{result.cidadeData}</div>
                  </div>

                  <div className={styles.paperAddressBlock} style={{ marginBottom: '40px', fontSize: '12pt', lineHeight: '1.5' }}>
                    <p className={styles.paperRecipientTitle} style={{ margin: 0 }}>{result.pronomeTratamento},</p>
                    <p className={styles.paperRecipientName} style={{ margin: 0, fontWeight: 'bold' }}>{result.destinatarioFinal}</p>
                    <p style={{ margin: 0 }}>{result.cargoFinal}</p>
                  </div>

                  <div className={styles.paperSubjectBlock} style={{ marginBottom: '40px', fontSize: '12pt' }}>
                    <span className={styles.paperSubjectTitle} style={{ fontWeight: 'bold' }}>Assunto: </span>
                    <span>{result.assuntoOficial}</span>
                  </div>

                  <div className={styles.paperBody} style={{ textAlign: 'justify', fontSize: '12pt', lineHeight: '1.5', whiteSpace: 'pre-wrap', marginBottom: '80px' }}>
                    {result.corpo}
                  </div>

                  <div className={styles.paperSignatureBlock} style={{ textAlign: 'center', marginTop: '60px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span className={styles.paperSignatureLine} style={{ display: 'block', width: '250px', borderTop: '1px solid black', marginBottom: '8px' }}></span>
                    <p className={styles.paperSignerName} style={{ margin: '0 0 2px 0', fontWeight: 'bold', fontSize: '12pt' }}>{result.assinaturaNome}</p>
                    <p className={styles.paperSignerRole} style={{ margin: 0, fontSize: '12pt' }}>{result.assinaturaCargo}</p>
                  </div>
                </A4DocumentViewer>
              </div>
            )}

          </div>
        </section>

        </div>
      )}
    </div>
  );
}

