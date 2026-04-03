'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Topbar from '@/components/topbar';
import ConfirmModal, { Toast } from '@/components/ui/confirm-modal';
import { createClient } from '@/lib/supabase/client';
import {
  Mic, Upload, FileAudio, Clock, Loader2,
  Play, ChevronRight, Calendar, Users, MessageSquare,
  RefreshCw, Search, Trash2, Link2, Pencil
} from 'lucide-react';

interface Sessao {
  id: string;
  titulo: string;
  data_sessao: string | null;
  duracao_segundos: number | null;
  fonte: string;
  status: string;
  error_msg: string | null;
  created_at: string;
}

interface SpeakerBlock {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker: string;
  speakerId: string;
  speakerColor: string;
  isUnclear: boolean;
}

interface KeyPoint {
  id: string;
  start: number;
  title: string;
  description: string;
  reasons: string[];
}

interface SessaoDetalhe extends Sessao {
  transcricao: { text: string; segments: SpeakerBlock[]; words: unknown[] } | null;
  pontos_chave: KeyPoint[] | null;
  relatorio: string | null;
  audio_url: string | null;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function SessoesPage() {
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [gabineteId, setGabineteId] = useState<string | null>(null);
  const [selectedSessao, setSelectedSessao] = useState<SessaoDetalhe | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<'sessoes' | 'youtube'>('sessoes');
  const [ytVideos, setYtVideos] = useState<{ id: string; title: string; url: string; thumbnail: string; duration_fmt: string; upload_date: string | null; }[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytTranscribing, setYtTranscribing] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<'transcricao' | 'relatorio'>('transcricao');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [relatorio, setRelatorio] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [ytManualUrl, setYtManualUrl] = useState('');
  const [modal, setModal] = useState<{ open: boolean; title: string; message: string; variant: 'danger' | 'success' | 'info' | 'warning'; onConfirm: () => void }>({ open: false, title: '', message: '', variant: 'info', onConfirm: () => {} });
  const [toast, setToast] = useState<{ open: boolean; message: string; variant: 'danger' | 'success' | 'info' | 'warning' }>({ open: false, message: '', variant: 'info' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load gabinete ID
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('gabinete_id').eq('id', user.id).single();
        if (profile?.gabinete_id) setGabineteId(profile.gabinete_id);
      }
    }
    init();
  }, []);

  const fetchSessoes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sessoes/listar');
      if (res.ok) {
        const data = await res.json();
        setSessoes(data.sessoes || []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSessoes(); }, [fetchSessoes]);

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setUploadProgress('Enviando para transcrição...');
    try {
      const form = new FormData();
      form.append('audio', file);
      form.append('titulo', file.name.replace(/\.[^.]+$/, ''));
      form.append('data_sessao', new Date().toISOString().split('T')[0]);
      if (gabineteId) form.append('gabinete_id', gabineteId);

      setUploadProgress('Transcrevendo com Groq Whisper...');
      const res = await fetch('/api/sessoes/transcrever', { method: 'POST', body: form });
      const data = await res.json();

      if (res.ok && data.ok) {
        setUploadProgress(`Concluído! ${data.total_blocos} blocos, ${data.total_pontos_chave} pontos-chave.`);
        await fetchSessoes();
        // Auto-abrir a sessão recém-criada
        loadSessaoDetail(data.sessao_id);
      } else {
        setUploadProgress(`Erro: ${data.error || 'Falha na transcrição'}`);
      }
    } catch (err) {
      setUploadProgress('Erro de rede ao enviar arquivo.');
    } finally {
      setTimeout(() => { setUploading(false); setUploadProgress(''); }, 3000);
    }
  };

  const loadSessaoDetail = async (id: string) => {
    setLoadingDetail(true);
    setSelectedSessao(null);
    setDetailView('transcricao');
    setRelatorio(null);
    try {
      const res = await fetch(`/api/sessoes/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedSessao(data);
      }
    } catch { /* silent */ }
    finally { setLoadingDetail(false); }
  };

  const fetchYtVideos = useCallback(async () => {
    setYtLoading(true);
    try {
      const res = await fetch('/api/sessoes/youtube');
      const data = await res.json();
      if (res.ok) {
        setYtVideos(data.videos || []);
      } else {
        setToast({ open: true, message: data.error || 'Erro ao listar vídeos.', variant: 'danger' });
      }
    } catch { /* silent */ }
    finally { setYtLoading(false); }
  }, []);

  const handleYtTranscribe = async (video: { id: string; title: string; url: string }) => {
    setYtTranscribing(video.id);
    setUploadProgress(`Baixando e transcrevendo: ${video.title}...`);
    setUploading(true);
    try {
      const res = await fetch('/api/sessoes/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: video.url, titulo: video.title, gabinete_id: gabineteId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUploadProgress(`Transcrição concluída! ${data.total_blocos} blocos.`);
        setActiveTab('sessoes');
        await fetchSessoes();
        loadSessaoDetail(data.sessao_id);
      } else {
        setUploadProgress(`Erro: ${data.error || 'Falha'}`);
      }
    } catch { setUploadProgress('Erro de rede.'); }
    finally {
      setYtTranscribing(null);
      setTimeout(() => { setUploading(false); setUploadProgress(''); }, 3000);
    }
  };

  useEffect(() => { if (activeTab === 'youtube' && ytVideos.length === 0) fetchYtVideos(); }, [activeTab, ytVideos.length, fetchYtVideos]);

  const handleGenerateReport = async () => {
    if (!selectedSessao) return;
    setGeneratingReport(true);
    setRelatorio(null);
    try {
      const res = await fetch('/api/sessoes/relatorio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessao_id: selectedSessao.id }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRelatorio(data.relatorio);
        setDetailView('relatorio');
      } else {
        setToast({ open: true, message: data.error || 'Erro ao gerar relatório', variant: 'danger' });
      }
    } catch { setToast({ open: true, message: 'Erro de rede', variant: 'danger' }); }
    finally { setGeneratingReport(false); }
  };

  const handleDeleteSessao = (id: string) => {
    setModal({
      open: true, variant: 'danger',
      title: 'Excluir sessão',
      message: 'Tem certeza que deseja excluir esta sessão? A transcrição será perdida permanentemente.',
      onConfirm: async () => {
        setModal(m => ({ ...m, open: false }));
        try {
          const res = await fetch('/api/sessoes/excluir', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessao_id: id }),
          });
          if (res.ok) {
            if (selectedSessao?.id === id) setSelectedSessao(null);
            setToast({ open: true, message: 'Sessão excluída.', variant: 'success' });
            fetchSessoes();
          }
        } catch { /* silent */ }
      },
    });
  };

  const handleSaveBlockEdit = async (blockId: number) => {
    if (!selectedSessao?.transcricao?.segments) return;
    const updated = selectedSessao.transcricao.segments.map(b =>
      b.id === blockId ? { ...b, text: editText } : b
    );
    const newTranscricao = { ...selectedSessao.transcricao, segments: updated };
    setSelectedSessao({ ...selectedSessao, transcricao: newTranscricao });
    setEditingBlockId(null);

    // Persistir no banco
    const supabase = createClient();
    await supabase.from('sessoes_transcritas').update({
      transcricao: newTranscricao, updated_at: new Date().toISOString(),
    }).eq('id', selectedSessao.id);
  };

  const handleYtManualTranscribe = async () => {
    const url = ytManualUrl.trim();
    if (!url || !url.includes('youtu')) { setToast({ open: true, message: 'Cole uma URL válida do YouTube.', variant: 'warning' }); return; }
    setYtManualUrl('');
    handleYtTranscribe({ id: 'manual', title: 'Sessão YouTube', url });
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      concluida: { bg: '#dcfce7', color: '#15803d', label: 'Concluída' },
      transcrevendo: { bg: '#fef3c7', color: '#92400e', label: 'Transcrevendo...' },
      processando: { bg: '#e0f2fe', color: '#0369a1', label: 'Processando...' },
      erro: { bg: '#fee2e2', color: '#b91c1c', label: 'Erro' },
    };
    const s = map[status] || map.processando;
    return <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>{s.label}</span>;
  };

  return (
    <>
      <Topbar title="Transcrição de Sessões" subtitle="Transcrição automática de sessões plenárias com diarização de interlocutores" />

      <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header com ações */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1f2937', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileAudio size={22} color="#1c4076" /> Sessões Transcritas
            </h2>
            <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '0.85rem' }}>
              {sessoes.length} sessão(ões) registrada(s)
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => fetchSessoes()} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <RefreshCw size={14} /> Atualizar
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,.ogg,.flac,.m4a,.webm,.mp4,.aac,.wma"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                background: '#1c4076', color: 'white', border: 'none', borderRadius: '8px',
                padding: '10px 20px', cursor: uploading ? 'wait' : 'pointer', fontWeight: 600,
                fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px',
                opacity: uploading ? 0.7 : 1,
              }}
            >
              {uploading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={16} />}
              {uploading ? 'Processando...' : 'Upload de Áudio'}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {uploadProgress && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.85rem', color: '#1c4076', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {uploading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {uploadProgress}
          </div>
        )}

        {/* Tabs: Sessões | YouTube */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {[
            { id: 'sessoes' as const, label: 'Minhas Transcrições', icon: <FileAudio size={14} /> },
            { id: 'youtube' as const, label: 'YouTube CMBV', icon: <Play size={14} /> },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '8px 16px', borderRadius: '999px', border: 'none', cursor: 'pointer',
              background: activeTab === tab.id ? '#1c4076' : '#f3f4f6',
              color: activeTab === tab.id ? 'white' : '#6b7280',
              fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* YouTube video grid */}
        {activeTab === 'youtube' && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', background: '#fff', padding: '20px' }}>

            {/* Vídeos públicos — download direto via yt-dlp sem autenticação */}

            {/* Campo URL manual + título */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #d1d5db', borderRadius: '8px', padding: '8px 12px', background: '#fff' }}>
                <Link2 size={16} color="#9ca3af" />
                <input
                  type="text" placeholder="Cole aqui o link de qualquer vídeo do YouTube..."
                  value={ytManualUrl} onChange={e => setYtManualUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleYtManualTranscribe()}
                  style={{ border: 'none', outline: 'none', flex: 1, fontSize: '0.85rem', color: '#374151' }}
                />
              </div>
              <button onClick={handleYtManualTranscribe} disabled={!ytManualUrl.trim() || uploading}
                style={{ background: '#1c4076', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: (!ytManualUrl.trim() || uploading) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '5px', opacity: (!ytManualUrl.trim() || uploading) ? 0.5 : 1 }}>
                <Mic size={14} /> Transcrever URL
              </button>
            </div>

            {/* Header da listagem */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1f2937' }}>
                Sessões Plenárias — Canal @camaraboavista
              </h3>
              <button onClick={fetchYtVideos} disabled={ytLoading} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.78rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {ytLoading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />} Atualizar
              </button>
            </div>

            {/* Grid de vídeos */}
            {ytLoading && ytVideos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: '#9ca3af' }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
                Carregando vídeos do YouTube...
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
                {ytVideos.map(v => (
                  <div key={v.id} style={{
                    border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden', background: '#fafafa',
                    transition: 'box-shadow 0.2s', cursor: 'default',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    <div style={{ position: 'relative' }}>
                      <img src={v.thumbnail} alt={v.title} style={{ width: '100%', height: '170px', objectFit: 'cover' }} />
                      <span style={{
                        position: 'absolute', bottom: '6px', right: '6px',
                        background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '2px 6px',
                        borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, fontFamily: 'monospace',
                      }}>
                        {v.duration_fmt}
                      </span>
                    </div>
                    <div style={{ padding: '10px 12px' }}>
                      <p style={{ margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 600, color: '#1f2937', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {v.title}
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                          {v.upload_date && new Date(v.upload_date + 'T12:00').toLocaleDateString('pt-BR')}
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <a href={v.url} target="_blank" rel="noopener noreferrer"
                            style={{ background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: '6px', padding: '5px 10px', fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}>
                            <Play size={10} /> Assistir
                          </a>
                          <button
                            onClick={() => handleYtTranscribe({ id: v.id, title: v.title, url: v.url })}
                            disabled={uploading || ytTranscribing === v.id}
                            style={{
                              background: ytTranscribing === v.id ? '#6b7280' : '#1c4076',
                              color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px',
                              fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px',
                              cursor: uploading ? 'not-allowed' : 'pointer',
                            }}>
                            {ytTranscribing === v.id
                              ? <><Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> Transcrevendo...</>
                              : <><Mic size={10} /> Transcrever</>
                            }
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!ytLoading && ytVideos.length === 0 && (
              <p style={{ color: '#9ca3af', textAlign: 'center', padding: '24px' }}>Nenhum vídeo encontrado. Clique &quot;Atualizar&quot; para carregar.</p>
            )}
          </div>
        )}

        {/* Layout: lista + detalhe (só na aba Sessões) */}
        {activeTab === 'sessoes' && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedSessao ? '320px 1fr' : '1fr', gap: '16px' }}>

          {/* Lista de sessões */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
            {loading ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
                Carregando sessões...
              </div>
            ) : sessoes.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af' }}>
                <Mic size={36} style={{ margin: '0 auto 12px', color: '#d1d5db' }} />
                <p style={{ fontWeight: 600, color: '#6b7280' }}>Nenhuma sessão transcrita</p>
                <p style={{ fontSize: '0.8rem' }}>Faça upload de um áudio de sessão plenária para começar.</p>
              </div>
            ) : (
              <div style={{ maxHeight: '700px', overflowY: 'auto' }}>
                {sessoes.map(s => (
                  <button
                    key={s.id}
                    onClick={() => loadSessaoDetail(s.id)}
                    style={{
                      display: 'block', width: '100%', padding: '14px 16px', border: 'none',
                      borderBottom: '1px solid #f3f4f6', cursor: 'pointer', textAlign: 'left',
                      background: selectedSessao?.id === s.id ? '#eff6ff' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1f2937', flex: 1 }}>{s.titulo}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {statusBadge(s.status)}
                        {(s.status === 'erro' || s.status === 'processando') && (
                          <span onClick={(e) => { e.stopPropagation(); handleDeleteSessao(s.id); }} style={{ cursor: 'pointer', color: '#dc2626', padding: '2px' }} title="Excluir">
                            <Trash2 size={13} />
                          </span>
                        )}
                      </div>
                    </div>
                    {s.status === 'processando' || s.status === 'transcrevendo' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#1c4076' }}>
                        <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                        {s.status === 'transcrevendo' ? 'Transcrevendo áudio com Groq Whisper...' : 'Processando download do áudio...'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: '#9ca3af' }}>
                        {s.data_sessao && <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><Calendar size={11} /> {new Date(s.data_sessao + 'T12:00').toLocaleDateString('pt-BR')}</span>}
                        {s.duracao_segundos && <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><Clock size={11} /> {formatDuration(s.duracao_segundos)}</span>}
                        {s.status === 'erro' && s.error_msg && <span style={{ color: '#dc2626', fontSize: '0.68rem' }} title={s.error_msg}>Falha</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Painel de detalhe */}
          {selectedSessao && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', background: '#fff', overflow: 'hidden' }}>
              {loadingDetail ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>
                  <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
                  Carregando transcrição...
                </div>
              ) : (
                <>
                  {/* Header da sessão */}
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', background: '#fafafa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: '#1f2937' }}>{selectedSessao.titulo}</h3>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: '#6b7280' }}>
                          {selectedSessao.data_sessao && <span><Calendar size={12} /> {new Date(selectedSessao.data_sessao + 'T12:00').toLocaleDateString('pt-BR')}</span>}
                          <span><Clock size={12} /> {formatDuration(selectedSessao.duracao_segundos)}</span>
                          <span><Users size={12} /> {selectedSessao.transcricao?.segments?.length || 0} blocos</span>
                        </div>
                      </div>
                      <button
                        onClick={handleGenerateReport}
                        disabled={generatingReport}
                        style={{ background: '#059669', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '5px', opacity: generatingReport ? 0.7 : 1 }}
                      >
                        {generatingReport ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FileAudio size={13} />}
                        {generatingReport ? 'Gerando...' : 'Gerar Relatório'}
                      </button>
                    </div>
                    {/* Tabs: Transcrição | Relatório */}
                    <div style={{ display: 'flex', gap: '4px', marginTop: '12px' }}>
                      {(['transcricao', 'relatorio'] as const).map(t => (
                        <button key={t} onClick={() => setDetailView(t)} style={{
                          padding: '6px 14px', borderRadius: '6px 6px 0 0', border: 'none', cursor: 'pointer',
                          background: detailView === t ? '#fff' : 'transparent',
                          color: detailView === t ? '#1f2937' : '#9ca3af',
                          fontWeight: detailView === t ? 700 : 500, fontSize: '0.8rem',
                          borderBottom: detailView === t ? '2px solid #1c4076' : '2px solid transparent',
                        }}>
                          {t === 'transcricao' ? 'Transcrição' : 'Relatório'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Conteúdo: Transcrição ou Relatório */}
                  {detailView === 'transcricao' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', maxHeight: '600px' }}>
                      <div style={{ overflowY: 'auto', padding: '16px 20px' }}>
                        {selectedSessao.transcricao?.segments?.map((block) => (
                          <div key={block.id} style={{ marginBottom: '12px', paddingLeft: '12px', borderLeft: `3px solid ${block.speakerColor || '#d1d5db'}` }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: block.speakerColor || '#6b7280', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {block.speaker} — {formatTime(block.start)}
                              {editingBlockId !== block.id && (
                                <span onClick={() => { setEditingBlockId(block.id); setEditText(block.text); }} style={{ cursor: 'pointer', opacity: 0.4 }} title="Editar texto"><Pencil size={10} /></span>
                              )}
                            </div>
                            {editingBlockId === block.id ? (
                              <div>
                                <textarea value={editText} onChange={e => setEditText(e.target.value)}
                                  style={{ width: '100%', minHeight: '60px', fontSize: '0.88rem', border: '1px solid #1c4076', borderRadius: '6px', padding: '8px', lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical' }} autoFocus />
                                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                  <button onClick={() => handleSaveBlockEdit(block.id)} style={{ background: '#1c4076', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 12px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>Salvar</button>
                                  <button onClick={() => setEditingBlockId(null)} style={{ background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: '4px', padding: '4px 12px', fontSize: '0.72rem', cursor: 'pointer' }}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.88rem', color: block.isUnclear ? '#dc2626' : '#374151', lineHeight: 1.6, fontStyle: block.isUnclear ? 'italic' : 'normal', cursor: 'pointer' }}
                                onClick={() => { setEditingBlockId(block.id); setEditText(block.text); }} title="Clique para editar">
                                {block.isUnclear ? <span style={{ color: '#dc2626' }}>(trecho inaudível)</span> : block.text}
                              </div>
                            )}
                          </div>
                        ))}
                        {(!selectedSessao.transcricao?.segments || selectedSessao.transcricao.segments.length === 0) && (
                          <p style={{ color: '#9ca3af', textAlign: 'center', padding: '24px' }}>Transcrição não disponível.</p>
                        )}
                      </div>
                      <div style={{ borderLeft: '1px solid #e5e7eb', overflowY: 'auto', padding: '12px', background: '#fafafa' }}>
                        <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Pontos-Chave</p>
                        {selectedSessao.pontos_chave?.map(kp => (
                          <div key={kp.id} style={{ marginBottom: '10px', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb', fontSize: '0.78rem' }}>
                            <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: '2px' }}>{kp.title}</div>
                            <div style={{ color: '#6b7280', fontSize: '0.72rem' }}>{formatTime(kp.start)}</div>
                          </div>
                        ))}
                        {(!selectedSessao.pontos_chave || selectedSessao.pontos_chave.length === 0) && (
                          <p style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Nenhum ponto-chave.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ overflowY: 'auto', padding: '20px 24px', maxHeight: '600px' }}>
                      {relatorio || selectedSessao.relatorio ? (
                        <div style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif' }}>
                          {(relatorio || selectedSessao.relatorio || '').split('\n').map((line, i) => {
                            if (line.startsWith('### ')) return <h4 key={i} style={{ fontSize: '1rem', fontWeight: 700, color: '#1f2937', margin: '20px 0 8px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px' }}>{line.replace('### ', '')}</h4>;
                            if (line.startsWith('**') && line.endsWith('**')) return <p key={i} style={{ fontWeight: 700, margin: '4px 0' }}>{line.replace(/\*\*/g, '')}</p>;
                            if (line.includes('(trecho inaudível)')) return <p key={i} style={{ margin: '4px 0' }}>{line.replace(/\(trecho inaudível\)/g, '')}<span style={{ color: '#dc2626', fontStyle: 'italic' }}>(trecho inaudível)</span></p>;
                            if (line.startsWith('---')) return <hr key={i} style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />;
                            if (line.startsWith('- ')) return <p key={i} style={{ margin: '2px 0 2px 16px' }}>{line}</p>;
                            return <p key={i} style={{ margin: '4px 0' }}>{line}</p>;
                          })}
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '48px', color: '#9ca3af' }}>
                          <MessageSquare size={36} style={{ margin: '0 auto 12px', color: '#d1d5db' }} />
                          <p style={{ fontWeight: 600, color: '#6b7280' }}>Nenhum relatório gerado</p>
                          <p style={{ fontSize: '0.8rem' }}>Clique em "Gerar Relatório" para criar um resumo estruturado da sessão.</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      <ConfirmModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        variant={modal.variant}
        confirmLabel="Sim, excluir"
        cancelLabel="Cancelar"
        onConfirm={modal.onConfirm}
        onCancel={() => setModal(m => ({ ...m, open: false }))}
      />
      <Toast
        open={toast.open}
        message={toast.message}
        variant={toast.variant}
        onClose={() => setToast(t => ({ ...t, open: false }))}
      />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
