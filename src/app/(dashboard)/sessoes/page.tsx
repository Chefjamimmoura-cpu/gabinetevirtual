'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Topbar from '@/components/topbar';
import ConfirmModal, { Toast } from '@/components/ui/confirm-modal';
import { createClient } from '@/lib/supabase/client';
import {
  Mic, Upload, FileAudio, Clock, Loader2,
  Play, ChevronRight, ChevronLeft, Calendar, Users, MessageSquare,
  RefreshCw, Search, Trash2, Link2, Pencil, Download,
  Bookmark, BookmarkCheck, X, Sparkles, Undo2, Redo2
} from 'lucide-react';
import { splitBlock, mergeWithPrevious, renameLocutor, mergeLocutors, type SpeakerBlock as EditBlock } from '@/lib/sessoes/block-edit';
import { AudioPlayer } from '@/components/sessoes/audio-player';
import { SpeakerPicker, type SpeakerOption } from '@/components/sessoes/speaker-picker';

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

interface TranscriptWord {
  word: string;
  start: number;
  end: number;
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
  words?: TranscriptWord[];
}

interface KeyPoint {
  id: string;
  start: number;
  title: string;
  description: string;
  reasons: string[];
  /** true = marcado manualmente pelo usuário; false/undefined = sugerido pela heurística */
  manual?: boolean;
}

interface SessaoDetalhe extends Sessao {
  transcricao: { text: string; segments: SpeakerBlock[]; words: unknown[] } | null;
  pontos_chave: KeyPoint[] | null;
  relatorio: string | null;
  audio_url: string | null;
  audio_storage_path?: string | null;
  audio_expira_em?: string | null;
}

interface SessaoProgresso {
  id: string;
  titulo: string;
  status: string;
  progresso_pct: number;
  progresso_etapa: string;
  error_msg: string | null;
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
  const [ytManualUrl, setYtManualUrl] = useState('');
  const [modal, setModal] = useState<{ open: boolean; title: string; message: string; variant: 'danger' | 'success' | 'info' | 'warning'; onConfirm: () => void }>({ open: false, title: '', message: '', variant: 'info', onConfirm: () => {} });
  type ToastAction = { label: string; onClick: () => void };
  const [toast, setToast] = useState<{ open: boolean; message: string; variant: 'danger' | 'success' | 'info' | 'warning'; action?: ToastAction }>({ open: false, message: '', variant: 'info' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progressos, setProgressos] = useState<SessaoProgresso[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressosRef = useRef<SessaoProgresso[]>([]);

  // Estado de conclusão: cards de sucesso (vivem por ~6s), badge de não-vistos, item destacado
  type SuccessCard = { id: string; titulo: string; completedAt: number };
  const [successCards, setSuccessCards] = useState<SuccessCard[]>([]);
  const [unviewedCompletions, setUnviewedCompletions] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const activeTabRef = useRef<'sessoes' | 'youtube'>('sessoes');

  // Speaker picker: popover ancorado para atribuir/renomear locutor.
  // editOnOpen=true abre já em modo edição do currentSpeakerId (usado pela canetinha ✏).
  const [speakerPicker, setSpeakerPicker] = useState<{
    open: boolean;
    anchorRect: DOMRect | null;
    currentSpeakerId: string;
    editOnOpen: boolean;
  }>({ open: false, anchorRect: null, currentSpeakerId: '', editOnOpen: false });

  // Atalhos da transcrição: painel retrátil (fechado por padrão pra não roubar espaço)
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Sidebar retrátil (Opção A): toggle total. Persiste em localStorage
  // e tem atalho Ctrl/Cmd+B. Quando recolhida, grid muda pra 0px 1fr
  // e aparece um botão flutuante na borda esquerda do painel pra reabrir.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sessoes.sidebarCollapsed') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('sessoes.sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Sync player ↔ transcrição
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const lastScrolledBlockRef = useRef<number>(-1);

  // ── Pontos-chave: marcação manual + atalho M ──
  // M: toggle marca/desmarca no bloco que está tocando agora.
  // Ctrl+M: força desmarcar (idempotente).
  // Click no ícone bookmark do bloco: também alterna.
  // Click no card: pula áudio + scrolla a transcrição.
  const currentAudioTimeRef = useRef(0);
  useEffect(() => { currentAudioTimeRef.current = currentAudioTime; }, [currentAudioTime]);

  // ── Busca na transcrição (Ctrl+F) ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCurrentIdx, setSearchCurrentIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceValue, setReplaceValue] = useState('');
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // ── Undo/Redo de edições nos blocos ──
  const MAX_UNDO = 30;
  const [undoStack, setUndoStack] = useState<SpeakerBlock[][]>([]);
  const [redoStack, setRedoStack] = useState<SpeakerBlock[][]>([]);

  const pushUndo = () => {
    if (!selectedSessao?.transcricao?.segments) return;
    const snapshot = JSON.parse(JSON.stringify(selectedSessao.transcricao.segments)) as SpeakerBlock[];
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO - 1)), snapshot]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0 || !selectedSessao?.transcricao) return;
    const prev = undoStack[undoStack.length - 1];
    const currentSnapshot = JSON.parse(JSON.stringify(selectedSessao.transcricao.segments)) as SpeakerBlock[];
    setRedoStack(s => [...s, currentSnapshot]);
    setUndoStack(s => s.slice(0, -1));
    const novaTranscricao = { ...selectedSessao.transcricao, segments: prev };
    setSelectedSessao({ ...selectedSessao, transcricao: novaTranscricao });
    persistSegments(prev);
    setToast({ open: true, message: `Desfeito (${undoStack.length - 1} restantes)`, variant: 'success' });
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !selectedSessao?.transcricao) return;
    const next = redoStack[redoStack.length - 1];
    const currentSnapshot = JSON.parse(JSON.stringify(selectedSessao.transcricao.segments)) as SpeakerBlock[];
    setUndoStack(s => [...s, currentSnapshot]);
    setRedoStack(s => s.slice(0, -1));
    const novaTranscricao = { ...selectedSessao.transcricao, segments: next };
    setSelectedSessao({ ...selectedSessao, transcricao: novaTranscricao });
    persistSegments(next);
    setToast({ open: true, message: `Refeito (${redoStack.length - 1} restantes)`, variant: 'success' });
  };

  // Atalhos Ctrl+Z (undo) e Ctrl+Y ou Ctrl+Shift+Z (redo)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack, redoStack, selectedSessao]);

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim() || !selectedSessao?.transcricao?.segments) return [];
    const q = searchQuery.toLowerCase();
    const matches: { blockIdx: number; charStart: number }[] = [];
    selectedSessao.transcricao.segments.forEach((block, blockIdx) => {
      const textLower = block.text.toLowerCase();
      let pos = 0;
      while ((pos = textLower.indexOf(q, pos)) !== -1) {
        matches.push({ blockIdx, charStart: pos });
        pos += q.length;
      }
    });
    return matches;
  }, [searchQuery, selectedSessao?.transcricao?.segments]);

  const goToSearchMatch = (idx: number) => {
    if (searchMatches.length === 0) return;
    const safe = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setSearchCurrentIdx(safe);
    const match = searchMatches[safe];
    setTimeout(() => {
      const el = document.getElementById(`block-${match.blockIdx}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  };

  // Ctrl+F (busca) e Ctrl+H (substituição) interceptam atalhos nativos do browser
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (!selectedSessao?.transcricao?.segments) return;

      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(v => {
          if (!v) setTimeout(() => searchInputRef.current?.focus(), 50);
          return !v;
        });
      } else if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setSearchOpen(true);
        setReplaceMode(true);
        setTimeout(() => {
          if (!searchQuery) searchInputRef.current?.focus();
          else replaceInputRef.current?.focus();
        }, 50);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedSessao, searchQuery]);

  // Escapa regex pra busca literal
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Substituir UMA ocorrência (a atual) ou TODAS
  const handleReplaceCurrent = () => {
    if (!searchQuery.trim() || !selectedSessao?.transcricao?.segments || searchMatches.length === 0) return;
    pushUndo();
    const match = searchMatches[searchCurrentIdx];
    const block = selectedSessao.transcricao.segments[match.blockIdx];
    const before = block.text.substring(0, match.charStart);
    const after = block.text.substring(match.charStart + searchQuery.length);
    const newText = before + replaceValue + after;
    const updated = selectedSessao.transcricao.segments.map((b, idx) =>
      idx === match.blockIdx ? { ...b, text: newText, words: reTokenizeWords(newText, b.start, b.end) } : b
    );
    const novaTranscricao = { ...selectedSessao.transcricao, segments: updated };
    setSelectedSessao({ ...selectedSessao, transcricao: novaTranscricao });
    persistSegments(updated);
    setToast({ open: true, message: `Substituído 1 ocorrência.`, variant: 'success' });
    // Ajusta índice se necessário
    if (searchCurrentIdx >= searchMatches.length - 1) setSearchCurrentIdx(Math.max(0, searchCurrentIdx - 1));
  };

  const handleReplaceAll = () => {
    if (!searchQuery.trim() || !selectedSessao?.transcricao?.segments || searchMatches.length === 0) return;
    pushUndo();
    const regex = new RegExp(escapeRegex(searchQuery), 'gi');
    const count = searchMatches.length;
    const updated = selectedSessao.transcricao.segments.map(b => {
      if (!b.text.toLowerCase().includes(searchQuery.toLowerCase())) return b;
      const newText = b.text.replace(regex, replaceValue);
      return { ...b, text: newText, words: reTokenizeWords(newText, b.start, b.end) };
    });
    const novaTranscricao = { ...selectedSessao.transcricao, segments: updated };
    setSelectedSessao({ ...selectedSessao, transcricao: novaTranscricao });
    persistSegments(updated);
    setSearchCurrentIdx(0);
    setToast({ open: true, message: `Substituídas ${count} ocorrências.`, variant: 'success' });
  };

  // Highlight de texto puro (pra blocos sem words[])
  const highlightSearchInText = (text: string): React.ReactNode => {
    if (!searchQuery.trim()) return text;
    const parts = text.split(new RegExp(`(${escapeRegex(searchQuery)})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase()
        ? <mark key={i} style={{ background: '#fef08a', padding: 0, borderRadius: 2 }}>{part}</mark>
        : part
    );
  };

  // Auto-scroll: trazer o bloco atual para a viewport quando o áudio avança
  useEffect(() => {
    if (!selectedSessao?.transcricao?.segments) return;
    const segments = selectedSessao.transcricao.segments;
    const idx = segments.findIndex(b => currentAudioTime >= b.start && currentAudioTime < b.end);
    if (idx < 0 || idx === lastScrolledBlockRef.current) return;
    lastScrolledBlockRef.current = idx;
    const el = document.getElementById(`block-${idx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentAudioTime, selectedSessao?.transcricao?.segments]);

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

  // ── Polling de progresso para sessões ativas ──
  const fetchProgresso = useCallback(async () => {
    try {
      const res = await fetch('/api/sessoes/progresso');
      if (!res.ok) return;
      const data = await res.json();
      const novas: SessaoProgresso[] = data.sessoes || [];

      // Detectar sessões que terminaram (só sucesso: sessões com status 'erro' permanecem no array)
      const idsAtivos = new Set(novas.map(s => s.id));
      const prev = progressosRef.current;
      const concluidas = prev.filter(p => !idsAtivos.has(p.id) && p.status !== 'erro');

      if (concluidas.length > 0) {
        const now = Date.now();

        // 1) Empurrar como cards de sucesso (vivem 6s antes do fade-out)
        setSuccessCards(cards => {
          const novos = concluidas.map(p => ({ id: p.id, titulo: p.titulo || 'Sessão', completedAt: now }));
          return [...cards, ...novos];
        });
        concluidas.forEach(p => {
          setTimeout(() => {
            setSuccessCards(cards => cards.filter(c => c.id !== p.id));
          }, 6000);
        });

        // 2) Badge em "Minhas Transcrições" se o usuário não está lá
        if (activeTabRef.current !== 'sessoes') {
          setUnviewedCompletions(s => {
            const next = new Set(s);
            concluidas.forEach(p => next.add(p.id));
            return next;
          });
        }

        // 3) Toast com ação "Ver agora" (usa a mais recente como destaque)
        const destaque = concluidas[concluidas.length - 1];
        const tituloCurto = (destaque.titulo || 'Sessão').length > 50
          ? (destaque.titulo || 'Sessão').substring(0, 50) + '…'
          : (destaque.titulo || 'Sessão');
        const extras = concluidas.length - 1;
        const msg = extras > 0
          ? `"${tituloCurto}" transcrita (+${extras} outra${extras > 1 ? 's' : ''})`
          : `"${tituloCurto}" transcrita com sucesso`;
        setToast({
          open: true,
          message: msg,
          variant: 'success',
          action: {
            label: 'Ver agora',
            onClick: () => {
              setActiveTab('sessoes');
              setUnviewedCompletions(new Set());
              setHighlightedId(destaque.id);
              setTimeout(() => setHighlightedId(null), 3200);
              loadSessaoDetail(destaque.id);
            },
          },
        });

        fetchSessoes();
      }

      setProgressos(novas);
      progressosRef.current = novas;

      // Parar polling se não há mais sessões ativas
      if (novas.length === 0 && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    } catch { /* silent */ }
  }, [fetchSessoes]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    fetchProgresso();
    pollingRef.current = setInterval(fetchProgresso, 5000);
  }, [fetchProgresso]);

  // Ao montar: verificar sessões ativas
  useEffect(() => {
    fetchProgresso().then(() => {
      if (progressosRef.current.length > 0) {
        startPolling();
      }
    });
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

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
    try {
      const res = await fetch('/api/sessoes/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: video.url, titulo: video.title, gabinete_id: gabineteId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setToast({ open: true, message: 'Transcrição iniciada! Você pode navegar livremente.', variant: 'success' });
        startPolling();
        fetchSessoes();
      } else {
        setToast({ open: true, message: `Erro: ${data.error || 'Falha ao iniciar transcrição'}`, variant: 'danger' });
      }
    } catch {
      setToast({ open: true, message: 'Erro de rede.', variant: 'danger' });
    } finally {
      setYtTranscribing(null);
    }
  };

  useEffect(() => { if (activeTab === 'youtube' && ytVideos.length === 0) fetchYtVideos(); }, [activeTab, ytVideos.length, fetchYtVideos]);

  // Mantém ref atualizada com activeTab para uso em callbacks (fetchProgresso)
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Default inteligente: após carregar, se não houver nenhuma sessão, leva o usuário para YouTube
  const didAutoSwitchRef = useRef(false);
  useEffect(() => {
    if (!loading && !didAutoSwitchRef.current && sessoes.length === 0 && activeTab === 'sessoes') {
      didAutoSwitchRef.current = true;
      setActiveTab('youtube');
    }
  }, [loading, sessoes.length, activeTab]);

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

  // Re-tokeniza texto editado distribuindo timestamps proporcionalmente.
  // Os timestamps não serão 100% exatos (o texto mudou), mas CTRL+Click
  // e highlight por palavra continuam funcionando com precisão aceitável.
  const reTokenizeWords = (text: string, start: number, end: number): TranscriptWord[] => {
    const tokens = text.split(/\s+/).filter(w => w.length > 0);
    if (tokens.length === 0) return [];
    const totalChars = tokens.reduce((s, w) => s + w.length, 0);
    const duration = end - start;
    let offset = start;
    return tokens.map(word => {
      const ratio = word.length / totalChars;
      const wordDuration = duration * ratio;
      const w: TranscriptWord = { word, start: offset, end: offset + wordDuration };
      offset += wordDuration;
      return w;
    });
  };

  const handleSaveBlockEdit = async (blockId: number, newText: string) => {
    if (!selectedSessao?.transcricao?.segments) return;
    const trimmed = newText.replace(/\s+/g, ' ').trim();
    const original = selectedSessao.transcricao.segments.find(b => b.id === blockId);
    setEditingBlockId(null);
    if (!original || trimmed === (original.text || '').trim()) return;

    // Re-tokeniza em vez de limpar words[]: mantém CTRL+Click split e
    // highlight por palavra funcionando mesmo após edição.
    pushUndo();
    const updated = selectedSessao.transcricao.segments.map(b =>
      b.id === blockId ? { ...b, text: trimmed, words: reTokenizeWords(trimmed, b.start, b.end) } : b
    );
    const newTranscricao = { ...selectedSessao.transcricao, segments: updated };
    setSelectedSessao({ ...selectedSessao, transcricao: newTranscricao });
    await persistSegments(updated);
  };

  // ── Persistir edições estruturais dos blocos (split/merge/rename) ──
  const persistSegments = async (segments: SpeakerBlock[]) => {
    if (!selectedSessao) return;
    try {
      await fetch('/api/sessoes/editar-blocos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessao_id: selectedSessao.id, segments }),
      });
    } catch {
      setToast({ open: true, message: 'Erro ao salvar edição.', variant: 'danger' });
    }
  };

  // CTRL+Click em uma palavra: divide o bloco e cria novo locutor no pedaço seguinte
  const handleSplitBlock = (blockIdx: number, wordIdx: number) => {
    if (!selectedSessao?.transcricao?.segments) return;
    pushUndo();
    const segmentsAtuais = selectedSessao.transcricao.segments as unknown as EditBlock[];
    const block = segmentsAtuais[blockIdx];
    if (!block?.words || block.words.length === 0) {
      setToast({ open: true, message: 'Este bloco não tem marcação de palavras — re-transcreva para habilitar divisão.', variant: 'warning' });
      return;
    }
    const novos = splitBlock(segmentsAtuais, blockIdx, wordIdx) as unknown as SpeakerBlock[];
    if (novos === (segmentsAtuais as unknown as SpeakerBlock[])) {
      setToast({ open: true, message: 'Não foi possível dividir nesta palavra.', variant: 'warning' });
      return;
    }
    const novaTranscricao = { ...selectedSessao.transcricao, segments: novos };
    setSelectedSessao({ ...selectedSessao, transcricao: novaTranscricao });
    persistSegments(novos);
    setToast({
      open: true,
      message: wordIdx === 0 ? 'Bloco inteiro atribuído a um novo locutor.' : 'Bloco dividido em novo locutor.',
      variant: 'success',
    });
  };

  // ALT+Click em um bloco: junta com o bloco anterior
  const handleMergeBlock = (blockIdx: number) => {
    if (!selectedSessao?.transcricao?.segments) return;
    pushUndo();
    if (blockIdx === 0) {
      setToast({ open: true, message: 'Primeiro bloco não pode ser juntado ao anterior.', variant: 'warning' });
      return;
    }
    const novos = mergeWithPrevious(
      selectedSessao.transcricao.segments as unknown as EditBlock[],
      blockIdx,
    ) as unknown as SpeakerBlock[];
    const novaTranscricao = { ...selectedSessao.transcricao, segments: novos };
    setSelectedSessao({ ...selectedSessao, transcricao: novaTranscricao });
    persistSegments(novos);
  };

  // Abre o SpeakerPicker ancorado em um elemento. Se editOnOpen=true, entra
  // direto em modo de edição do nome do locutor (usado pela canetinha ✏).
  const openSpeakerPicker = (speakerId: string, element: HTMLElement, editOnOpen = false) => {
    setSpeakerPicker({
      open: true,
      anchorRect: element.getBoundingClientRect(),
      currentSpeakerId: speakerId,
      editOnOpen,
    });
  };

  // Seleciona um locutor existente → mescla todos os blocos do atual no alvo
  const handleSpeakerSelect = (targetSpeakerId: string) => {
    if (!selectedSessao?.transcricao?.segments) return;
    pushUndo();
    const novos = mergeLocutors(
      selectedSessao.transcricao.segments as unknown as EditBlock[],
      speakerPicker.currentSpeakerId,
      targetSpeakerId,
    ) as unknown as SpeakerBlock[];
    const targetName = novos.find(b => b.speakerId === targetSpeakerId)?.speaker || 'locutor';
    const novaTranscricao = { ...selectedSessao.transcricao, segments: novos };
    setSelectedSessao({ ...selectedSessao, transcricao: novaTranscricao });
    persistSegments(novos);
    setSpeakerPicker({ open: false, anchorRect: null, currentSpeakerId: '', editOnOpen: false });
    setToast({ open: true, message: `Blocos atribuídos a ${targetName}.`, variant: 'success' });
  };

  // Renomeia um locutor específico (aplica em todos os blocos daquele speakerId).
  // Picker permanece aberto pra permitir edições em série.
  const handleSpeakerRenameItem = (speakerId: string, novoNome: string) => {
    if (!selectedSessao?.transcricao?.segments) return;
    pushUndo();
    const novos = renameLocutor(
      selectedSessao.transcricao.segments as unknown as EditBlock[],
      speakerId,
      novoNome,
    ) as unknown as SpeakerBlock[];
    const novaTranscricao = { ...selectedSessao.transcricao, segments: novos };
    setSelectedSessao({ ...selectedSessao, transcricao: novaTranscricao });
    persistSegments(novos);
    setToast({ open: true, message: `Renomeado para "${novoNome}".`, variant: 'success' });
  };

  // ── Pontos-chave: persistência + handlers ──
  const persistPontosChave = async (sessaoId: string, pontos: KeyPoint[]) => {
    try {
      const res = await fetch('/api/sessoes/editar-pontos-chave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessao_id: sessaoId, pontos_chave: pontos }),
      });
      if (!res.ok) throw new Error('falha');
    } catch {
      setToast({ open: true, message: 'Erro ao salvar pontos-chave', variant: 'danger' });
    }
  };

  const makeKeyPointTitle = (text: string): string => {
    const clean = text.replace(/###/g, '').trim();
    const firstSentence = clean.split(/[.!?]/)[0]?.trim() || clean;
    if (firstSentence.length <= 60) return firstSentence;
    return firstSentence.substring(0, 57) + '…';
  };

  const handleAddPontoChaveFromBlock = (block: SpeakerBlock) => {
    if (!selectedSessao) return;
    const novo: KeyPoint = {
      id: `kp-manual-${block.start.toFixed(2)}-${Date.now()}`,
      start: block.start,
      title: makeKeyPointTitle(block.text),
      description: block.text.substring(0, 200),
      reasons: ['marcado manualmente'],
      manual: true,
    };
    const novos = [...(selectedSessao.pontos_chave || []), novo].sort((a, b) => a.start - b.start);
    setSelectedSessao({ ...selectedSessao, pontos_chave: novos });
    persistPontosChave(selectedSessao.id, novos);
    setToast({ open: true, message: `Marcado: ${formatTime(block.start)}`, variant: 'success' });
  };

  const handleRemovePontoChave = (kpId: string) => {
    if (!selectedSessao) return;
    const novos = (selectedSessao.pontos_chave || []).filter(kp => kp.id !== kpId);
    setSelectedSessao({ ...selectedSessao, pontos_chave: novos });
    persistPontosChave(selectedSessao.id, novos);
  };

  const handleTogglePontoChaveDoBloco = (block: SpeakerBlock) => {
    if (!selectedSessao) return;
    const existing = selectedSessao.pontos_chave?.find(kp => Math.abs(kp.start - block.start) < 0.05);
    if (existing) handleRemovePontoChave(existing.id);
    else handleAddPontoChaveFromBlock(block);
  };

  const blockHasPontoChave = (block: SpeakerBlock): boolean => {
    return !!selectedSessao?.pontos_chave?.some(kp => Math.abs(kp.start - block.start) < 0.05);
  };

  const handleSeekToPontoChave = (kp: KeyPoint) => {
    setSeekTo(kp.start);
    if (!selectedSessao?.transcricao?.segments) return;
    const blockIdx = selectedSessao.transcricao.segments.findIndex(b =>
      kp.start >= b.start - 0.05 && kp.start < b.end + 0.05
    );
    if (blockIdx >= 0) {
      // Aguarda o seek aplicar e o bloco renderizar antes de scrollar
      setTimeout(() => {
        const el = document.getElementById(`block-${blockIdx}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    }
  };

  // Atalho M (toggle) e Ctrl+M (forçar desmarcar) — opera no bloco
  // que está sendo tocado AGORA. Re-binda quando troca a sessão (raro).
  useEffect(() => {
    if (!selectedSessao?.transcricao?.segments) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key.toLowerCase() !== 'm') return;

      const segments = selectedSessao.transcricao!.segments;
      const time = currentAudioTimeRef.current;
      const currentBlock = segments.find(b => time >= b.start && time < b.end);
      if (!currentBlock) return;
      e.preventDefault();

      const existing = selectedSessao.pontos_chave?.find(kp => Math.abs(kp.start - currentBlock.start) < 0.05);

      if (e.ctrlKey || e.metaKey) {
        if (existing) handleRemovePontoChave(existing.id);
      } else {
        if (existing) handleRemovePontoChave(existing.id);
        else handleAddPontoChaveFromBlock(currentBlock);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessao]);

  // Deriva a lista de locutores únicos da transcrição atual (para o picker)
  const computeSpeakerOptions = (): SpeakerOption[] => {
    if (!selectedSessao?.transcricao?.segments) return [];
    const map = new Map<string, SpeakerOption>();
    for (const b of selectedSessao.transcricao.segments) {
      const existing = map.get(b.speakerId);
      if (existing) {
        existing.blockCount++;
      } else {
        const isManualName = !!b.speaker && !/^Locutor \d+$/.test(b.speaker);
        map.set(b.speakerId, {
          id: b.speakerId,
          name: b.speaker || b.speakerId,
          color: b.speakerColor || '#cbd5e1',
          blockCount: 1,
          isManualName,
        });
      }
    }
    // Ordena: atual primeiro, depois por nome
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      if (a.id === speakerPicker.currentSpeakerId) return -1;
      if (b.id === speakerPicker.currentSpeakerId) return 1;
      // Locutor N por número, nomes próprios depois
      const aIsAuto = /^Locutor (\d+)$/.exec(a.name);
      const bIsAuto = /^Locutor (\d+)$/.exec(b.name);
      if (aIsAuto && bIsAuto) return parseInt(aIsAuto[1]) - parseInt(bIsAuto[1]);
      if (aIsAuto && !bIsAuto) return -1;
      if (!aIsAuto && bIsAuto) return 1;
      return a.name.localeCompare(b.name);
    });
    return arr;
  };

  const handleYtManualTranscribe = async () => {
    const url = ytManualUrl.trim();
    // Aceita YouTube OU qualquer URL http(s) com extensão de áudio ou link de nuvem
    // (Nextcloud, Drive, OneDrive, etc.)
    const isValid = /^https?:\/\//i.test(url);
    if (!url || !isValid) {
      setToast({
        open: true,
        message: 'Cole uma URL válida (YouTube ou link direto de áudio).',
        variant: 'warning',
      });
      return;
    }
    const isYoutube = /(?:youtube\.com|youtu\.be)/i.test(url);
    const titulo = isYoutube ? 'Sessão YouTube' : 'Áudio externo';
    setYtManualUrl('');
    handleYtTranscribe({ id: 'manual', title: titulo, url });
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
      {/* Hover effect para palavras clicáveis da transcrição */}
      <style jsx global>{`
        .word-span:hover {
          background: #fef3c7;
        }
      `}</style>

      <Topbar title="Transcrição de Sessões" subtitle="Transcrição automática de sessões plenárias com diarização de interlocutores" />

      <div style={{
        padding: '14px 24px 18px',
        maxWidth: '1400px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
        height: 'calc(100dvh - var(--topbar-height))',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ flexShrink: 0 }}>
        {/* Header com ações */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
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

        {/* Cards de sucesso (sessões recém-concluídas, vivem ~6s) */}
        {successCards.map(sc => (
          <div
            key={`success-${sc.id}`}
            role="status"
            style={{
              position: 'relative',
              background: 'linear-gradient(135deg, #f0fdf4 0%, #fefce8 100%)',
              border: '1px solid #bbf7d0',
              borderLeft: '4px solid #16a34a',
              borderRadius: 12,
              padding: '14px 18px',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              boxShadow: '0 4px 14px rgba(22, 163, 74, 0.12)',
              animation: 'successCardIn 360ms cubic-bezier(.2,.8,.2,1), successCardOut 400ms cubic-bezier(.4,0,.6,1) 5.6s forwards',
              overflow: 'hidden',
            }}
          >
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: '#16a34a', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              animation: 'checkPop 420ms cubic-bezier(.34,1.56,.64,1) 120ms backwards',
              boxShadow: '0 0 0 4px rgba(22, 163, 74, 0.15)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#14532d', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sc.titulo.length > 70 ? sc.titulo.substring(0, 70) + '…' : sc.titulo}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#15803d', marginTop: 2, fontWeight: 500 }}>
                Transcrição concluída — pronta para leitura e relatório
              </div>
            </div>
            <button
              onClick={() => {
                setActiveTab('sessoes');
                setUnviewedCompletions(prev => {
                  const next = new Set(prev);
                  next.delete(sc.id);
                  return next;
                });
                setHighlightedId(sc.id);
                setTimeout(() => setHighlightedId(null), 3200);
                loadSessaoDetail(sc.id);
                setSuccessCards(cards => cards.filter(c => c.id !== sc.id));
              }}
              style={{
                background: '#16a34a',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
                boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
                transition: 'transform 150ms ease, box-shadow 150ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 10px rgba(22, 163, 74, 0.35)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(22, 163, 74, 0.25)'; }}
            >
              Ver agora <ChevronRight size={14} />
            </button>
          </div>
        ))}

        {/* Barras de progresso para sessões ativas */}
        {progressos.map(p => (
          <div key={p.id} style={{
            background: p.status === 'erro' ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${p.status === 'erro' ? '#fecaca' : '#bbf7d0'}`,
            borderRadius: 12, padding: '12px 16px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem', color: p.status === 'erro' ? '#991b1b' : '#166534', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.titulo?.substring(0, 70) || 'Sessão'}
              </span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: p.status === 'erro' ? '#dc2626' : '#16a34a', marginLeft: 8 }}>
                {p.status === 'erro' ? 'Erro' : `${p.progresso_pct}%`}
              </span>
            </div>
            {p.status !== 'erro' && (
              <div style={{ background: '#dcfce7', borderRadius: 8, height: 8, overflow: 'hidden' }}>
                <div style={{
                  background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                  height: '100%', borderRadius: 8,
                  width: `${p.progresso_pct}%`,
                  transition: 'width 0.8s ease-in-out',
                }} />
              </div>
            )}
            <div style={{ fontSize: '0.75rem', color: p.status === 'erro' ? '#ef4444' : '#4ade80', marginTop: 4 }}>
              {p.status === 'erro' ? (p.error_msg?.substring(0, 100) || 'Erro desconhecido') : (p.progresso_etapa || 'Processando...')}
            </div>
          </div>
        ))}

        {/* Upload progress (file upload) */}
        {uploadProgress && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.85rem', color: '#1c4076', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {uploading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {uploadProgress}
          </div>
        )}

        {/* Tabs: YouTube (fonte) → Minhas Transcrições (resultado) */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
          {[
            { id: 'youtube' as const, label: 'YouTube CMBV', icon: <Play size={14} /> },
            { id: 'sessoes' as const, label: 'Minhas Transcrições', icon: <FileAudio size={14} /> },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            const badge = tab.id === 'sessoes' && unviewedCompletions.size > 0 ? unviewedCompletions.size : 0;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'sessoes' && unviewedCompletions.size > 0) {
                    setUnviewedCompletions(new Set());
                  }
                }}
                style={{
                  position: 'relative',
                  padding: '8px 16px', borderRadius: '999px', border: 'none', cursor: 'pointer',
                  background: isActive ? '#1c4076' : '#f3f4f6',
                  color: isActive ? 'white' : '#6b7280',
                  fontWeight: 600, fontSize: '0.85rem',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'background 180ms ease, color 180ms ease',
                }}
              >
                {tab.icon} {tab.label}
                {badge > 0 && (
                  <span
                    aria-label={`${badge} nova${badge > 1 ? 's' : ''} transcrição${badge > 1 ? 'ões' : ''} pronta${badge > 1 ? 's' : ''}`}
                    style={{
                      minWidth: 18, height: 18, padding: '0 5px',
                      background: '#eab308', color: '#422006',
                      borderRadius: 999, fontSize: '0.68rem', fontWeight: 800,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 0 0 2px rgba(234, 179, 8, 0.25)',
                      animation: 'badgePulse 1.6s cubic-bezier(.2,.8,.2,1) 2',
                    }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        </div>

        {/* Área de conteúdo — rola internamente, não propaga scroll pro outer */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

        {/* YouTube video grid */}
        {activeTab === 'youtube' && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', background: '#fff', padding: '20px' }}>

            {/* Vídeos públicos — download direto via yt-dlp sem autenticação */}

            {/* Campo URL manual + título */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #d1d5db', borderRadius: '8px', padding: '8px 12px', background: '#fff' }}>
                <Link2 size={16} color="#9ca3af" />
                <input
                  type="text" placeholder="Cole aqui o link (YouTube, Nextcloud, Drive, OneDrive, ...)"
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
        <div style={{
          display: 'grid',
          gridTemplateColumns: selectedSessao ? (sidebarCollapsed ? '0px 1fr' : '320px 1fr') : '1fr',
          gap: selectedSessao && !sidebarCollapsed ? '16px' : '0px',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          transition: 'grid-template-columns 220ms cubic-bezier(.2,.8,.2,1), gap 220ms ease',
        }}>

          {/* Lista de sessões */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#fafafa' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {sessoes.length} {sessoes.length === 1 ? 'sessão' : 'sessões'}
              </span>
              <button
                onClick={() => setSidebarCollapsed(true)}
                title="Ocultar lista (Ctrl+B)"
                aria-label="Ocultar lista de sessões"
                style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center', borderRadius: 4 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#e5e7eb'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <ChevronLeft size={16} />
              </button>
            </div>
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
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {sessoes.map(s => {
                  const isHighlighted = highlightedId === s.id;
                  return (
                  <button
                    key={s.id}
                    onClick={() => loadSessaoDetail(s.id)}
                    style={{
                      display: 'block', width: '100%', padding: '14px 16px', border: 'none',
                      borderBottom: '1px solid #f3f4f6', cursor: 'pointer', textAlign: 'left',
                      background: isHighlighted
                        ? '#fefce8'
                        : selectedSessao?.id === s.id ? '#eff6ff' : '#fff',
                      boxShadow: isHighlighted
                        ? 'inset 4px 0 0 0 #eab308, 0 0 0 2px rgba(234, 179, 8, 0.35)'
                        : 'none',
                      animation: isHighlighted ? 'rowPulse 3.2s cubic-bezier(.4,0,.2,1)' : undefined,
                      transition: 'background 220ms ease',
                      position: 'relative',
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
                  );
                })}
              </div>
            )}
          </div>

          {/* Botão flutuante para reabrir a lista quando recolhida */}
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Mostrar lista (Ctrl+B)"
              aria-label="Mostrar lista de sessões"
              style={{
                position: 'absolute',
                left: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                background: '#1c4076',
                color: '#fff',
                border: 'none',
                borderRadius: '0 10px 10px 0',
                padding: '14px 5px',
                cursor: 'pointer',
                zIndex: 10,
                boxShadow: '0 4px 12px rgba(28, 64, 118, 0.28)',
                display: 'flex',
                alignItems: 'center',
                transition: 'background 150ms ease, padding 150ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#163560'; e.currentTarget.style.padding = '14px 8px'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#1c4076'; e.currentTarget.style.padding = '14px 5px'; }}
            >
              <ChevronRight size={16} />
            </button>
          )}

          {/* Painel de detalhe */}
          {selectedSessao && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', background: '#fff', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
              {loadingDetail ? (
                <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>
                  <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
                  Carregando transcrição...
                </div>
              ) : (
                <>
                  {/* Header da sessão — densidade editorial: meta inline + botões compactos */}
                  <div style={{ padding: '9px 18px', borderBottom: '1px solid #e5e7eb', background: '#fafafa', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, flex: 1 }}>
                        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#1f2937', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedSessao.titulo}</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          {selectedSessao.data_sessao && (
                            <>
                              <span style={{ color: '#cbd5e1' }}>·</span>
                              <span>{new Date(selectedSessao.data_sessao + 'T12:00').toLocaleDateString('pt-BR')}</span>
                            </>
                          )}
                          <span style={{ color: '#cbd5e1' }}>·</span>
                          <span>{formatDuration(selectedSessao.duracao_segundos)}</span>
                          <span style={{ color: '#cbd5e1' }}>·</span>
                          <span>{selectedSessao.transcricao?.segments?.length || 0} blocos</span>
                          {(() => {
                            if (!selectedSessao.audio_expira_em) {
                              if (!selectedSessao.audio_url) {
                                return (
                                  <span style={{ background: '#f1f5f9', color: '#64748b', padding: '1px 7px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, marginLeft: 4, letterSpacing: '0.02em' }}>arquivado</span>
                                );
                              }
                              return null;
                            }
                            const diasRestantes = Math.ceil((new Date(selectedSessao.audio_expira_em).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                            const bg = diasRestantes <= 2 ? '#fee2e2' : diasRestantes <= 7 ? '#fef3c7' : '#dbeafe';
                            const color = diasRestantes <= 2 ? '#991b1b' : diasRestantes <= 7 ? '#92400e' : '#1e40af';
                            return (
                              <span style={{ background: bg, color, padding: '1px 7px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, marginLeft: 4, letterSpacing: '0.02em' }}>
                                expira em {diasRestantes}d
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                        {selectedSessao.audio_url && (
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch('/api/sessoes/download-audio', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ sessao_id: selectedSessao.id }),
                                });
                                const data = await res.json();
                                if (res.ok && data.url) {
                                  const a = document.createElement('a');
                                  a.href = data.url;
                                  a.download = data.filename || 'sessao.mp3';
                                  a.click();
                                } else {
                                  setToast({ open: true, message: data.error || 'Erro ao baixar áudio', variant: 'danger' });
                                }
                              } catch {
                                setToast({ open: true, message: 'Erro ao baixar áudio', variant: 'danger' });
                              }
                            }}
                            style={{ background: '#0891b2', color: 'white', border: 'none', borderRadius: 6, padding: '5px 11px', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 5 }}
                            title="Baixar áudio em MP3 antes que expire"
                          >
                            <Download size={11} /> MP3
                          </button>
                        )}
                        <button
                          onClick={handleGenerateReport}
                          disabled={generatingReport}
                          title="Gerar relatório estruturado"
                          style={{ background: '#059669', color: 'white', border: 'none', borderRadius: 6, padding: '5px 11px', cursor: generatingReport ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 5, opacity: generatingReport ? 0.7 : 1 }}
                        >
                          {generatingReport ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <FileAudio size={11} />}
                          {generatingReport ? 'Gerando…' : 'Relatório'}
                        </button>
                        <button
                          onClick={async () => {
                            const tipo = detailView === 'relatorio' && (relatorio || selectedSessao.relatorio) ? 'relatorio' : 'transcricao';
                            try {
                              const res = await fetch('/api/sessoes/export-docx', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sessao_id: selectedSessao.id, tipo }),
                              });
                              if (!res.ok) { setToast({ open: true, message: 'Erro ao gerar DOCX', variant: 'danger' }); return; }
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${(selectedSessao.titulo || 'sessao').substring(0, 40)}_${tipo}.docx`;
                              a.click();
                              URL.revokeObjectURL(url);
                            } catch { setToast({ open: true, message: 'Erro ao exportar', variant: 'danger' }); }
                          }}
                          title="Exportar DOCX"
                          style={{ background: '#1c4076', color: 'white', border: 'none', borderRadius: 6, padding: '5px 11px', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 5 }}
                        >
                          <Download size={11} /> DOCX
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Abas fixas estilo marcador de caderno */}
                  <div style={{ display: 'flex', gap: 0, flexShrink: 0, paddingLeft: 18, background: '#f8fafc', borderBottom: '2px solid #1c4076' }}>
                    {(['transcricao', 'relatorio'] as const).map(t => (
                      <button key={t} onClick={() => setDetailView(t)} style={{
                        padding: '7px 18px 6px',
                        borderRadius: '8px 8px 0 0',
                        border: detailView === t ? '2px solid #1c4076' : '2px solid transparent',
                        borderBottom: detailView === t ? '2px solid #fff' : '2px solid transparent',
                        marginBottom: -2,
                        cursor: 'pointer',
                        background: detailView === t ? '#fff' : 'transparent',
                        color: detailView === t ? '#1c4076' : '#94a3b8',
                        fontWeight: detailView === t ? 700 : 600,
                        fontSize: '0.75rem',
                        letterSpacing: '0.01em',
                        transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
                        position: 'relative',
                        zIndex: detailView === t ? 2 : 1,
                      }}>
                        {t === 'transcricao' ? 'Transcrição' : 'Relatório'}
                      </button>
                    ))}
                  </div>

                  {/* Conteúdo: Transcrição ou Relatório */}
                  {detailView === 'transcricao' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', flex: 1, minHeight: 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        {/* ── HEADER FIXO (não rola) ── */}
                        <div style={{
                          flexShrink: 0,
                          padding: '6px 18px 4px',
                          borderBottom: '1px solid #e5e7eb',
                          background: '#fff',
                          zIndex: 2,
                        }}>
                          {/* Barra de busca + substituição (Ctrl+F / Ctrl+H) */}
                          {searchOpen && (
                            <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 6, padding: '5px 12px' }}>
                              {/* Linha 1: Localizar */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Search size={13} color="#92400e" />
                                <input
                                  ref={searchInputRef}
                                  value={searchQuery}
                                  onChange={e => { setSearchQuery(e.target.value); setSearchCurrentIdx(0); }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.ctrlKey) {
                                      e.preventDefault();
                                      goToSearchMatch(e.shiftKey ? searchCurrentIdx - 1 : searchCurrentIdx + 1);
                                    } else if (e.key === 'Escape') {
                                      setSearchOpen(false);
                                      setSearchQuery('');
                                      setReplaceMode(false);
                                      setReplaceValue('');
                                    }
                                  }}
                                  placeholder="Localizar na transcrição..."
                                  style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: '0.78rem', color: '#1f2937', minWidth: 0 }}
                                  autoFocus
                                />
                                {searchQuery && (
                                  <span style={{ fontSize: '0.68rem', color: '#92400e', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                    {searchMatches.length > 0 ? `${searchCurrentIdx + 1} de ${searchMatches.length}` : '0'}
                                  </span>
                                )}
                                <button onClick={() => goToSearchMatch(searchCurrentIdx - 1)} disabled={searchMatches.length === 0}
                                  title="Anterior (Shift+Enter)"
                                  style={{ background: 'none', border: '1px solid #fde68a', borderRadius: 4, padding: 3, cursor: searchMatches.length ? 'pointer' : 'default', display: 'flex', alignItems: 'center', color: '#92400e', opacity: searchMatches.length ? 1 : 0.4 }}>
                                  <ChevronLeft size={12} />
                                </button>
                                <button onClick={() => goToSearchMatch(searchCurrentIdx + 1)} disabled={searchMatches.length === 0}
                                  title="Próximo (Enter)"
                                  style={{ background: 'none', border: '1px solid #fde68a', borderRadius: 4, padding: 3, cursor: searchMatches.length ? 'pointer' : 'default', display: 'flex', alignItems: 'center', color: '#92400e', opacity: searchMatches.length ? 1 : 0.4 }}>
                                  <ChevronRight size={12} />
                                </button>
                                <button
                                  onClick={() => { setReplaceMode(v => !v); setTimeout(() => replaceInputRef.current?.focus(), 50); }}
                                  title={replaceMode ? 'Fechar substituição' : 'Abrir substituição (Ctrl+H)'}
                                  style={{
                                    background: replaceMode ? '#fef08a' : 'transparent',
                                    border: '1px solid #fde68a',
                                    borderRadius: 4,
                                    padding: '3px 6px',
                                    cursor: 'pointer',
                                    fontSize: '0.64rem',
                                    fontWeight: 700,
                                    color: '#92400e',
                                    display: 'flex',
                                    alignItems: 'center',
                                    letterSpacing: '0.02em',
                                  }}
                                >
                                  A→B
                                </button>
                                <button onClick={() => { setSearchOpen(false); setSearchQuery(''); setReplaceMode(false); setReplaceValue(''); }}
                                  title="Fechar (Esc)"
                                  style={{ background: 'none', border: 'none', padding: 3, cursor: 'pointer', color: '#92400e', display: 'flex', alignItems: 'center' }}>
                                  <X size={13} />
                                </button>
                              </div>

                              {/* Linha 2: Substituir (expandível) */}
                              {replaceMode && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, paddingLeft: 21 }}>
                                  <input
                                    ref={replaceInputRef}
                                    value={replaceValue}
                                    onChange={e => setReplaceValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        handleReplaceAll();
                                      } else if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleReplaceCurrent();
                                      } else if (e.key === 'Escape') {
                                        setReplaceMode(false);
                                        setReplaceValue('');
                                      }
                                    }}
                                    placeholder="Substituir por..."
                                    style={{ flex: 1, border: '1px solid #fde68a', background: '#fff', borderRadius: 4, outline: 'none', fontSize: '0.78rem', color: '#1f2937', padding: '3px 8px', minWidth: 0 }}
                                  />
                                  <button
                                    onClick={handleReplaceCurrent}
                                    disabled={searchMatches.length === 0}
                                    title="Substituir atual (Enter)"
                                    style={{
                                      background: searchMatches.length > 0 ? '#f59e0b' : '#e5e7eb',
                                      color: searchMatches.length > 0 ? '#fff' : '#9ca3af',
                                      border: 'none',
                                      borderRadius: 4,
                                      padding: '4px 10px',
                                      cursor: searchMatches.length > 0 ? 'pointer' : 'default',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    Substituir
                                  </button>
                                  <button
                                    onClick={handleReplaceAll}
                                    disabled={searchMatches.length === 0}
                                    title="Substituir todas (Ctrl+Enter)"
                                    style={{
                                      background: searchMatches.length > 0 ? '#d97706' : '#e5e7eb',
                                      color: searchMatches.length > 0 ? '#fff' : '#9ca3af',
                                      border: 'none',
                                      borderRadius: 4,
                                      padding: '4px 10px',
                                      cursor: searchMatches.length > 0 ? 'pointer' : 'default',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    Todas ({searchMatches.length})
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Player + tabs em uma única linha — densidade editorial */}
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <AudioPlayer
                                audioUrl={selectedSessao.audio_url}
                                onTimeUpdate={setCurrentAudioTime}
                                seekTo={seekTo}
                                compact
                              />
                            </div>
                            {/* Botões busca, undo, redo */}
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingTop: 2, alignItems: 'center' }}>
                              <button
                                onClick={() => {
                                  setSearchOpen(v => {
                                    if (!v) setTimeout(() => searchInputRef.current?.focus(), 50);
                                    return !v;
                                  });
                                }}
                                title="Localizar na transcrição (Ctrl+F)"
                                aria-label="Localizar na transcrição"
                                style={{
                                  background: searchOpen ? '#fefce8' : '#f1f5f9',
                                  border: searchOpen ? '1px solid #fde68a' : '1px solid transparent',
                                  borderRadius: 999,
                                  padding: '5px 7px',
                                  cursor: 'pointer',
                                  color: searchOpen ? '#92400e' : '#64748b',
                                  display: 'flex',
                                  alignItems: 'center',
                                  marginLeft: 4,
                                  transition: 'background 150ms ease, color 150ms ease',
                                }}
                              >
                                <Search size={13} />
                              </button>
                              <button
                                onClick={handleUndo}
                                disabled={undoStack.length === 0}
                                title={`Desfazer (Ctrl+Z)${undoStack.length > 0 ? ` · ${undoStack.length} ações` : ''}`}
                                aria-label="Desfazer"
                                style={{
                                  background: '#f1f5f9',
                                  border: '1px solid transparent',
                                  borderRadius: 999,
                                  padding: '5px 7px',
                                  cursor: undoStack.length > 0 ? 'pointer' : 'default',
                                  color: undoStack.length > 0 ? '#64748b' : '#cbd5e1',
                                  display: 'flex',
                                  alignItems: 'center',
                                  transition: 'color 150ms ease',
                                }}
                              >
                                <Undo2 size={13} />
                              </button>
                              <button
                                onClick={handleRedo}
                                disabled={redoStack.length === 0}
                                title={`Refazer (Ctrl+Y)${redoStack.length > 0 ? ` · ${redoStack.length} ações` : ''}`}
                                aria-label="Refazer"
                                style={{
                                  background: '#f1f5f9',
                                  border: '1px solid transparent',
                                  borderRadius: 999,
                                  padding: '5px 7px',
                                  cursor: redoStack.length > 0 ? 'pointer' : 'default',
                                  color: redoStack.length > 0 ? '#64748b' : '#cbd5e1',
                                  display: 'flex',
                                  alignItems: 'center',
                                  transition: 'color 150ms ease',
                                }}
                              >
                                <Redo2 size={13} />
                              </button>
                            </div>
                          </div>

                          {/* Atalhos de edição — micro-link em vez de pill */}
                          <div style={{ marginTop: 4 }}>
                            <button
                              onClick={() => setShortcutsOpen(v => !v)}
                              aria-expanded={shortcutsOpen}
                              aria-controls="shortcuts-panel"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: '2px 0',
                                fontSize: '0.64rem',
                                fontWeight: 600,
                                color: shortcutsOpen ? '#1c4076' : '#94a3b8',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                textDecorationStyle: 'dotted',
                                textUnderlineOffset: 3,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                letterSpacing: '0.02em',
                                textTransform: 'lowercase',
                              }}
                              title={shortcutsOpen ? 'Recolher atalhos' : 'Ver atalhos de edição'}
                            >
                              <span style={{ fontSize: '0.7rem', lineHeight: 1 }}>{shortcutsOpen ? '▾' : '▸'}</span>
                              atalhos de edição
                            </button>
                            <div
                              id="shortcuts-panel"
                              style={{
                                maxHeight: shortcutsOpen ? 140 : 0,
                                overflow: 'hidden',
                                opacity: shortcutsOpen ? 1 : 0,
                                transition: 'max-height 240ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease, margin-top 180ms ease',
                                marginTop: shortcutsOpen ? 6 : 0,
                              }}
                            >
                              <div style={{
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: 8,
                                padding: '7px 11px',
                                fontSize: '0.66rem',
                                color: '#64748b',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                              }}>
                                <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, padding: '1px 5px', fontSize: '0.6rem' }}>CTRL</kbd>+clique numa palavra → dividir bloco (palavra clicada vira novo locutor)</span>
                                <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, padding: '1px 5px', fontSize: '0.6rem' }}>ALT</kbd>+clique no bloco → juntar com o anterior</span>
                                <span>Clique na <Pencil size={9} style={{ display: 'inline', verticalAlign: -1 }} /> ao lado do nome → renomear/atribuir locutor</span>
                                <span>Duplo-clique no texto → editar inline (Esc cancela, CTRL+Enter salva)</span>
                                <span>Clique numa palavra sem CTRL → pula o áudio pra esse ponto</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* ── CORPO ROLÁVEL (só os blocos) ── */}
                        <div style={{ overflowY: 'auto', padding: '14px 20px', minHeight: 0, flex: 1 }}>
                        {selectedSessao.transcricao?.segments?.map((block, blockIdx) => {
                          const isCurrentBlock = currentAudioTime >= block.start && currentAudioTime < block.end;
                          const isCurrentSearchBlock = searchMatches.length > 0 && searchMatches[searchCurrentIdx]?.blockIdx === blockIdx;
                          return (
                          <div
                            key={`${block.id}-${blockIdx}`}
                            id={`block-${blockIdx}`}
                            style={{
                              marginBottom: '12px',
                              paddingLeft: '12px',
                              borderLeft: `${isCurrentBlock ? 5 : isCurrentSearchBlock ? 4 : 3}px solid ${isCurrentSearchBlock ? '#f59e0b' : block.speakerColor || '#d1d5db'}`,
                              background: isCurrentBlock ? '#fefce8' : isCurrentSearchBlock ? '#fffbeb' : undefined,
                              borderRadius: (isCurrentBlock || isCurrentSearchBlock) ? 4 : 0,
                              transition: 'all 0.15s ease',
                            }}
                            onClick={(e) => {
                              // ALT+Click em qualquer parte do bloco → juntar com anterior
                              if (e.altKey) {
                                e.preventDefault();
                                e.stopPropagation();
                                handleMergeBlock(blockIdx);
                              }
                            }}
                            title={blockIdx > 0 ? 'ALT+Click para juntar com o bloco anterior' : undefined}
                          >
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: block.speakerColor || '#6b7280', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                onClick={(e) => {
                                  if (e.shiftKey) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openSpeakerPicker(block.speakerId, e.currentTarget as HTMLElement);
                                  }
                                }}
                                style={{ cursor: 'pointer' }}
                                title="SHIFT+Click para atribuir locutor (ou use a ✏ ao lado)"
                              >
                                {block.speaker}
                              </span>
                              <span
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openSpeakerPicker(block.speakerId, e.currentTarget as HTMLElement, true);
                                }}
                                style={{ cursor: 'pointer', opacity: 0.55, display: 'inline-flex', alignItems: 'center' }}
                                title="Renomear locutor"
                                aria-label="Renomear locutor"
                              >
                                <Pencil size={10} />
                              </span>
                              <span style={{ color: '#9ca3af', fontWeight: 400 }}>— {formatTime(block.start)}</span>
                              {editingBlockId !== block.id && !block.isUnclear && (
                                <span
                                  onClick={(e) => { e.stopPropagation(); setEditingBlockId(block.id); }}
                                  style={{ cursor: 'pointer', opacity: 0.4, display: 'inline-flex', alignItems: 'center' }}
                                  title="Editar texto inline (ou dê duplo-clique no texto)"
                                  aria-label="Editar texto do bloco"
                                >
                                  <Pencil size={10} />
                                </span>
                              )}
                              {!block.isUnclear && (() => {
                                const marked = blockHasPontoChave(block);
                                return (
                                  <span
                                    onClick={(e) => { e.stopPropagation(); handleTogglePontoChaveDoBloco(block); }}
                                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', marginLeft: 2, color: marked ? '#1c4076' : '#94a3b8', opacity: marked ? 1 : 0.5, transition: 'opacity 150ms ease, color 150ms ease' }}
                                    title={marked ? 'Remover ponto-chave (Ctrl+M)' : 'Marcar como ponto-chave (M)'}
                                    aria-label={marked ? 'Remover ponto-chave' : 'Marcar como ponto-chave'}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = marked ? '1' : '0.5'; }}
                                  >
                                    {marked ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                                  </span>
                                );
                              })()}
                            </div>
                            {editingBlockId === block.id ? (
                              <div
                                contentEditable
                                suppressContentEditableWarning
                                ref={(el) => {
                                  if (el && document.activeElement !== el) {
                                    el.focus();
                                    const range = document.createRange();
                                    range.selectNodeContents(el);
                                    range.collapse(false);
                                    const sel = window.getSelection();
                                    sel?.removeAllRanges();
                                    sel?.addRange(range);
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => handleSaveBlockEdit(block.id, e.currentTarget.textContent || '')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditingBlockId(null);
                                  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                    e.preventDefault();
                                    (e.currentTarget as HTMLDivElement).blur();
                                  }
                                }}
                                style={{
                                  fontSize: '0.88rem',
                                  color: '#374151',
                                  lineHeight: 1.6,
                                  outline: '2px solid #fde047',
                                  outlineOffset: '2px',
                                  borderRadius: 4,
                                  background: '#fefce8',
                                  padding: '2px 4px',
                                  cursor: 'text',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {block.text}
                              </div>
                            ) : (
                              <div
                                style={{ fontSize: '0.88rem', color: block.isUnclear ? '#dc2626' : '#374151', lineHeight: 1.6, fontStyle: block.isUnclear ? 'italic' : 'normal' }}
                                onDoubleClick={(e) => {
                                  if (block.isUnclear) return;
                                  e.stopPropagation();
                                  setEditingBlockId(block.id);
                                }}
                                title={!block.isUnclear ? 'Duplo-clique para editar o texto inline' : undefined}
                              >
                                {block.isUnclear ? (
                                  <span style={{ color: '#dc2626' }}>(trecho inaudível)</span>
                                ) : block.words && block.words.length > 0 ? (
                                  block.words.map((w, wIdx) => {
                                    const isCurrent = currentAudioTime >= w.start && currentAudioTime < w.end;
                                    return (
                                      <span
                                        key={wIdx}
                                        onClick={(e) => {
                                          if (e.ctrlKey || e.metaKey) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleSplitBlock(blockIdx, wIdx);
                                          } else if (!e.altKey && !e.shiftKey) {
                                            // Click simples → pular áudio para essa palavra
                                            e.stopPropagation();
                                            setSeekTo(w.start);
                                          }
                                        }}
                                        style={{
                                          cursor: 'pointer',
                                          borderRadius: 2,
                                          padding: '0 1px',
                                          background: isCurrent ? '#fde047' : (searchQuery && w.word.toLowerCase().includes(searchQuery.toLowerCase())) ? '#fef08a' : undefined,
                                          fontWeight: isCurrent ? 600 : undefined,
                                        }}
                                        className="word-span"
                                        title="Click = tocar · CTRL+Click = dividir aqui · Duplo-clique = editar"
                                      >
                                        {w.word}{' '}
                                      </span>
                                    );
                                  })
                                ) : (
                                  <span>{highlightSearchInText(block.text)}</span>
                                )}
                              </div>
                            )}
                          </div>
                          );
                        })}
                        {(!selectedSessao.transcricao?.segments || selectedSessao.transcricao.segments.length === 0) && (
                          <p style={{ color: '#9ca3af', textAlign: 'center', padding: '24px' }}>Transcrição não disponível.</p>
                        )}
                        </div>
                      </div>
                      <div style={{ borderLeft: '1px solid #e5e7eb', overflowY: 'auto', padding: '12px', background: '#fafafa', minHeight: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <p style={{ margin: 0, fontSize: '0.66rem', fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pontos-Chave</p>
                          <span style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {selectedSessao.pontos_chave?.length || 0}
                          </span>
                        </div>
                        {selectedSessao.pontos_chave?.map(kp => {
                          const isManual = !!kp.manual;
                          return (
                            <div
                              key={kp.id}
                              onClick={() => handleSeekToPontoChave(kp)}
                              style={{
                                marginBottom: 8,
                                padding: '7px 9px 7px 9px',
                                background: isManual ? '#fff' : '#fafafa',
                                borderRadius: 7,
                                border: isManual ? '1px solid #c7d2fe' : '1px dashed #d1d5db',
                                fontSize: '0.74rem',
                                cursor: 'pointer',
                                position: 'relative',
                                transition: 'box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease',
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.boxShadow = '0 2px 8px rgba(28, 64, 118, 0.12)';
                                e.currentTarget.style.borderColor = '#1c4076';
                                e.currentTarget.style.transform = 'translateX(-1px)';
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.boxShadow = 'none';
                                e.currentTarget.style.borderColor = isManual ? '#c7d2fe' : '#d1d5db';
                                e.currentTarget.style.transform = 'translateX(0)';
                              }}
                              title="Clique para pular o áudio até este momento"
                            >
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemovePontoChave(kp.id); }}
                                aria-label="Remover ponto-chave"
                                title="Remover"
                                style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: '#cbd5e1', display: 'flex', alignItems: 'center', borderRadius: 4, transition: 'color 120ms ease, background 120ms ease' }}
                                onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fee2e2'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.background = 'transparent'; }}
                              >
                                <X size={11} />
                              </button>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, fontSize: '0.62rem', color: '#94a3b8', fontVariantNumeric: 'tabular-nums', paddingRight: 16 }}>
                                {isManual
                                  ? <BookmarkCheck size={9} color="#1c4076" />
                                  : <Sparkles size={9} color="#94a3b8" />}
                                <span style={{ fontWeight: 700 }}>{formatTime(kp.start)}</span>
                                <span style={{ color: '#cbd5e1' }}>·</span>
                                <span style={{ fontWeight: 500, textTransform: 'lowercase' }}>{isManual ? 'marcado' : 'sugerido'}</span>
                              </div>
                              <div style={{ fontWeight: isManual ? 600 : 500, color: isManual ? '#1f2937' : '#475569', lineHeight: 1.4, paddingRight: 12 }}>
                                {kp.title}
                              </div>
                            </div>
                          );
                        })}
                        {(!selectedSessao.pontos_chave || selectedSessao.pontos_chave.length === 0) && (
                          <p style={{ color: '#9ca3af', fontSize: '0.74rem', marginTop: 12, lineHeight: 1.5 }}>
                            Nenhum ponto-chave.<br />
                            <span style={{ color: '#cbd5e1' }}>Clique no <Bookmark size={10} style={{ display: 'inline', verticalAlign: -1 }} /> ao lado de um bloco ou pressione <kbd style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 3, padding: '0 4px', fontSize: '0.62rem' }}>M</kbd> durante o play.</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                      {/* Tabs agora são fixas acima do conteúdo condicional */}
                      <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1, minHeight: 0 }}>
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
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        )}
        </div>
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
        action={toast.action}
        onClose={() => setToast(t => ({ ...t, open: false }))}
      />

      <SpeakerPicker
        open={speakerPicker.open}
        anchorRect={speakerPicker.anchorRect}
        currentSpeakerId={speakerPicker.currentSpeakerId}
        speakers={computeSpeakerOptions()}
        onSelect={handleSpeakerSelect}
        onRenameItem={handleSpeakerRenameItem}
        onClose={() => setSpeakerPicker({ open: false, anchorRect: null, currentSpeakerId: '', editOnOpen: false })}
        autoEditCurrent={speakerPicker.editOnOpen}
      />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        @keyframes successCardIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes successCardOut {
          from { opacity: 1; transform: translateY(0) scale(1); max-height: 120px; margin-bottom: 8px; padding-top: 14px; padding-bottom: 14px; }
          to   { opacity: 0; transform: translateY(-6px) scale(0.98); max-height: 0; margin-bottom: 0; padding-top: 0; padding-bottom: 0; border-width: 0; }
        }
        @keyframes checkPop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes badgePulse {
          0%, 100% { box-shadow: 0 0 0 2px rgba(234, 179, 8, 0.25); }
          50%      { box-shadow: 0 0 0 6px rgba(234, 179, 8, 0.08); }
        }
        @keyframes rowPulse {
          0%   { box-shadow: inset 4px 0 0 0 #eab308, 0 0 0 0 rgba(234, 179, 8, 0.55); }
          40%  { box-shadow: inset 4px 0 0 0 #eab308, 0 0 0 6px rgba(234, 179, 8, 0.00); }
          100% { box-shadow: inset 4px 0 0 0 #eab308, 0 0 0 2px rgba(234, 179, 8, 0.35); }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.001ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.001ms !important;
          }
        }
      `}</style>
    </>
  );
}
