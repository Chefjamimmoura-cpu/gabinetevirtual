'use client';

import React, { useState } from 'react';
import { CheckCircle, XCircle, Clock, MapPin, Play, Mic, Image as ImageIcon, Send, Edit3, Bot, Mail } from 'lucide-react';
import styles from './indicacoes-moderacao.module.css';

// Interface do mock
interface IndicacaoPendente {
  id: string;
  cidadao: string;
  telefone: string;
  bairro: string;
  rua: string;
  midia_tipo: 'audio' | 'texto' | 'email' | 'instagram' | 'manual';
  midia_url?: string;
  transcricao: string;
  fotos: string[];
  ementaGerada: string;
  status: 'pendente' | 'aprovada' | 'recusada';
  dataRecebida: string;
}

const MOCK_FALLBACK: IndicacaoPendente[] = []; // Substituído por array vazio. Aguardando a rota real do banco.

function getTempoRelativo(dataStr: string): string {
  const agora = Date.now();
  const data = new Date(dataStr).getTime();
  const diffMin = Math.floor((agora - data) / 60000);
  if (diffMin < 1) return 'Agora mesmo';
  if (diffMin < 60) return `Há ${diffMin} min`;
  const diffHoras = Math.floor(diffMin / 60);
  if (diffHoras < 24) return `Há ${diffHoras}h`;
  return `Há ${Math.floor(diffHoras / 24)}d`;
}

export function IndicacoesModeracao() {
  const [pendentes, setPendentes] = useState<IndicacaoPendente[]>(MOCK_FALLBACK);
  const [generating, setGenerating] = useState<string | null>(null);
  const [mostrarModalManual, setMostrarModalManual] = useState(false);

  // Manual form state
  const [manualForm, setManualForm] = useState({ cidadao: '', bairro: '', rua: '', descricao: '' });

  const handleAprovar = (id: string) => {
    setGenerating(id);
    setTimeout(() => {
      setPendentes(prev => prev.map(p => p.id === id ? { ...p, status: 'aprovada' } : p));
      setGenerating(null);
    }, 1500);
  };

  const handleRecusar = (id: string) => {
    setPendentes(prev => prev.map(p => p.id === id ? { ...p, status: 'recusada' } : p));
  };

  const handleManualSubmit = () => {
    // Mock: adiciona um item novo à lista
    const novoItem: IndicacaoPendente = {
      id: `IND-${Date.now().toString().slice(-4)}`,
      cidadao: manualForm.cidadao || 'Inserção Manual',
      telefone: '-',
      bairro: manualForm.bairro,
      rua: manualForm.rua,
      midia_tipo: 'manual',
      transcricao: manualForm.descricao,
      fotos: [],
      ementaGerada: '',
      status: 'pendente',
      dataRecebida: new Date().toISOString()
    };
    setPendentes(prev => [novoItem, ...prev]);
    setMostrarModalManual(false);
    setManualForm({ cidadao: '', bairro: '', rua: '', descricao: '' });
  };

  const ativos = pendentes.filter(p => p.status === 'pendente');

  if (ativos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px', opacity: 0.8 }} />
        <h3 className={styles.emptyTitle}>Tudo Limpo!</h3>
        <p className={styles.emptyText}>Não há indicações da ALIA aguardando moderação no momento.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Info Banner */}
      <div className={styles.infoBanner}>
        <Bot size={24} color="#488DC7" />
        <div className={styles.infoBannerContent}>
          <h4 className={styles.infoBannerTitle}>Fila de Moderação da ALIA</h4>
          <p className={styles.infoBannerText}>
            Essas solicitações chegaram via WhatsApp, E-mail ou Instagram, foram triadas e transcritas pela IA. Aprove para protocolar no SAPL.
          </p>
        </div>
        <button onClick={() => setMostrarModalManual(true)} className={styles.btnManual}>
          <Edit3 size={18} /> Inserção Manual
        </button>
      </div>

      {/* Cards */}
      {ativos.map(item => (
        <div key={item.id} className={styles.card}>
          {/* Lado Esquerdo: Origem (Cidadão) */}
          <div className={styles.cardLeft}>
            <div className={styles.cardLeftHeader}>
              <span className={styles.labelEntrada}>Entrada Cidadão</span>
              <span className={styles.labelTempo}>
                <Clock size={14} /> {getTempoRelativo(item.dataRecebida)}
              </span>
            </div>
            
            <div className={styles.cidadaoInfo}>
              <h3 className={styles.cidadaoNome}>{item.cidadao}</h3>
              <div className={styles.cidadaoEndereco}>
                <MapPin size={14} /> {item.rua}, {item.bairro}
              </div>
            </div>

            {/* Media type badge + audio player */}
            {item.midia_tipo === 'audio' ? (
              <div className={`${styles.mediaBadge} ${styles.mediaBadgeAudio}`}>
                <div className={styles.audioPlayer}>
                  <button className={styles.audioPlayBtn} type="button">
                    <Play size={16} fill="white" />
                  </button>
                  <div className={styles.audioProgressTrack}>
                    <div className={styles.audioProgressFill} />
                  </div>
                  <span className={styles.audioDuration}>0:15</span>
                </div>
              </div>
            ) : item.midia_tipo === 'email' ? (
              <div className={`${styles.mediaBadge} ${styles.mediaBadgeEmail}`}>
                <Mail size={16} color="#64748b" /> E-mail Interceptado e Analisado pela ALIA
              </div>
            ) : item.midia_tipo === 'instagram' ? (
              <div className={`${styles.mediaBadge} ${styles.mediaBadgeInstagram}`}>
                <Bot size={16} /> Instagram (Via Webhook)
              </div>
            ) : item.midia_tipo === 'manual' ? (
              <div className={`${styles.mediaBadge} ${styles.mediaBadgeManual}`}>
                <Edit3 size={16} /> Inserção Manual pelo Gabinete
              </div>
            ) : (
              <div className={`${styles.mediaBadge} ${styles.mediaBadgeTexto}`}>
                <Mic size={16} /> Mensagem de Texto (WhatsApp)
              </div>
            )}

            <div className={styles.transcricao}>
              &ldquo;{item.transcricao}&rdquo;
            </div>

            {item.fotos.length > 0 && (
              <div className={styles.fotosRow}>
                {item.fotos.map((f, i) => (
                  <div key={i} className={styles.fotoThumb}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f} alt="Evidência" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lado Direito: Processamento ALIA */}
          <div className={styles.cardRight}>
            <div className={styles.cardRightHeader}>
              <span className={styles.labelAlia}>
                <Bot size={16} /> Processamento ALIA
              </span>
              <span className={styles.badgePendente}>
                Aguardando Moderação
              </span>
            </div>

            <div className={styles.ementaSection}>
              <label className={styles.ementaLabel}>Ementa Formalizada (Padrão SAPL):</label>
              <div className={styles.ementaContent}>
                {item.ementaGerada || 'Ementa ainda não gerada pela IA. Aprove para iniciar a geração.'}
              </div>
            </div>

            {/* Botões de Ação */}
            <div className={styles.actions}>
              <button
                onClick={() => handleAprovar(item.id)}
                disabled={generating === item.id}
                className={styles.btnAprovar}
              >
                {generating === item.id ? <Clock size={18} className="animate-spin" /> : <Send size={18} />}
                {generating === item.id ? 'Protocolando...' : 'Aprovar e Protocolar'}
              </button>
              <button className={styles.btnEditar} title="Editar Ementa">
                <Edit3 size={18} />
              </button>
              <button onClick={() => handleRecusar(item.id)} className={styles.btnRecusar} title="Recusar">
                <XCircle size={18} />
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Modal Inserção Manual */}
      {mostrarModalManual && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBox}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Nova Indicação Manual</h3>
              <button onClick={() => setMostrarModalManual(false)} className={styles.modalBtnClose}>
                <XCircle size={22} color="#ef4444" />
              </button>
            </div>
            
            <div className={styles.modalForm}>
              <div>
                <label className={styles.fieldLabel}>Cidadão / Solicitante</label>
                <input
                  type="text"
                  placeholder="Nome da pessoa ou Associação..."
                  value={manualForm.cidadao}
                  onChange={e => setManualForm(prev => ({ ...prev, cidadao: e.target.value }))}
                  className={styles.fieldInput}
                />
              </div>
              <div className={styles.modalFormRow}>
                <div style={{ flex: 1 }}>
                  <label className={styles.fieldLabel}>Bairro</label>
                  <input
                    type="text"
                    placeholder="Ex: Pricumã"
                    value={manualForm.bairro}
                    onChange={e => setManualForm(prev => ({ ...prev, bairro: e.target.value }))}
                    className={styles.fieldInput}
                  />
                </div>
                <div style={{ flex: 2 }}>
                  <label className={styles.fieldLabel}>Rua / Endereço</label>
                  <input
                    type="text"
                    placeholder="Rua / Av..."
                    value={manualForm.rua}
                    onChange={e => setManualForm(prev => ({ ...prev, rua: e.target.value }))}
                    className={styles.fieldInput}
                  />
                </div>
              </div>
              <div>
                <label className={styles.fieldLabel}>Descrição do Problema</label>
                <textarea
                  rows={4}
                  placeholder="Descreva o problema para que a ALIA possa gerar o ofício adequadamente..."
                  value={manualForm.descricao}
                  onChange={e => setManualForm(prev => ({ ...prev, descricao: e.target.value }))}
                  className={styles.fieldTextarea}
                />
              </div>
              
              <button onClick={handleManualSubmit} className={styles.modalSubmit}>
                Salvar e Passar para ALIA
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

