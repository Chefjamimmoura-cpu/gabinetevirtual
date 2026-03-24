'use client';

import { useState } from 'react';
import styles from './gerar-protocolar.module.css';
import { X, Sparkles, Send, RefreshCw, FileText, Check, AlertCircle, ExternalLink, ArrowLeft, Download, Loader2, Image as ImageIcon } from 'lucide-react';

interface Indicacao {
  id: string;
  titulo: string;
  bairro: string;
  logradouro: string;
  setores: string[];
  classificacao?: string | null;
  documento_ementa?: string | null;
  documento_gerado_md?: string | null;
  protocolado_em?: string | null;
  sapl_numero?: string | null;
  fotos_urls?: string[] | null;
}

interface GerarProtocolarModalProps {
  indicacao: Indicacao;
  onClose: () => void;
  onSuccess: (sapl_numero: string) => void;
}

type Etapa = 'revisao' | 'gerando' | 'gerado' | 'protocolando' | 'concluido' | 'erro';

export function GerarProtocolarModal({ indicacao, onClose, onSuccess }: GerarProtocolarModalProps) {
  const [etapa, setEtapa] = useState<Etapa>('revisao');
  const [ementa, setEmenta] = useState(indicacao.documento_ementa ?? '');
  const [textoMd, setTextoMd] = useState(indicacao.documento_gerado_md ?? '');
  const [erro, setErro] = useState('');
  const [saplNumero, setSaplNumero] = useState(indicacao.sapl_numero ?? '');
  const [saplUrl, setSaplUrl] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [usarMarcaDagua, setUsarMarcaDagua] = useState(true);

  async function handleDownloadDocx() {
    setIsExporting(true);
    setErro('');
    try {
      const res = await fetch('/api/indicacoes/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ementa,
          texto_md: textoMd,
          fotos_urls: indicacao.fotos_urls || [],
          incluir_marca_dagua: usarMarcaDagua,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Erro ao gerar DOCX');
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Indicacao_${indicacao.sapl_numero || indicacao.id.substring(0, 5)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao baixar DOCX');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleGerar() {
    setEtapa('gerando');
    setErro('');
    try {
      const res = await fetch('/api/indicacoes/gerar-documento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indicacao_id: indicacao.id }),
      });
      const data = await res.json() as { ok: boolean; ementa?: string; texto_completo_md?: string; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Falha ao gerar documento');
      setEmenta(data.ementa ?? '');
      setTextoMd(data.texto_completo_md ?? '');
      setEtapa('gerado');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido');
      setEtapa('erro');
    }
  }

  async function handleProtocolar() {
    if (!ementa.trim()) {
      setErro('A ementa não pode estar vazia');
      return;
    }
    setEtapa('protocolando');
    setErro('');
    try {
      const res = await fetch('/api/sapl/protocolar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao: ementa.trim(), tipo_sigla: 'IND' }),
      });
      const data = await res.json() as {
        ok: boolean;
        numero_proposicao?: number;
        sapl_url?: string;
        error?: string;
        instrucao?: string;
      };
      if (!data.ok) throw new Error(data.error ?? data.instrucao ?? 'Falha no protocolo SAPL');
      const num = `IND ${data.numero_proposicao}/${new Date().getFullYear()}`;
      setSaplNumero(num);
      setSaplUrl(data.sapl_url ?? '');
      setEtapa('concluido');
      onSuccess(num);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido');
      setEtapa('erro');
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.tituloGroup}>
            <h2 className={styles.titulo}>Protocolar no SAPL</h2>
            <p className={styles.subtitulo}>{indicacao.titulo}</p>
          </div>
          <button onClick={onClose} className={styles.btnFechar}><X size={24}/></button>
        </div>

        {/* Dados da indicação */}
        <div className={styles.dadosBox}>
          <span className={styles.tag}>📍 {indicacao.logradouro}</span>
          <span className={styles.tag}>🏘️ {indicacao.bairro}</span>
          {(indicacao.setores ?? []).slice(0, 3).map(s => (
            <span key={s} className={styles.tag} style={{ background: '#e0f2fe', color: '#0369a1', borderColor: '#bae6fd' }}>{s}</span>
          ))}
          {indicacao.classificacao && (
            <span className={styles.tag} style={{
              background: indicacao.classificacao === 'urgencia' ? '#fef2f2' : indicacao.classificacao === 'prioridade' ? '#fffbeb' : '#f0fdf4',
              color: indicacao.classificacao === 'urgencia' ? '#dc2626' : indicacao.classificacao === 'prioridade' ? '#d97706' : '#16a34a',
              borderColor: indicacao.classificacao === 'urgencia' ? '#fecaca' : indicacao.classificacao === 'prioridade' ? '#fde68a' : '#bbf7d0',
            }}>
              {indicacao.classificacao.toUpperCase()}
            </span>
          )}
        </div>

        {/* Conteúdo por etapa */}
        {etapa === 'revisao' && (
          <div>
            <p className={styles.instrucao}>
              A Inteligência Artificial vai redigir e formatar a indicação no padrão exato exigido pelo SAPL da CMBV.
              Você poderá revisar a ementa sugerida antes do envio final.
            </p>
            {indicacao.documento_ementa && (
              <div className={styles.ementaBox}>
                <label className={styles.label}>Ementa Salva (clique "Gerar" para criar nova versão)</label>
                <p className={styles.ementaTexto}>{indicacao.documento_ementa}</p>
              </div>
            )}
            <div className={styles.btnRow}>
              <button onClick={onClose} className={styles.btnSecundario}>Cancelar</button>
              {indicacao.documento_ementa && (
                <button onClick={() => setEtapa('gerado')} className={styles.btnSecundario}>
                  Ver Ementa Salva
                </button>
              )}
              <button onClick={handleGerar} className={styles.btnPrimario}>
                <Sparkles size={18} /> Gerar com IA
              </button>
            </div>
          </div>
        )}

        {etapa === 'gerando' && (
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Redigindo documento com Gemini...</p>
            <p className={styles.loadingSubtext}>Aplicando regras textuais e formatando padrão SAPL</p>
          </div>
        )}

        {etapa === 'gerado' && (
          <div>
            <div className={styles.ementaBox} style={{ background: '#fff' }}>
              <label className={styles.label} style={{ color: '#111827' }}>Ementa (Editável antes do Envio)</label>
              <textarea
                value={ementa}
                onChange={e => setEmenta(e.target.value)}
                className={styles.textarea}
              />
            </div>
            {textoMd && (
              <details style={{ marginTop: '12px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.9rem', color: '#6b7280', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                   <FileText size={16}/> Visualizar doc. completo
                </summary>
                <div className={styles.pre}>{textoMd}</div>
              </details>
            )}

            <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                <ImageIcon size={18} color="#64748b" />
                <span style={{ fontSize: '0.95rem', color: '#334155', fontWeight: 500 }}>Incluir Marca D'água no Documento</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
                <input 
                  type="checkbox" 
                  checked={usarMarcaDagua} 
                  onChange={e => setUsarMarcaDagua(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                />
                <div style={{
                  width: '40px', height: '22px', background: usarMarcaDagua ? '#10b981' : '#cbd5e1', 
                  borderRadius: '11px', position: 'relative', transition: 'background 0.3s'
                }}>
                  <div style={{
                    width: '18px', height: '18px', background: 'white', borderRadius: '50%',
                    position: 'absolute', top: '2px', left: usarMarcaDagua ? '20px' : '2px', 
                    transition: 'left 0.3s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                  }} />
                </div>
              </label>
            </div>

            <div className={styles.btnRow}>
              <button onClick={() => setEtapa('revisao')} className={styles.btnSecundario}><ArrowLeft size={18}/> Voltar</button>
              <button onClick={handleDownloadDocx} className={styles.btnSecundario} disabled={isExporting || !ementa.trim()}>
                {isExporting ? <Loader2 size={18} className={styles.spinIcon} /> : <Download size={18}/>} Baixar DOCX
              </button>
              <button onClick={handleProtocolar} className={styles.btnPrimario} disabled={!ementa.trim()}>
                <Send size={18}/> Registrar no SAPL
              </button>
            </div>
          </div>
        )}

        {etapa === 'protocolando' && (
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Conectando ao SAPL da CMBV...</p>
            <p className={styles.loadingSubtext}>Registrando matéria legislativa online</p>
          </div>
        )}

        {etapa === 'concluido' && (
          <div className={styles.sucessoBox}>
            <div className={styles.sucessoIcon}><Check size={48} strokeWidth={3}/></div>
            <h3 className={styles.sucessoTitulo}>Matéria Lançada com Sucesso!</h3>
            <p className={styles.sucessoBadge}>{saplNumero}</p>
            {saplUrl && (
              <a href={saplUrl} target="_blank" rel="noopener noreferrer" className={styles.linkSapl}>
                <ExternalLink size={16}/> Abrir página no SAPL
              </a>
            )}
            <button onClick={onClose} className={styles.btnPrimario} style={{ marginTop: '32px' }}>
              Voltar ao Painel
            </button>
          </div>
        )}

        {etapa === 'erro' && (
          <div className={styles.erroBox}>
            <div className={styles.erroTitulo}><AlertCircle size={24}/> Falha na Etapa</div>
            <p className={styles.erroMsg}>{erro}</p>
            <div className={styles.btnRow} style={{ justifyContent: 'center', borderTop: 'none' }}>
              <button onClick={() => setEtapa('revisao')} className={styles.btnSecundario}><ArrowLeft size={18}/> Voltar</button>
              <button onClick={!ementa ? handleGerar : handleProtocolar} className={styles.btnPrimario}>
                <RefreshCw size={18}/> Tentar Novamente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
