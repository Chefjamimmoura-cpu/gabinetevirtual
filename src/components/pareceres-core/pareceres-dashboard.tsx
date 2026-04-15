'use client';

import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Send, Loader2, Link2, BrainCircuit, Calendar, UploadCloud, Download, History, Shield, Search, Gavel, ExternalLink, CheckCircle2, CheckCircle, Clock, ChevronRight, ChevronDown, Building2, Users, Trash2, Eye, RefreshCw, FileWarning, Lightbulb, PanelLeftClose, PanelLeftOpen, Zap } from 'lucide-react';
import styles from './pareceres-dashboard.module.css';
import { ComissaoWizard } from './comissao/ComissaoWizard';
import { PareceresAlertCards } from './pareceres-alert-cards';
import type { ParecerAlertas } from './pareceres-alert-cards';
import { PareceresModeracao } from './pareceres-moderacao';
import { A4DocumentViewer } from '../ui/a4-document-viewer';
import { LogoLoader } from '../ui/logo-loader';
import { createClient } from '@/lib/supabase/client';

interface CommissionDynamic {
  sigla: string;
  nome: string;
  area: string;
  criterios: string;
  keywords: string[];
  sapl_unit_id: number | null;
  artigoRegimento?: string;
  link_lei?: string;
  meu_cargo?: string; // presidente, vice-presidente, membro, acesso_geral
  comissao_uuid?: string | null;
}

interface MateriaFila {
  id: number;
  tipo_sigla: string;
  numero: number;
  ano: number;
  ementa: string;
  autores: string;
  status_relatoria: 'sem_rascunho' | 'rascunho_gerado';
  rascunho_voto: string | null;
  rascunho_em: string | null;
  ultima_tramitacao: string;
  status_tramitacao?: string;
  data_tramitacao?: string;
  sapl_url: string;
}

interface MateriaContexto {
  materia: {
    id: number;
    tipo_sigla: string;
    tipo_descricao: string;
    numero: number;
    ano: number;
    ementa: string;
    autores: string;
    regime: string;
    sapl_url: string;
  };
  procuradoria: { voto: string | null; texto: string | null };
  outras_comissoes: { comissao: string; voto: string }[];
  tramitacoes: { data: string; texto: string }[];
  rascunhos: { id: string; commission_sigla: string; voto: string; created_at: string }[];
}

const PARECER_CACHE_KEY = 'parecer_cache_v1';

function formatarDatasBR(texto: string): string {
  return texto.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1');
}

function getDataExtenso(dateString?: string): string {
  let date = new Date();
  if (dateString) {
    if (dateString.includes('-')) {
      date = new Date(`${dateString}T12:00:00`);
    } else {
      date = new Date(); // fallback se a data estiver em outro formato estranho
    }
  }
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `Boa Vista - RR, ${date.getDate()} de ${meses[date.getMonth()]} de ${date.getFullYear()}`;
}

export default function PareceresDashboard() {
  const [abaPrincipal, setAbaPrincipal] = useState<'alia' | 'vereador' | 'relatoria' | 'comissao'>('vereador');
  const [activeTab, setActiveTab] = useState<'sessoes' | 'pdf' | 'link'>('sessoes');
  const [itemToDelete, setItemToDelete] = useState<any>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pareceres_panel_collapsed') === 'true';
    }
    return false;
  });
  const togglePanel = () => {
    setIsPanelCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('pareceres_panel_collapsed', String(next));
      return next;
    });
  };

  // States Globais
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelType, setModelType] = useState('flash'); // flash or pro
  const [parecerResult, setParecerResult] = useState<string | null>(null);
  const [urlSapl, setUrlSapl] = useState('');

  // Contexto salvo para export (restaurado do cache junto com o parecer)
  const [cachedTotalMaterias, setCachedTotalMaterias] = useState(0);

  // States da Aba PDF Upload
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [pdfAviso, setPdfAviso] = useState<string | null>(null);

  // States da Aba Sessões (Ordem do Dia)
  const [dataFiltro, setDataFiltro] = useState('');
  const [ordensAtivas, setOrdensAtivas] = useState<any[]>([]);
  const [sessoes, setSessoes] = useState<any[]>([]);
  const [isLoadingSessoes, setIsLoadingSessoes] = useState(true);

  const [selectedSessao, setSelectedSessao] = useState<any | null>(null);
  const [selectedOrdemTitulo, setSelectedOrdemTitulo] = useState<string | null>(null);
  const [ordemDoDia, setOrdemDoDia] = useState<any[]>([]);
  const [isLoadingOrdem, setIsLoadingOrdem] = useState(false);
  const [selectedMaterias, setSelectedMaterias] = useState<any[]>([]);

  // Accordion States
  // Accordions removidos — lista unificada de sessões (P3 UI/UX redesign)
  const [isOrdemDiaOpen, setIsOrdemDiaOpen] = useState(true);
  const [isHistoricoOpen, setIsHistoricoOpen] = useState(false);

  // Histórico de pareceres gerados
  const [historico, setHistorico] = useState<any[]>([]);

  // States da Aba Relatoria
  const [relatorComissao, setRelatorComissao] = useState('CASP');
  const [comissoesDisponiveis, setComissoesDisponiveis] = useState<CommissionDynamic[]>([]);
  const [pdfUploadLoading, setPdfUploadLoading] = useState(false);
  const [relatorNome, setRelatorNome] = useState('');
  const [relatorVoto, setRelatorVoto] = useState<'FAVORÁVEL' | 'CONTRÁRIO'>('FAVORÁVEL');
  const [relatorResult, setRelatorResult] = useState<string | null>(null);
  const [relatorTitulo, setRelatorTitulo] = useState<string | null>(null);
  const [isGerandoRelator, setIsGerandoRelator] = useState(false);
  const [relatorRagDocs, setRelatorRagDocs] = useState<{
    procuradoria: { nome: string; url: string; data?: string; texto_extraido: boolean; trecho?: string }[];
    comissoes: { nome: string; url: string; data?: string; texto_extraido: boolean; trecho?: string }[];
    procuradoria_encontrada: boolean;
    cljrf_encontrado: boolean;
    total_docs_analisados: number;
    total_texto_extraido: number;
  } | null>(null);
  const [gabineteId, setGabineteId] = useState<string | null>(null);
  // Fila automática
  const [relatoriaFila, setRelatoriaFila] = useState<MateriaFila[]>([]);
  const [relatoriaFilaLoading, setRelatoriaFilaLoading] = useState(false);
  const [selectedMateriaFila, setSelectedMateriaFila] = useState<MateriaFila | null>(null);
  const [materiaContexto, setMateriaContexto] = useState<MateriaContexto | null>(null);
  const [materiaContextoLoading, setMateriaContextoLoading] = useState(false);
  const [buscarIdMode, setBuscarIdMode] = useState(false);
  const [relatorBuscarId, setRelatorBuscarId] = useState('');

  // Relatoria Redesign — filtros sidebar
  const [relatoriaSearchQuery, setRelatoriaSearchQuery] = useState('');
  const [relatoriaSortBy, setRelatoriaSortBy] = useState<'data_desc' | 'data_asc' | 'numero_desc' | 'numero_asc'>('data_desc');
  const [relatoriaFilterTipo, setRelatoriaFilterTipo] = useState<string | null>(null);
  const [relatoriaFilterStatus, setRelatoriaFilterStatus] = useState<'todos' | 'pendentes' | 'concluidos'>('todos');
  const [contextoExpandido, setContextoExpandido] = useState(false);

  // Relatoria Redesign — computed filters
  const relatoriaTiposCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    relatoriaFila.forEach(m => { counts[m.tipo_sigla] = (counts[m.tipo_sigla] || 0) + 1; });
    return counts;
  }, [relatoriaFila]);

  const relatoriaStatusCounts = useMemo(() => ({
    pendentes: relatoriaFila.filter(m => m.status_relatoria === 'sem_rascunho').length,
    concluidos: relatoriaFila.filter(m => m.status_relatoria === 'rascunho_gerado').length,
  }), [relatoriaFila]);

  const filteredRelatoriaFila = useMemo(() => {
    let result = [...relatoriaFila];

    // Filtro por tipo
    if (relatoriaFilterTipo) result = result.filter(m => m.tipo_sigla === relatoriaFilterTipo);

    // Filtro por status
    if (relatoriaFilterStatus === 'pendentes') result = result.filter(m => m.status_relatoria === 'sem_rascunho');
    if (relatoriaFilterStatus === 'concluidos') result = result.filter(m => m.status_relatoria === 'rascunho_gerado');

    // Busca
    if (relatoriaSearchQuery.trim()) {
      const q = relatoriaSearchQuery.trim().toLowerCase();
      result = result.filter(m => {
        const numStr = `${m.tipo_sigla} ${m.numero}/${m.ano}`.toLowerCase();
        return numStr.includes(q) || (m.ementa || '').toLowerCase().includes(q) || String(m.numero).includes(q);
      });
    }

    // Ordenação
    result.sort((a, b) => {
      switch (relatoriaSortBy) {
        case 'data_desc': return (b.data_tramitacao || '').localeCompare(a.data_tramitacao || '');
        case 'data_asc': return (a.data_tramitacao || '').localeCompare(b.data_tramitacao || '');
        case 'numero_asc': return a.numero - b.numero;
        case 'numero_desc': return b.numero - a.numero;
      }
    });

    return result;
  }, [relatoriaFila, relatoriaSearchQuery, relatoriaSortBy, relatoriaFilterTipo, relatoriaFilterStatus]);

  useEffect(() => {
    async function loadConfig() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase.from('profiles').select('gabinete_id').eq('id', user.id).single();
        if (profile?.gabinete_id) {
          setGabineteId(profile.gabinete_id);
          const { data: gab } = await supabase.from('gabinetes').select('vereador_name, relator_nome_padrao').eq('id', profile.gabinete_id).single();
          if (gab) setRelatorNome(gab.relator_nome_padrao || gab.vereador_name || '');
        }
      } catch (err) {
        console.error('Falha ao carregar configurações de relator', err);
      }
      // Carrega comissões filtradas por membership do vereador
      try {
        const res = await fetch('/api/pareceres/minhas-comissoes');
        if (res.ok) {
          const data = await res.json();
          const comissoes: CommissionDynamic[] = data.comissoes || [];
          setComissoesDisponiveis(comissoes);
          if (comissoes.length > 0) {
            setRelatorComissao(comissoes[0].sigla);
            setComissaoComissao(comissoes[0].sigla);
          }
        }
      } catch (err) {
        console.error('Falha ao carregar comissões', err);
        // Fallback: tenta a API antiga
        try {
          const fallbackRes = await fetch('/api/pareceres/relatoria/comissoes');
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            const comissoes: CommissionDynamic[] = fallbackData.comissoes || [];
            setComissoesDisponiveis(comissoes);
            if (comissoes.length > 0) setRelatorComissao(comissoes[0].sigla);
          }
        } catch { /* sem ação */ }
      }
    }
    loadConfig();
  }, []);

  const loadRelatoriaFila = async (comissao: string) => {
    setRelatoriaFilaLoading(true);
    setRelatoriaFila([]);
    setSelectedMateriaFila(null);
    setMateriaContexto(null);
    try {
      const res = await fetch(`/api/pareceres/relatoria/fila?comissao=${encodeURIComponent(comissao)}`);
      if (res.ok) {
        const data = await res.json();
        // Ordena: PLLs/PLs primeiro (trâmite normal), PLEs ao final (urgência/executivo)
        const materias = (data.materias || []) as MateriaFila[];
        materias.sort((a: MateriaFila, b: MateriaFila) => {
          const aPLE = a.tipo_sigla === 'PLE' ? 1 : 0;
          const bPLE = b.tipo_sigla === 'PLE' ? 1 : 0;
          return aPLE - bPLE;
        });
        setRelatoriaFila(materias);
      }
    } catch {
      // silent fallback — fila fica vazia
    } finally {
      setRelatoriaFilaLoading(false);
    }
  };

  const loadMateriaContexto = async (materiaId: number) => {
    setMateriaContextoLoading(true);
    setMateriaContexto(null);
    try {
      const res = await fetch(`/api/pareceres/relatoria/materia/${materiaId}`);
      if (res.ok) {
        const data = await res.json();
        setMateriaContexto(data);
      }
    } catch {
      // silent fallback
    } finally {
      setMateriaContextoLoading(false);
    }
  };

  const handleSelecionarMateriaFila = (m: MateriaFila) => {
    setSelectedMateriaFila(m);
    setRelatorResult(null);
    setRelatorTitulo(null);
    loadMateriaContexto(m.id);
  };

  const handleBuscarPorId = async () => {
    const q = relatorBuscarId.trim();
    if (!q) return;
    setMateriaContextoLoading(true);
    setMateriaContexto(null);
    setRelatorResult(null);
    setRelatorTitulo(null);
    try {
      const res = await fetch(`/api/pareceres/relatoria/buscar?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok || !data.found) {
        alert(data.error || `Matéria "${q}" não encontrada. Verifique o número e o ano.`);
        setMateriaContextoLoading(false);
        return;
      }
      const m = data.materia ?? data.materias?.[0];
      if (!m) {
        alert('Nenhuma matéria encontrada.');
        setMateriaContextoLoading(false);
        return;
      }
      const fakeItem: MateriaFila = {
        id: m.id, tipo_sigla: m.tipo_sigla, numero: m.numero, ano: m.ano,
        ementa: m.ementa, autores: '',
        status_relatoria: 'sem_rascunho', rascunho_voto: null, rascunho_em: null,
        ultima_tramitacao: '', sapl_url: m.sapl_url,
      };
      setSelectedMateriaFila(fakeItem);
      setBuscarIdMode(false);
      setRelatorBuscarId('');
      // Carrega contexto completo
      const ctxRes = await fetch(`/api/pareceres/relatoria/materia/${m.id}`);
      if (ctxRes.ok) setMateriaContexto(await ctxRes.json());
    } catch {
      alert('Erro ao buscar matéria. Tente novamente.');
    } finally {
      setMateriaContextoLoading(false);
    }
  };

  // ── ESTADOS ABA COMISSÃO ──────────────────────────────────────────────────
  const [comissaoComissao, setComissaoComissao] = useState('CASP');
  const [comissaoFila, setComissaoFila] = useState<MateriaFila[]>([]);
  const [comissaoFilaLoading, setComissaoFilaLoading] = useState(false);
  const [isSyncingComissoes, setIsSyncingComissoes] = useState(false);

  const handleSyncComissoes = async () => {
    setIsSyncingComissoes(true);
    try {
      const res = await fetch('/api/comissoes/sync-membros', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        console.log('[sync-membros]', data);
        // Recarrega lista de comissões
        const res2 = await fetch('/api/pareceres/minhas-comissoes');
        if (res2.ok) {
          const d2 = await res2.json();
          const comissoes: CommissionDynamic[] = d2.comissoes || [];
          setComissoesDisponiveis(comissoes);
        }
      }
    } catch (err) {
      console.error('Falha ao sincronizar comissões', err);
    } finally {
      setIsSyncingComissoes(false);
    }
  };

  const loadComissaoFila = async (comissao: string) => {
    setComissaoFilaLoading(true);
    setComissaoFila([]);
    try {
      const res = await fetch(`/api/pareceres/relatoria/fila?comissao=${encodeURIComponent(comissao)}`);
      if (res.ok) { const d = await res.json(); setComissaoFila(d.materias || []); }
    } catch { /* silent */ } finally { setComissaoFilaLoading(false); }
  };

  // Recarrega fila quando a comissão ativa muda e aba relatoria está aberta
  useEffect(() => {
    if (abaPrincipal === 'relatoria' && relatorComissao) {
      loadRelatoriaFila(relatorComissao);
    }
    if (abaPrincipal === 'comissao' && comissaoComissao) {
      loadComissaoFila(comissaoComissao);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatorComissao, comissaoComissao, abaPrincipal]);

  const fetchHistorico = async () => {
    try {
      const res = await fetch('/api/pareceres/historico');
      if (res.ok) {
        const data = await res.json();
        setHistorico(data.results || []);
      }
    } catch {}
  };

  // 1. Restaurar parecer do sessionStorage ao montar
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PARECER_CACHE_KEY);
      if (raw) {
        const { parecer, titulo, sessao, total } = JSON.parse(raw);
        if (parecer) {
          setParecerResult(parecer);
          if (titulo) setSelectedOrdemTitulo(titulo);
          if (total) setCachedTotalMaterias(total);
          if (sessao) {
            setSelectedSessao(sessao);
            // Recarrega a ordem do dia para a sessão restaurada — evita "Pauta vazia" ao dar refresh
            setIsLoadingOrdem(true);
            fetch(`/api/pareceres/ordem-dia?sessao=${sessao.id}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => { if (data) setOrdemDoDia(data.materias || []); })
              .catch(() => {})
              .finally(() => setIsLoadingOrdem(false));
          }
        }
      }
    } catch {}
    fetchSessoes();
    fetchHistorico();
  }, []);

  // Polling SAPL desativado — contingência para reduzir requests automáticos.
  // Sync agora é 100% manual via botão "Sincronizar SAPL" na interface.
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     handleSincronizarSapl(true);
  //   }, 10 * 60 * 1000);
  //   return () => clearInterval(interval);
  // }, []);

  const handleSincronizarSapl = async (isAuto = false) => {
    if (!isAuto) setIsLoadingSessoes(true);
    try {
      // Nova rota que o Claude Code irá implementar
      await fetch('/api/pareceres/sync-sapl', { method: 'POST' });
    } catch (err) {
      console.error('Falha ao sincronizar SAPL', err);
    } finally {
      await fetchSessoes();
    }
  };

  const fetchSessoes = async () => {
    setIsLoadingSessoes(true);
    try {
      const [resOrdens, resSessoes] = await Promise.all([
        fetch('/api/pareceres/ordens-ativas'),
        fetch('/api/pareceres/sessoes')
      ]);
      
      if (resOrdens.ok) {
        const data = await resOrdens.json();
        setOrdensAtivas(data.results || []);
      }
      
      if (resSessoes.ok) {
        const data = await resSessoes.json();
        setSessoes(data.results || []);
      }
    } catch (err) {
      console.error('Failed to fetch sessions/ordens', err);
    } finally {
      setIsLoadingSessoes(false);
    }
  };

  // 2. Filtrar sessões visualmente pelo DatePicker
  const filteredOrdens = ordensAtivas.filter(s => {
    if (!dataFiltro) return true;
    return s.data_inicio === dataFiltro;
  });

  const filteredSessoes = sessoes.filter(s => {
    if (!dataFiltro) return true;
    return s.data_inicio === dataFiltro;
  });

  const ordensDoDiaParaMostrar = filteredOrdens.slice(0, 3);
  // Remove das demais sessões as que já estão aparecendo ativamente nas Ordens do Dia
  const ordensIds = ordensDoDiaParaMostrar.map(o => o.id);
  const demaisSessoesParaMostrar = filteredSessoes.filter(s => !ordensIds.includes(s.id));

  // 3. Ao clicar numa sessão -> Busca a Ordem do Dia dela
  const handleSelectSessao = async (sessao: any) => {
    setSelectedSessao(sessao);
    setSelectedOrdemTitulo(formatarDatasBR(sessao.__str__ || ''));
    setIsLoadingOrdem(true);
    setOrdemDoDia([]);
    setSelectedMaterias([]);

    try {
      const res = await fetch(`/api/pareceres/ordem-dia?sessao=${sessao.id}`);
      if (res.ok) {
        const data = await res.json();
        setOrdemDoDia(data.materias || []);
      }
    } catch (err) {
      console.error('Falha ao buscar OD', err);
    } finally {
      setIsLoadingOrdem(false);
    }
  };

  const toggleMateriaSelecionada = (materia: any) => {
    setSelectedMaterias(prev => {
      const exists = prev.find(m => m.id === materia.id);
      if (exists) return prev.filter(m => m.id !== materia.id);
      return [...prev, materia];
    });
  };

  const toggleSelecionarTodas = () => {
    if (selectedMaterias.length === ordemDoDia.length) {
      setSelectedMaterias([]);
    } else {
      setSelectedMaterias([...ordemDoDia]);
    }
  };

  // 4. Mandar para o NEXT.js GPT Server Action
  const handleGerarEmLote = async () => {
    if (selectedMaterias.length === 0) return;
    setIsGenerating(true);
    setParecerResult(null);

    try {
      const res = await fetch('/api/pareceres/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materia_ids: selectedMaterias.map((m: any) => m.id),
          data_sessao: selectedSessao?.data_inicio,
          sessao_str: selectedOrdemTitulo,
          folha_votacao_url: selectedSessao?.upload_pauta || null,
          model: modelType
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        setParecerResult(data.parecer);
        setCachedTotalMaterias(selectedMaterias.length);
        try {
          sessionStorage.setItem(PARECER_CACHE_KEY, JSON.stringify({
            parecer: data.parecer,
            titulo: selectedOrdemTitulo,
            sessao: selectedSessao,
            total: selectedMaterias.length,
          }));
        } catch {}
        fetchHistorico();
      } else {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.error('[Parecer Vereador] Gemini error:', errData);
        setParecerResult(`**ERRO:** ${errData.error || 'Falha ao comunicar com a IA (Endpoint Gemini)'}. Status: ${res.status}`);
      }
    } catch (err) {
      console.error(err);
      setParecerResult('**ERRO DE REDE:** Servidor não alcançável.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePdfUpload = async (file: File) => {
    setPdfFile(file);
    setPdfAviso(null);
    setIsExtractingPdf(true);
    setOrdemDoDia([]);
    setSelectedMaterias([]);
    setSelectedOrdemTitulo(`PDF: ${file.name}`);
    setSelectedSessao(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/pareceres/extrair-pdf', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setPdfAviso(data.error || 'Erro ao processar o PDF.');
        setSelectedOrdemTitulo(null);
        return;
      }
      if (data.aviso) setPdfAviso(data.aviso);
      if ((data.materias || []).length > 0) {
        setOrdemDoDia(data.materias);
        setActiveTab('sessoes'); // redireciona para a aba de seleção
      }
    } catch (err) {
      console.error(err);
      setPdfAviso('Erro de rede ao enviar o PDF.');
      setSelectedOrdemTitulo(null);
    } finally {
      setIsExtractingPdf(false);
    }
  };

  const handleGenerateFromLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlSapl) return;

    // Extrai ID numérico de URLs como:
    // https://sapl.boavista.rr.leg.br/materia/12345
    const match = urlSapl.match(/\/materia\/(\d+)/);
    if (!match) {
      alert('URL inválida. Use um link do tipo: https://sapl.boavista.rr.leg.br/materia/12345');
      return;
    }
    const materiaId = parseInt(match[1], 10);

    setIsGenerating(true);
    setParecerResult(null);
    setSelectedOrdemTitulo(`Matéria Avulsa #${materiaId}`);
    setSelectedSessao(null);

    try {
      const res = await fetch('/api/pareceres/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materia_ids: [materiaId],
          model: modelType,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setParecerResult(data.parecer);
        setCachedTotalMaterias(1);
        try {
          sessionStorage.setItem(PARECER_CACHE_KEY, JSON.stringify({
            parecer: data.parecer,
            titulo: `Matéria Avulsa #${materiaId}`,
            sessao: null,
            total: 1,
          }));
        } catch {}
        fetchHistorico();
      } else {
        setParecerResult('**ERRO:** Falha ao comunicar com a IA. Verifique se o ID da matéria é válido.');
      }
    } catch (err) {
      console.error(err);
      setParecerResult('**ERRO DE REDE:** Servidor não alcançável.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGerarRelator = async (modo: 'autonomo' | 'forcar_favoravel' | 'forcar_contrario' = 'autonomo') => {
    const id = selectedMateriaFila?.id ?? parseInt(relatorBuscarId, 10);
    if (!id || !relatorNome.trim()) return;
    setIsGerandoRelator(true);
    setRelatorResult(null);
    setRelatorRagDocs(null);
    const tipoStr = materiaContexto?.materia
      ? `${materiaContexto.materia.tipo_sigla} ${materiaContexto.materia.numero}/${materiaContexto.materia.ano}`
      : `Matéria #${id}`;
    const modoLabel = modo === 'forcar_favoravel' ? ' [FAVORÁVEL]' : modo === 'forcar_contrario' ? ' [CONTRÁRIO]' : '';
    setRelatorTitulo(`Relatoria ${relatorComissao} — ${tipoStr}${modoLabel}`);
    try {
      const res = await fetch('/api/pareceres/gerar-relator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materia_id: id,
          commission_sigla: relatorComissao,
          relator_nome: relatorNome,
          voto: relatorVoto,
          model: modelType,
          gabinete_id: gabineteId,
          modo,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRelatorResult(data.parecer_relator);
        setRelatorTitulo(`Relatoria ${data.commission} — ${data.materia_tipo}${modoLabel}`);
        if (data.rag_docs) setRelatorRagDocs(data.rag_docs);
      } else {
        setRelatorResult(`**ERRO:** ${data.error || 'Falha ao gerar parecer de relator.'}`);
      }
    } catch {
      setRelatorResult('**ERRO DE REDE:** Servidor não alcançável.');
    } finally {
      setIsGerandoRelator(false);
    }
  };

  const handleExportRelatorDocx = async () => {
    if (!relatorResult) { alert('Nenhum parecer gerado para exportar.'); return; }
    const comissao = comissoesDisponiveis.find(c => c.sigla === relatorComissao);
    const commissionNome = comissao?.nome || relatorComissao;
    try {
      const res = await fetch('/api/pareceres/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parecer: relatorResult,
          tipo: 'relatoria',
          commission_nome: commissionNome,
          commission_sigla: relatorComissao,
          gabinete_nome: relatorNome,
          titulo: relatorTitulo || `Relatoria_${relatorComissao}`,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        const errData = await res.json().catch(() => ({ error: `Erro HTTP ${res.status}` }));
        console.error('[DOCX Relator] Erro:', errData);
        alert(`Erro ao gerar DOCX: ${errData.error || 'Falha no servidor'}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(relatorTitulo || 'Relatoria').replace(/[^a-z0-9]/gi, '_')}.docx`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('[DOCX Relator] Exception:', err);
      alert('Erro ao gerar o DOCX. Verifique o console para detalhes.');
    }
  };

  const handleExportRelatorOdt = async () => {
    if (!relatorResult) { alert('Nenhum parecer gerado para exportar.'); return; }
    const comissao = comissoesDisponiveis.find(c => c.sigla === relatorComissao);
    const commissionNome = comissao?.nome || relatorComissao;
    try {
      const res = await fetch('/api/exportar/odt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'relatoria',
          titulo: relatorTitulo || `Parecer_${relatorComissao}`,
          dados: {
            titulo: relatorTitulo || `PARECER — ${relatorComissao}`,
            data_extenso: getDataExtenso(),
            municipio: 'Boa Vista',
            parlamentar: { nome_completo: relatorNome },
            comissao: { nome: commissionNome },
            cargo_relator: 'Relator',
            materia: {
              tipo_sigla: materiaContexto?.materia?.tipo_sigla || selectedMateriaFila?.tipo_sigla || '',
              numero: materiaContexto?.materia?.numero || selectedMateriaFila?.numero || '',
              ano: materiaContexto?.materia?.ano || selectedMateriaFila?.ano || '',
              ementa: materiaContexto?.materia?.ementa || selectedMateriaFila?.ementa || '',
            },
            voto: relatorVoto,
            texto_relatorio: relatorResult || '',
            texto_voto_fundamentado: '',
          },
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        const errData = await res.json().catch(() => ({ error: `Erro HTTP ${res.status}` }));
        console.error('[ODT Relator] Erro:', errData);
        alert(`Erro ao gerar ODT: ${errData.error || errData.detalhe || 'Falha no servidor'}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(relatorTitulo || 'Relatoria').replace(/[^a-z0-9]/gi, '_')}.odt`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('[ODT Relator] Exception:', err);
      alert('Erro ao gerar o ODT. Verifique o console para detalhes.');
    }
  };

  const handleExportDocx = async () => {
    if (!parecerResult) { alert('Nenhum parecer gerado para exportar.'); return; }

    try {
      const res = await fetch('/api/pareceres/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parecer: parecerResult,
          total_materias: selectedMaterias.length || cachedTotalMaterias,
          data_sessao: selectedSessao?.data_inicio || selectedOrdemTitulo,
        })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        const errData = await res.json().catch(() => ({ error: `Erro HTTP ${res.status}` }));
        console.error('[DOCX Vereador] Erro:', errData);
        alert(`Erro ao gerar DOCX: ${errData.error || 'Falha no servidor'}`);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dt = selectedSessao?.data_inicio
        ? selectedSessao.data_inicio.split('-').reverse().join('.')
        : (selectedOrdemTitulo || 'Reuniao');
      a.download = `Parecer_CMBV_${dt}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('[DOCX Vereador] Exception:', err);
      alert('Erro ao gerar o DOCX. Verifique o console para detalhes.');
    }
  };

  const handleExportOdt = async () => {
    if (!parecerResult) { alert('Nenhum parecer gerado para exportar.'); return; }

    try {
      const dt = selectedSessao?.data_inicio
        ? selectedSessao.data_inicio.split('-').reverse().join('.')
        : (selectedOrdemTitulo || 'Reuniao');

      const res = await fetch('/api/exportar/odt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'vereador',
          titulo: `Parecer_CMBV_${dt}`,
          dados: {
            titulo: `PARECER AVULSO — ${selectedMaterias[0]?.tipo_sigla || 'Múltiplas'}`,
            data_extenso: getDataExtenso(selectedSessao?.data_inicio),
            municipio: 'Boa Vista',
            parlamentar: { nome_completo: relatorNome || 'Vereador' },
            comissao: { nome: 'Plenário' },
            cargo_relator: 'Vereador',
            materia: {
              tipo_sigla: selectedMaterias[0]?.tipo_sigla || 'Pauta',
              numero: selectedMaterias[0]?.numero || '',
              ano: selectedMaterias[0]?.ano || '',
              ementa: selectedMaterias.map(m => m.ementa).join(' | ') || '',
            },
            voto: 'FAVORÁVEL', 
            texto_relatorio: parecerResult || '',
            texto_voto_fundamentado: '',
          },
        })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        const errData = await res.json().catch(() => ({ error: `Erro HTTP ${res.status}` }));
        console.error('[ODT Vereador] Erro:', errData);
        alert(`Erro ao gerar ODT: ${errData.error || errData.detalhe || 'Falha no servidor'}`);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Parecer_CMBV_${dt}.odt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('[ODT Vereador] Exception:', err);
      alert('Erro ao gerar o ODT. Verifique o console para detalhes.');
    }
  };

  return (
    <div className={styles.dashboardContainer}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.iconWrapper}>
            <FileText size={24} color="var(--primary-600)" />
          </div>
          <div>
            <h1 className={styles.title}>Painel de Pareceres</h1>
            <p className={styles.subtitle} style={{color: '#4b5563'}}>Extração de Matérias via SAPL</p>
          </div>
        </div>
        <button onClick={handleSyncComissoes} disabled={isSyncingComissoes}
          style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', background: isSyncingComissoes ? '#f1f5f9' : '#fff', cursor: isSyncingComissoes ? 'wait' : 'pointer', fontSize: '0.78rem', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}
          title="Sincronizar composição de comissões do SAPL">
          {isSyncingComissoes ? <Loader2 size={14} className={styles.spinIcon} /> : <Users size={14} />}
          {isSyncingComissoes ? 'Sincronizando...' : 'Sync Comissões'}
        </button>
      </header>

      {/* Navegação por abas principais */}
      <div role="tablist" aria-label="Seções do Painel de Pareceres" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid #e5e7eb', marginBottom: '20px' }}>
        {[
          { id: 'alia',      label: <span style={{display:'flex',alignItems:'center',gap:'8px'}}><Shield size={16}/> ALIA</span>,        title: 'Triagem de pautas identificadas por IA' },
          { id: 'vereador',  label: <span style={{display:'flex',alignItems:'center',gap:'8px'}}><Search size={16}/> Discussão e Votação</span>,    title: 'Discussão e Votação — Ordem do Dia, PDF ou Link' },
          { id: 'relatoria', label: <span style={{display:'flex',alignItems:'center',gap:'8px'}}><Gavel size={16}/> Relatoria</span>,   title: 'Parecer do Relator de Comissão' },
          { id: 'comissao',  label: <span style={{display:'flex',alignItems:'center',gap:'8px'}}><Building2 size={16}/> Comissão</span>, title: 'Parecer da Comissão + ATA da Reunião' },
        ].map(aba => (
          <button
            key={aba.id}
            role="tab"
            aria-selected={abaPrincipal === aba.id}
            aria-controls={`tabpanel-${aba.id}`}
            title={aba.title}
            onClick={() => setAbaPrincipal(aba.id as 'alia' | 'vereador' | 'relatoria' | 'comissao')}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderBottom: abaPrincipal === aba.id ? '3px solid var(--primary-600, #1c4076)' : '3px solid transparent',
              background: 'none',
              cursor: 'pointer',
              fontWeight: abaPrincipal === aba.id ? 700 : 500,
              color: abaPrincipal === aba.id ? 'var(--primary-700, #1c4076)' : '#6b7280',
              fontSize: '0.9rem',
              marginBottom: '-2px',
              transition: 'color 0.15s',
            }}
          >
            {aba.label}
          </button>
        ))}
      </div>

      {abaPrincipal === 'alia' ? (
         <PareceresModeracao />
      ) : abaPrincipal === 'relatoria' ? (
        /* ── ABA RELATORIA v3 — Redesign 2 painéis ─────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, minHeight: 0 }}>

          {/* Painel Pareceres Gerados (colapsável) */}
          {historico.length > 0 && (
            <div style={{ marginBottom: 16, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <button
                onClick={() => setIsHistoricoOpen(h => !h)}
                style={{ width: '100%', padding: '10px 16px', background: '#f8fafc', border: 'none', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', fontWeight: 700, color: '#374151' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <History size={15} /> Pareceres Gerados ({historico.length})
                </span>
                <ChevronRight size={14} style={{ transform: isHistoricoOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} />
              </button>
              {isHistoricoOpen && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, padding: 12 }}>
                  {historico.slice(0, 12).map((h: any) => (
                    <div key={h.id}
                      style={{ padding: '10px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                        fontSize: '0.76rem', cursor: 'pointer', transition: 'all 0.15s', position: 'relative' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1c4076'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(28,64,118,0.12)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, color: '#1c4076', flex: 1 }}>{h.sessao_str || h.data_sessao || 'Sessão'}</div>
                        <button title="Deletar parecer" onClick={e => { e.stopPropagation(); setItemToDelete(h); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9ca3af', borderRadius: 4, transition: 'color 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
                        ><Trash2 size={13} /></button>
                      </div>
                      <div style={{ color: '#6b7280' }}>{h.total_materias} matéria(s) · {h.model_usado || 'flash'}</div>
                      <div style={{ color: '#9ca3af', fontSize: '0.68rem', marginTop: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{new Date(h.gerado_em).toLocaleDateString('pt-BR')}</span>
                        <button title="Recarregar em tela" onClick={e => { e.stopPropagation(); if (h.parecer_md) { setRelatorResult(h.parecer_md); setRelatorTitulo(h.sessao_str || h.data_sessao || 'Parecer Histórico'); } else { alert('Este parecer não possui conteúdo salvo.'); } }}
                          style={{ background: '#f0f7ff', border: '1px solid #1c4076', cursor: 'pointer', padding: '3px 8px', color: '#1c4076', borderRadius: 4, fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600 }}
                        ><Eye size={11} /> Abrir</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tabs de comissões + botão buscar por ID + Upload PDF */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', borderBottom: '1px solid #e2e8f0', marginBottom: 16, flexWrap: 'wrap' }}>
            {comissoesDisponiveis.map(c => (
              <button key={c.sigla}
                onClick={() => { setRelatorComissao(c.sigla); setRelatorResult(null); setRelatorTitulo(null); setRelatoriaSearchQuery(''); setRelatoriaFilterTipo(null); setRelatoriaFilterStatus('todos'); }}
                style={{
                  padding: '6px 14px', border: 'none',
                  borderBottom: relatorComissao === c.sigla ? '3px solid #1c4076' : '3px solid transparent',
                  background: 'none', cursor: 'pointer',
                  fontWeight: relatorComissao === c.sigla ? 700 : 500,
                  color: relatorComissao === c.sigla ? '#1c4076' : '#6b7280',
                  fontSize: '0.85rem', marginBottom: -1, whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
                title={`${c.nome}${c.meu_cargo ? ` — ${c.meu_cargo}` : ''}`}
              >
                {c.sigla}
                {c.meu_cargo && c.meu_cargo !== 'acesso_geral' && (
                  <span style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                    background: c.meu_cargo === 'presidente' ? '#15803d' : c.meu_cargo === 'vice-presidente' ? '#1d4ed8' : '#94a3b8',
                  }} title={c.meu_cargo} />
                )}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', color: '#374151', fontSize: '0.8rem', cursor: pdfUploadLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: pdfUploadLoading ? 0.7 : 1 }} title="Envie o PDF da matéria para identificação automática">
                {pdfUploadLoading ? <Loader2 size={13} className={styles.spinIcon} /> : <UploadCloud size={13} />}
                {pdfUploadLoading ? 'Lendo PDF…' : 'Upload PDF'}
                <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} disabled={pdfUploadLoading}
                  onChange={async e => {
                    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
                    setPdfUploadLoading(true);
                    try {
                      const fd = new FormData(); fd.append('file', file);
                      const res = await fetch('/api/pareceres/relatoria/upload-pdf', { method: 'POST', body: fd });
                      const data = await res.json();
                      if (data.found && data.materia_id) {
                        const fakeItem: MateriaFila = { id: data.materia_id, tipo_sigla: data.tipo, numero: data.numero, ano: data.ano, ementa: data.ementa, autores: '', status_relatoria: 'sem_rascunho', rascunho_voto: null, rascunho_em: null, ultima_tramitacao: '', sapl_url: data.sapl_url };
                        setSelectedMateriaFila(fakeItem); setRelatorResult(null); setRelatorTitulo(null); loadMateriaContexto(data.materia_id);
                      } else { const hint = data.suggested_query ? ` Tente buscar por: ${data.suggested_query}` : ''; alert((data.message || data.error || 'Não foi possível identificar a matéria no PDF.') + hint); }
                    } catch { alert('Erro ao enviar o PDF. Tente novamente.'); } finally { setPdfUploadLoading(false); }
                  }}
                />
              </label>
              <button onClick={() => setBuscarIdMode(b => !b)}
                style={{ padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: buscarIdMode ? '#1c4076' : '#fff', color: buscarIdMode ? '#fff' : '#374151', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
              ><Link2 size={13} /> Buscar por ID</button>
            </div>
            {buscarIdMode && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', width: '100%', paddingTop: 6 }}>
                <input type="text" placeholder="PLL 32/2026 ou ID" value={relatorBuscarId}
                  onChange={e => setRelatorBuscarId(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleBuscarPorId()}
                  style={{ width: 160, padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.85rem' }} autoFocus />
                <button onClick={handleBuscarPorId}
                  style={{ padding: '5px 12px', background: '#1c4076', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem' }}>Buscar</button>
              </div>
            )}
          </div>

          {/* ════════ GRID 2 PAINÉIS ════════ */}
          <div className={styles.relatoriaGrid}>

            {/* ── SIDEBAR ESQUERDA (280px) ── */}
            <div className={styles.relatoriaSidebar}>
              {/* Header */}
              <div className={styles.relatoriaSidebarHeader}>
                <span className={styles.relatoriaSidebarHeaderTitle}>Fila — {relatorComissao}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {relatoriaStatusCounts.pendentes > 0 && (
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#b91c1c', background: '#fef2f2', padding: '2px 8px', borderRadius: 10 }}>
                      {relatoriaStatusCounts.pendentes} pendente{relatoriaStatusCounts.pendentes > 1 ? 's' : ''}
                    </span>
                  )}
                  <button onClick={() => loadRelatoriaFila(relatorComissao)} disabled={relatoriaFilaLoading} title="Atualizar fila do SAPL"
                    style={{ background: 'none', border: 'none', cursor: relatoriaFilaLoading ? 'wait' : 'pointer', padding: 2, color: '#6b7280', display: 'flex', alignItems: 'center' }}>
                    {relatoriaFilaLoading ? <Loader2 size={14} className={styles.spinIcon} /> : <RefreshCw size={14} />}
                  </button>
                </div>
              </div>

              {/* Body: busca, chips, progresso */}
              <div className={styles.relatoriaSidebarBody}>
                {/* Busca */}
                <div className={styles.relatoriaSearchWrapper}>
                  <Search size={14} className={styles.relatoriaSearchIcon} />
                  <input type="text" className={styles.relatoriaSearchInput}
                    placeholder="Buscar número, ementa..."
                    value={relatoriaSearchQuery} onChange={e => setRelatoriaSearchQuery(e.target.value)} />
                </div>

                {/* Chips de tipo */}
                <div className={styles.relatoriaChips}>
                  <button className={`${styles.relatoriaChip} ${!relatoriaFilterTipo ? styles.relatoriaChipActive : ''}`}
                    onClick={() => setRelatoriaFilterTipo(null)}>
                    Todos ({relatoriaFila.length})
                  </button>
                  {Object.entries(relatoriaTiposCounts).map(([tipo, count]) => (
                    <button key={tipo}
                      className={`${styles.relatoriaChip} ${relatoriaFilterTipo === tipo ? styles.relatoriaChipActive : ''}`}
                      onClick={() => setRelatoriaFilterTipo(relatoriaFilterTipo === tipo ? null : tipo)}>
                      {tipo} ({count})
                    </button>
                  ))}
                </div>

                {/* Chips de status */}
                <div className={styles.relatoriaChips}>
                  <button className={`${styles.relatoriaChip} ${relatoriaFilterStatus === 'todos' ? styles.relatoriaChipActive : ''}`}
                    onClick={() => setRelatoriaFilterStatus('todos')}>Todos</button>
                  <button className={`${styles.relatoriaChip} ${relatoriaFilterStatus === 'pendentes' ? styles.relatoriaStatusChipPendente : ''}`}
                    onClick={() => setRelatoriaFilterStatus(relatoriaFilterStatus === 'pendentes' ? 'todos' : 'pendentes')}>
                    Pendentes ({relatoriaStatusCounts.pendentes})
                  </button>
                  <button className={`${styles.relatoriaChip} ${relatoriaFilterStatus === 'concluidos' ? styles.relatoriaStatusChipConcluido : ''}`}
                    onClick={() => setRelatoriaFilterStatus(relatoriaFilterStatus === 'concluidos' ? 'todos' : 'concluidos')}>
                    Concluídos ({relatoriaStatusCounts.concluidos})
                  </button>
                </div>

                {/* Sort + Progress */}
                <div className={styles.relatoriaSortRow}>
                  <select className={styles.relatoriaSortSelect} value={relatoriaSortBy}
                    onChange={e => setRelatoriaSortBy(e.target.value as any)}>
                    <option value="data_desc">Mais recentes</option>
                    <option value="data_asc">Mais antigas</option>
                    <option value="numero_desc">Número ↓</option>
                    <option value="numero_asc">Número ↑</option>
                  </select>
                  <div className={styles.relatoriaProgressContainer}>
                    <div className={styles.relatoriaProgressBar}>
                      <div className={styles.relatoriaProgressFill}
                        style={{ width: relatoriaFila.length > 0 ? `${(relatoriaStatusCounts.concluidos / relatoriaFila.length) * 100}%` : '0%' }} />
                    </div>
                    <span className={styles.relatoriaProgressLabel}>
                      {relatoriaStatusCounts.concluidos}/{relatoriaFila.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Lista de Matérias */}
              <div className={styles.relatoriaList}>
                {!relatoriaFilaLoading && filteredRelatoriaFila.length === 0 && (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>
                    <Gavel size={28} color="#d1d5db" style={{ marginBottom: 8 }} />
                    <p style={{ margin: 0 }}>
                      {relatoriaFila.length === 0 ? 'Nenhuma matéria na fila.' : 'Nenhuma matéria corresponde aos filtros.'}
                    </p>
                    {relatoriaFila.length === 0 && <p style={{ margin: '4px 0 0', fontSize: '0.73rem' }}>Use "Buscar por ID" para localizar uma matéria específica.</p>}
                  </div>
                )}
                {relatoriaFilaLoading && (
                  <div style={{ padding: '32px 12px', textAlign: 'center' }}>
                    <Loader2 size={24} color="#94a3b8" className={styles.spinIcon} />
                    <p style={{ color: '#9ca3af', fontSize: '0.78rem', marginTop: 8 }}>Carregando fila...</p>
                  </div>
                )}
                {filteredRelatoriaFila.map((m) => {
                  const isSelected = selectedMateriaFila?.id === m.id;
                  const isPendente = m.status_relatoria === 'sem_rascunho';
                  const isOld = m.data_tramitacao && (Date.now() - new Date(m.data_tramitacao).getTime()) > 180 * 24 * 60 * 60 * 1000;
                  return (
                    <button key={m.id}
                      onClick={() => handleSelecionarMateriaFila(m)}
                      className={`${styles.relatoriaItem} ${isSelected ? styles.relatoriaItemSelected : ''} ${!isSelected && isPendente ? styles.relatoriaItemPendente : ''} ${!isSelected && !isPendente ? styles.relatoriaItemConcluido : ''} ${isOld ? styles.relatoriaItemOld : ''}`}
                    >
                      <div className={styles.relatoriaItemHeader}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                          <span className={`${styles.relatoriaItemNumber} ${m.tipo_sigla === 'PLE' ? styles.relatoriaItemNumberPle : ''}`}>
                            {m.tipo_sigla} {m.numero}/{m.ano}
                          </span>
                          {isPendente ? (
                            <span className={`${styles.relatoriaItemBadge} ${styles.relatoriaItemBadgePendente}`}>Pendente</span>
                          ) : m.rascunho_voto?.includes('FAVORÁVEL') ? (
                            <span className={`${styles.relatoriaItemBadge} ${styles.relatoriaItemBadgeFavoravel}`}>✓ Favorável</span>
                          ) : m.rascunho_voto?.includes('CONTRÁRIO') ? (
                            <span className={`${styles.relatoriaItemBadge} ${styles.relatoriaItemBadgeContrario}`}>✗ Contrário</span>
                          ) : (
                            <span className={`${styles.relatoriaItemBadge} ${styles.relatoriaItemBadgeFavoravel}`}>✓ Concluído</span>
                          )}
                          {m.tipo_sigla === 'PLE' && (
                            <span className={`${styles.relatoriaItemBadge} ${styles.relatoriaItemBadgePle}`}>⚡ Urgente</span>
                          )}
                        </div>
                      </div>
                      <p className={styles.relatoriaItemEmenta}>{m.ementa || '(sem ementa)'}</p>
                      <div className={styles.relatoriaItemMeta}>
                        {m.data_tramitacao && <span>{formatarDatasBR(m.data_tramitacao)}</span>}
                        {m.autores && <><span>·</span><span>{m.autores}</span></>}
                      </div>
                    </button>
                  );
                })}

                {/* Matéria avulsa (busca por ID) não presente na fila */}
                {selectedMateriaFila && !relatoriaFila.find(m => m.id === selectedMateriaFila.id) && (
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', background: '#eff6ff', borderLeft: '3px solid #1c4076' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1c4076' }}>Matéria #{selectedMateriaFila.id}</span>
                    <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: '#6b7280' }}>
                      {materiaContexto?.materia?.ementa ? materiaContexto.materia.ementa.substring(0, 80) + '...' : 'Carregando...'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── ÁREA PRINCIPAL (flex: 1) ── */}
            <div className={styles.relatoriaMain}>

              {/* Estado vazio */}
              {!selectedMateriaFila && !materiaContextoLoading && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: '#9ca3af', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '48px 24px 24px' }}>
                  <Gavel size={40} color="#d1d5db" />
                  <p style={{ margin: '12px 0 0', fontSize: '0.92rem', fontWeight: 600, color: '#6b7280' }}>Selecione uma matéria</p>
                  <p style={{ margin: '4px 0 0', fontSize: '0.78rem' }}>Clique em uma matéria na fila à esquerda para ver o contexto e gerar parecer.</p>
                </div>
              )}

              {/* Carregando */}
              {materiaContextoLoading && (
                <div style={{ padding: '48px 24px', textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
                  <Loader2 size={32} color="#94a3b8" className={styles.spinIcon} />
                  <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: 12 }}>Buscando dados no SAPL...</p>
                </div>
              )}

              {/* Conteúdo com matéria selecionada */}
              {materiaContexto && !materiaContextoLoading && (<>

                {/* 2.1 Header da Matéria */}
                <div className={styles.relatoriaMainHeader}>
                  <div className={styles.relatoriaMainTitle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={styles.relatoriaMainTitleText}>
                        {materiaContexto.materia.tipo_sigla} {materiaContexto.materia.numero}/{materiaContexto.materia.ano}
                      </span>
                      {materiaContexto.materia.tipo_sigla === 'PLE' && (
                        <span className={`${styles.relatoriaItemBadge} ${styles.relatoriaItemBadgePle}`}>⚡ Executivo — urgência</span>
                      )}
                      {selectedMateriaFila && (
                        selectedMateriaFila.status_relatoria === 'sem_rascunho'
                          ? <span className={`${styles.relatoriaItemBadge} ${styles.relatoriaItemBadgePendente}`}>Sem parecer</span>
                          : <span className={`${styles.relatoriaItemBadge} ${styles.relatoriaItemBadgeFavoravel}`}>Parecer gerado</span>
                      )}
                    </div>
                    <a href={materiaContexto.materia.sapl_url} target="_blank" rel="noopener noreferrer"
                      style={{ flexShrink: 0, padding: '5px 12px', border: '1px solid #bfdbfe', borderRadius: 6, background: '#eff6ff', color: '#1c4076', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      <ExternalLink size={13} /> SAPL
                    </a>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
                    {materiaContexto.materia.ementa}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#94a3b8' }}>
                    {materiaContexto.materia.autores || '—'} · {materiaContexto.materia.regime} {materiaContexto.materia.tipo_descricao && `· ${materiaContexto.materia.tipo_descricao}`}
                  </p>
                </div>

                {/* 2.2 Contexto Compacto */}
                <div className={styles.relatoriaContexto}>
                  <div className={styles.relatoriaContextoInline}>
                    {/* Procuradoria badge */}
                    <span style={{ fontWeight: 600 }}>Proc:</span>
                    {materiaContexto.procuradoria.voto ? (
                      <span style={{ fontWeight: 700, fontSize: '0.78rem',
                        color: materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '#15803d' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '#b91c1c' : '#92400e' }}>
                        {materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '✓' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '✗' : '⚠'} {materiaContexto.procuradoria.voto}
                      </span>
                    ) : <span style={{ color: '#9ca3af' }}>N/A</span>}

                    {/* Outras comissões */}
                    {materiaContexto.outras_comissoes.length > 0 && (<>
                      <span className={styles.relatoriaContextoSep}>·</span>
                      {materiaContexto.outras_comissoes.map((oc, i) => (
                        <span key={i} style={{ fontSize: '0.75rem', fontWeight: 600,
                          color: oc.voto.includes('FAVORÁVEL') || oc.voto.includes('APROVADO') ? '#15803d' : oc.voto.includes('CONTRÁRIO') ? '#b91c1c' : '#92400e' }}>
                          {oc.comissao}✓
                        </span>
                      ))}
                    </>)}

                    <span className={styles.relatoriaContextoSep}>·</span>
                    <span>{materiaContexto.tramitacoes.length} tramitaç{materiaContexto.tramitacoes.length === 1 ? 'ão' : 'ões'}</span>

                    {relatorRagDocs && (<>
                      <span className={styles.relatoriaContextoSep}>·</span>
                      <span>{relatorRagDocs.total_docs_analisados} doc{relatorRagDocs.total_docs_analisados !== 1 ? 's' : ''} IA</span>
                    </>)}

                    <button className={styles.relatoriaContextoToggle} onClick={() => setContextoExpandido(x => !x)}>
                      {contextoExpandido ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {contextoExpandido ? 'Ocultar' : 'Ver detalhes'}
                    </button>
                  </div>

                  {/* Detalhes expandidos */}
                  {contextoExpandido && (
                    <div className={styles.relatoriaContextoExpanded}>
                      {/* Procuradoria */}
                      <div>
                        <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Procuradoria Jurídica</p>
                        {materiaContexto.procuradoria.voto ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
                            background: materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '#f0fdf4' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '#fef2f2' : '#fffbeb',
                            border: `1px solid ${materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '#bbf7d0' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '#fecaca' : '#fde68a'}` }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 700,
                              color: materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '#15803d' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '#b91c1c' : '#92400e' }}>
                              {materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '✓' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '✗' : '⚠'} {materiaContexto.procuradoria.voto}
                            </span>
                          </div>
                        ) : <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Não encontrado nas tramitações</span>}
                      </div>

                      {/* Outras comissões */}
                      {materiaContexto.outras_comissoes.length > 0 && (
                        <div>
                          <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pareceres de outras comissões</p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {materiaContexto.outras_comissoes.map((oc, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 10px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                <span style={{ fontSize: '0.78rem', color: '#374151' }}>{oc.comissao}</span>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700,
                                  color: oc.voto.includes('FAVORÁVEL') || oc.voto.includes('APROVADO') ? '#15803d' : oc.voto.includes('CONTRÁRIO') ? '#b91c1c' : '#92400e' }}>{oc.voto}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tramitações */}
                      <div>
                        <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tramitações recentes</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflowY: 'auto' }}>
                          {materiaContexto.tramitacoes.slice(0, 8).map((t, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.76rem', padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                              <span style={{ color: '#9ca3af', flexShrink: 0, width: 72 }}>{t.data}</span>
                              <span style={{ color: '#374151', lineHeight: 1.35 }}>{t.texto}</span>
                            </div>
                          ))}
                          {materiaContexto.tramitacoes.length === 0 && <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Sem tramitações registradas.</span>}
                        </div>
                      </div>

                      {/* RAG docs */}
                      {relatorRagDocs && (
                        <div>
                          <p style={{ margin: '0 0 8px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span>🔍</span> Documentos analisados pela IA
                          </p>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 999, fontWeight: 600, background: relatorRagDocs.procuradoria_encontrada ? '#dcfce7' : '#fee2e2', color: relatorRagDocs.procuradoria_encontrada ? '#15803d' : '#b91c1c' }}>
                              {relatorRagDocs.procuradoria_encontrada ? '✓' : '✗'} Procuradoria
                            </span>
                            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 999, fontWeight: 600, background: relatorRagDocs.cljrf_encontrado ? '#dcfce7' : '#fee2e2', color: relatorRagDocs.cljrf_encontrado ? '#15803d' : '#b91c1c' }}>
                              {relatorRagDocs.cljrf_encontrado ? '✓' : '✗'} CLJRF
                            </span>
                            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 999, fontWeight: 600, background: '#f0f9ff', color: '#0369a1' }}>
                              {relatorRagDocs.total_texto_extraido}/{relatorRagDocs.total_docs_analisados} com texto extraído
                            </span>
                          </div>
                          {relatorRagDocs.procuradoria.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <p style={{ margin: '0 0 4px', fontSize: '0.69rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Procuradoria</p>
                              {relatorRagDocs.procuradoria.map((d, i) => (
                                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 6px', background: '#fff', borderRadius: 5, marginBottom: 3, fontSize: '0.74rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: '#374151', flex: 1 }}>{d.nome}</span>
                                    <span style={{ fontSize: '0.67rem', padding: '1px 5px', borderRadius: 999, flexShrink: 0, background: d.texto_extraido ? '#dcfce7' : '#fef3c7', color: d.texto_extraido ? '#15803d' : '#92400e' }}>{d.texto_extraido ? 'Texto OK' : 'PDF imagem'}</span>
                                  </div>
                                  {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', fontSize: '0.67rem', textDecoration: 'underline' }}>Ver no SAPL</a>}
                                  {d.trecho && <span style={{ color: '#6b7280', fontSize: '0.67rem', fontStyle: 'italic', borderLeft: '2px solid #d1d5db', paddingLeft: 6, marginTop: 2 }}>{d.trecho.slice(0, 200)}…</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {relatorRagDocs.comissoes.length > 0 && (
                            <div>
                              <p style={{ margin: '0 0 4px', fontSize: '0.69rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Comissões</p>
                              {relatorRagDocs.comissoes.map((d, i) => (
                                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 6px', background: '#fff', borderRadius: 5, marginBottom: 3, fontSize: '0.74rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: '#374151', flex: 1 }}>{d.nome}</span>
                                    <span style={{ fontSize: '0.67rem', padding: '1px 5px', borderRadius: 999, flexShrink: 0, background: d.texto_extraido ? '#dcfce7' : '#fef3c7', color: d.texto_extraido ? '#15803d' : '#92400e' }}>{d.texto_extraido ? 'Texto OK' : 'PDF imagem'}</span>
                                  </div>
                                  {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', fontSize: '0.67rem', textDecoration: 'underline' }}>Ver no SAPL</a>}
                                  {d.trecho && <span style={{ color: '#6b7280', fontSize: '0.67rem', fontStyle: 'italic', borderLeft: '2px solid #d1d5db', paddingLeft: 6, marginTop: 2 }}>{d.trecho.slice(0, 200)}…</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {relatorRagDocs.total_docs_analisados === 0 && <p style={{ fontSize: '0.74rem', color: '#9ca3af', margin: 0 }}>Nenhum documento acessório encontrado para esta matéria.</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 2.3 Bloco Gerar Parecer */}
                <div className={styles.relatoriaGerarCard}>
                  <div className={styles.relatoriaGerarHeader}>
                    <span className={styles.relatoriaGerarTitle}><Gavel size={16} /> Gerar Parecer</span>
                    {relatorNome ? (
                      <span className={styles.relatoriaGerarRelator}>Relator: {relatorNome}</span>
                    ) : (
                      <input type="text" placeholder="Nome do relator"
                        value={relatorNome} onChange={e => setRelatorNome(e.target.value)}
                        style={{ padding: '4px 10px', border: '1px solid #c7d2e0', borderRadius: 6, fontSize: '0.78rem', background: '#fff', width: 180 }} />
                    )}
                    <select className={styles.relatoriaGerarModelSelect} value={modelType} onChange={e => setModelType(e.target.value)}>
                      <option value="flash">Flash</option>
                      <option value="pro">Pro</option>
                    </select>
                  </div>

                  {/* Aviso rascunho existente */}
                  {materiaContexto.rascunhos.length > 0 && (
                    <div style={{ padding: '6px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, marginBottom: 10, fontSize: '0.74rem', color: '#92400e' }}>
                      Rascunho existente ({materiaContexto.rascunhos[0].commission_sigla} — {materiaContexto.rascunhos[0].voto}, {new Date(materiaContexto.rascunhos[0].created_at).toLocaleDateString('pt-BR')}). Gerar novamente substituirá.
                    </div>
                  )}

                  <div className={styles.relatoriaGerarButtons}>
                    <button onClick={() => handleGerarRelator('autonomo')}
                      className={styles.relatoriaGerarBtnPrimary}
                      disabled={isGerandoRelator || !relatorNome.trim() || !selectedMateriaFila}>
                      {isGerandoRelator ? <><Loader2 size={15} className={styles.spinIcon} /> Elaborando...</> : <><BrainCircuit size={15} /> Analisar pela Atribuição</>}
                    </button>
                    <button onClick={() => handleGerarRelator('forcar_favoravel')}
                      className={styles.relatoriaGerarBtnFavoravel}
                      disabled={isGerandoRelator || !relatorNome.trim() || !selectedMateriaFila}>
                      <CheckCircle size={14} /> Favorável
                    </button>
                    <button onClick={() => handleGerarRelator('forcar_contrario')}
                      className={styles.relatoriaGerarBtnContrario}
                      disabled={isGerandoRelator || !relatorNome.trim() || !selectedMateriaFila}>
                      <FileWarning size={14} /> Contrário
                    </button>
                  </div>

                  {!relatorNome.trim() && (
                    <p style={{ margin: '8px 0 0', fontSize: '0.7rem', color: '#b91c1c', textAlign: 'center' }}>
                      Configure o nome do relator nas configurações do gabinete.
                    </p>
                  )}

                  {/* Nota comissão */}
                  {(() => {
                    const c = comissoesDisponiveis.find(x => x.sigla === relatorComissao);
                    return c ? (
                      <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(255,255,255,0.6)', borderRadius: 6, fontSize: '0.7rem', color: '#475569', lineHeight: 1.5 }}>
                        <strong>{c.sigla}</strong> — {c.area || c.nome} · Regimento Interno CMBV
                      </div>
                    ) : null;
                  })()}
                </div>

                {/* 2.4 Resultado do Parecer */}
                {isGerandoRelator && (
                  <div className={styles.relatoriaResultCard} style={{ padding: '32px 16px', textAlign: 'center' }}>
                    <LogoLoader size={72} />
                    <p style={{ color: '#6b7280', fontSize: '0.82rem', marginTop: 12 }}>Buscando dados no SAPL e elaborando o parecer...</p>
                  </div>
                )}
                {relatorResult && !isGerandoRelator && (
                  <div className={styles.documentViewer}>
                    <div className={styles.documentHeader}>
                      <div className={styles.documentTitleGroup}>
                        <span className={styles.documentSparkle}>✦</span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1f2937' }}>PARECER DE RELATOR</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={handleExportRelatorOdt} className={styles.exportButton} style={{ background: '#0284c7', color: 'white', borderColor: '#0369a1' }}>
                          <FileText size={15} /> SAPL (.odt)
                        </button>
                        <button onClick={handleExportRelatorDocx} className={styles.exportButton}>
                          <Download size={15} /> DOCX
                        </button>
                      </div>
                    </div>
                    <A4DocumentViewer>
                      <div style={{ marginBottom: 32, borderBottom: '2px solid #e2e8f0', paddingBottom: 16 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1c4076', textTransform: 'uppercase' }}>
                          Relatoria — {relatorComissao}
                        </span>
                        <h3 style={{ margin: '4px 0 0', fontSize: '1.1rem' }}>{relatorTitulo}</h3>
                      </div>
                      <div className={styles.markdownContent}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{relatorResult}</ReactMarkdown>
                      </div>
                    </A4DocumentViewer>
                  </div>
                )}
              </>)}
            </div>
          </div>
        </div>
      ) : abaPrincipal === 'comissao' ? (
        <ComissaoWizard
          comissaoSigla={comissaoComissao}
          comissaoFila={comissaoFila}
          comissaoFilaLoading={comissaoFilaLoading}
          comissoesDisponiveis={comissoesDisponiveis}
          onComissaoChange={(sigla) => { setComissaoComissao(sigla); }}
          gabineteNome={relatorNome}
        />
      ) : (
      <div className={styles.mainGrid}>
        {/* Painel Esquerdo (Inputs e Configs) */}
        <section className={styles.inputSection} style={isPanelCollapsed ? { width: '48px', minWidth: '48px', overflow: 'hidden' } : undefined}>

          {/* Botão toggle do painel */}
          <button
            onClick={togglePanel}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: isPanelCollapsed ? '36px' : '100%',
              height: '36px', gap: '8px',
              background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
              cursor: 'pointer', color: '#64748b', fontSize: '0.75rem', fontWeight: 600,
              transition: 'all 0.25s ease-out', marginBottom: isPanelCollapsed ? '0' : '8px',
              flexShrink: 0
            }}
            title={isPanelCollapsed ? 'Expandir painel' : 'Recolher painel'}
          >
            {isPanelCollapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={16} /> Recolher painel</>}
          </button>

          {isPanelCollapsed ? null : (<>
          {/* Conteúdo do painel (ocultado quando recolhido) */}
          
          {/* TABS DE NAVEGAÇÃO DA ORIGEM */}
          <div className={styles.tabsContainer}>
            <button 
              className={`${styles.tabBtn} ${activeTab === 'sessoes' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('sessoes')}
            >
              <Calendar size={16} /> Ordem do Dia
            </button>
            <button 
              className={`${styles.tabBtn} ${activeTab === 'pdf' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('pdf')}
            >
              <UploadCloud size={16} /> Pauta em PDF
            </button>
            <button 
              className={`${styles.tabBtn} ${activeTab === 'link' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('link')}
            >
              <Link2 size={16} /> Link Direto
            </button>
          </div>

          <div className={styles.formCard}>
            
            {/* INÍCIO: Conteúdo das Abas */}

            {/* ABA 1: SESSÕES (ORDEM DO DIA) */}
            {activeTab === 'sessoes' && (
              <div className={styles.tabContent}>
                
                {!selectedOrdemTitulo ? (
                  <>
                    <div className={styles.formGroup} style={{ marginBottom: '24px' }}>
                      <label>Filtrar Pautas por Data</label>
                      <div className={styles.inputWithIcon}>
                        <Calendar className={styles.inputIcon} size={18} />
                        <input 
                          type="date" 
                          className={styles.input}
                          value={dataFiltro}
                          onChange={(e) => setDataFiltro(e.target.value)}
                          onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                          style={{ cursor: 'pointer' }}
                        />
                      </div>
                    </div>

                    {isLoadingSessoes ? (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}><Loader2 className={styles.spinIcon} size={24} color="var(--primary-400)" /></div>
                    ) : (
                      <>
                        <hr style={{ border: 'none', borderTop: '2px solid #cbd5e1', marginBottom: '16px', marginTop: '8px' }} />

                        {/* Toolbar de ações */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                          <button
                            onClick={() => fetchSessoes()}
                            style={{
                              background: 'none', border: '1px solid #d1d5db', color: '#4b5563',
                              display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer',
                              fontSize: '0.75rem', fontWeight: 600, padding: '6px 12px', borderRadius: '6px',
                              transition: 'all 0.15s', whiteSpace: 'nowrap'
                            }}
                            title="Recarregar lista do cache local (instantâneo)"
                          >
                            <RefreshCw size={13} />
                            Atualizar tela
                          </button>

                          <button
                            onClick={() => handleSincronizarSapl(false)}
                            disabled={isLoadingSessoes}
                            style={{
                              background: 'var(--primary-600, #2563eb)', border: 'none', color: 'white',
                              display: 'flex', alignItems: 'center', gap: '6px', cursor: isLoadingSessoes ? 'wait' : 'pointer',
                              fontSize: '0.75rem', fontWeight: 600, padding: '6px 14px', borderRadius: '6px',
                              boxShadow: '0 1px 3px rgba(37,99,235,0.25)', whiteSpace: 'nowrap', flexShrink: 0,
                              opacity: isLoadingSessoes ? 0.7 : 1, transition: 'all 0.15s'
                            }}
                            title="Buscar sessões diretamente no SAPL (pode levar 1-2 minutos)"
                          >
                            {isLoadingSessoes ? <Loader2 size={13} className={styles.spinIcon} /> : <Zap size={13} />}
                            {isLoadingSessoes ? 'Buscando...' : 'Buscar no SAPL'}
                          </button>
                        </div>
                        
                        {/* Lista unificada de sessões */}
                        <div className={styles.sessoesList} style={{ maxHeight: 'max-content' }}>
                          {/* Seção: Sessões com pauta publicada */}
                          {ordensDoDiaParaMostrar.length === 0 && demaisSessoesParaMostrar.length === 0 ? (
                            <p style={{ fontSize: '0.812rem', color: '#6b7280', padding: '12px' }}>
                              {dataFiltro ? 'Nenhuma sessão encontrada para esta data.' : 'Clique em "Buscar no SAPL" para carregar sessões.'}
                            </p>
                          ) : (
                            <>
                              {ordensDoDiaParaMostrar.length > 0 && (
                                <>
                                  <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 2px', marginBottom: '4px' }}>
                                    Com pauta publicada
                                  </div>
                                  {ordensDoDiaParaMostrar.map(s => {
                                    const dt = s.data_inicio ? s.data_inicio.split('-').reverse().join('/') : '';
                                    return (
                                      <div key={`od-${s.id}`} className={styles.sessaoCard} onClick={() => handleSelectSessao(s)} style={{ borderLeft: '3px solid var(--primary-500)', backgroundColor: '#fff', padding: '16px 16px 16px 14px', color: '#1f2937' }}>
                                        <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                          <strong style={{ display: 'block', fontSize: '0.9375rem', lineHeight: 1.4, color: '#1f2937', fontWeight: 600 }}>
                                            {formatarDatasBR(s.__str__ || '') || 'Pauta Indefinida'}
                                          </strong>
                                          {s.upload_pauta && (
                                            <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.6875rem', fontWeight: 600, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', padding: '2px 6px' }}>
                                              <FileText size={10} /> PDF
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <span style={{ display: 'inline-flex', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--primary-500)' }}></span>
                                          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6b7280', fontWeight: 500 }}>
                                            Extrair matérias ({dt})
                                          </p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </>
                              )}

                              {/* Separador visual entre seções */}
                              {demaisSessoesParaMostrar.length > 0 && ordensDoDiaParaMostrar.length > 0 && (
                                <hr style={{ border: 'none', borderTop: '1px dashed #d1d5db', margin: '12px 0 8px' }} />
                              )}

                              {/* Seção: Outras sessões */}
                              {demaisSessoesParaMostrar.length > 0 && (
                                <>
                                  <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 2px', marginBottom: '4px' }}>
                                    Outras sessões
                                  </div>
                                  {demaisSessoesParaMostrar.slice(0, 10).map(s => {
                                    const dt = s.data_inicio ? s.data_inicio.split('-').reverse().join('/') : '';
                                    return (
                                      <div key={`sessao-${s.id}`} className={styles.sessaoCard} onClick={() => handleSelectSessao(s)}>
                                        <div className={styles.sessaoHeader}>
                                          <strong>{formatarDatasBR(s.__str__ || '') || dt}</strong>
                                        </div>
                                        <p>{dt ? `Sessão em: ${dt}` : 'Visualizar matérias da sessão'}</p>
                                      </div>
                                    );
                                  })}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className={styles.ordemDoDiaContainer}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                      <div 
                        style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', cursor: 'pointer' }}
                        onClick={() => setIsOrdemDiaOpen(!isOrdemDiaOpen)}
                      >
                        <div style={{ 
                          marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                          width: '26px', height: '26px', borderRadius: '6px', 
                          background: '#f1f5f9', color: '#475569', flexShrink: 0,
                          border: '1px solid #e2e8f0'
                        }}>
                          <svg 
                            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                            style={{ transform: isOrdemDiaOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                          >
                            <path d="m9 18 6-6-6-6"/>
                          </svg>
                        </div>
                        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, lineHeight: '1.4', color: '#0f172a', margin: 0, wordBreak: 'break-word', letterSpacing: '-0.01em' }}>
                          {selectedOrdemTitulo}
                        </h2>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '16px', paddingLeft: '40px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {selectedSessao?.upload_pauta && (
                          <a
                            href={selectedSessao.upload_pauta}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Abrir PDF da Ordem do Dia"
                            style={{ 
                              display: 'inline-flex', alignItems: 'center', gap: '8px', 
                              backgroundColor: '#ffffff', color: '#1e293b', 
                              padding: '8px 16px', borderRadius: '6px', fontSize: '0.8125rem', fontWeight: 600, 
                              textDecoration: 'none', transition: 'all 0.2s', 
                              border: '1px solid #cbd5e1', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' 
                            }}
                            onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc'; e.currentTarget.style.borderColor = '#94a3b8'; }}
                            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#ffffff'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
                          >
                            <FileText size={15} style={{ color: '#ef4444' }} /> Ordem do Dia em PDF
                          </a>
                        )}
                        <span 
                          onClick={(e) => { e.stopPropagation(); setSelectedOrdemTitulo(null); setSelectedSessao(null); setParecerResult(null); setOrdemDoDia([]); try { sessionStorage.removeItem(PARECER_CACHE_KEY); } catch {} }}
                          style={{ 
                            fontSize: '0.8125rem', fontWeight: 600, color: '#64748b',
                            cursor: 'pointer', transition: 'color 0.2s', textDecoration: 'none'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.color = '#334155'}
                          onMouseOut={(e) => e.currentTarget.style.color = '#64748b'}
                        >
                          Voltar
                        </span>
                      </div>
                    </div>
                    
                    {/* Linha separadora clean */}
                    <div style={{ height: '1px', background: 'linear-gradient(to right, #e2e8f0, transparent)', margin: '0 0 24px 40px' }}></div>

                    {isOrdemDiaOpen && (
                      <div>
                        {/* Caixa de Seleção em Lote - Design Institucional */}
                        {ordemDoDia.length > 0 && (
                          <div style={{ 
                            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px',
                            marginBottom: '20px', padding: '14px 18px', 
                            background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0',
                            boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.5)'
                          }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '0.875rem', color: '#334155', fontWeight: 600, margin: 0 }}>
                              <input 
                                type="checkbox" 
                                checked={selectedMaterias.length > 0 && selectedMaterias.length === ordemDoDia.length}
                                onChange={toggleSelecionarTodas}
                                style={{ 
                                  width: '18px', height: '18px', margin: 0,
                                  accentColor: '#1c4076', cursor: 'pointer' 
                                }}
                              />
                              Selecionar Todas as Matérias
                            </label>
                            
                            <span style={{ fontSize: '0.75rem', color: '#1d4ed8', background: '#dbeafe', padding: '4px 12px', borderRadius: '100px', fontWeight: 700, border: '1px solid #bfdbfe', display: 'inline-block' }}>
                              {selectedMaterias.length} de {ordemDoDia.length} selecionadas
                            </span>
                          </div>
                        )}

                        <div className={styles.materiasList} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {isLoadingOrdem ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader2 className={styles.spinIcon} size={24} color="var(--primary-400)" /></div>
                          ) : ordemDoDia.length === 0 ? (
                            <p style={{fontSize:'0.812rem', color:'#6b7280', padding: '12px', textAlign: 'center'}}>Pauta vazia (nenhuma matéria na Ordem do Dia) ou link SAPL indisponível.</p>
                          ) : (
                            ordemDoDia.map((m, index) => {
                              // Função simples para converter CAIXA ALTA do SAPL para Sentence Case
                              const formatarEmenta = (text: string) => {
                                if (!text) return '';
                                const lower = text.toLowerCase();
                                return lower.charAt(0).toUpperCase() + lower.slice(1);
                              };

                              return (
                               <div key={m.id} className={`${styles.materiaCard} ${selectedMaterias.find(sm => sm.id === m.id) ? styles.selectedMateria : ''}`} style={{ padding: '16px', background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '8px', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                               <label style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', cursor: 'pointer', width: '100%' }}>
                                 <input 
                                   type="checkbox" 
                                   style={{ marginTop: '4px', width: '18px', height: '18px', accentColor: 'var(--primary-600)' }}
                                   checked={!!selectedMaterias.find(sm => sm.id === m.id)}
                                   onChange={() => toggleMateriaSelecionada(m)}
                                 />
                                 <div style={{ flex: 1, minWidth: 0 }}>
                                   <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                                     <span className={styles.badge} style={{backgroundColor: '#e0e7ff', color: 'var(--primary-700)', fontWeight: 600, fontSize: '0.75rem', padding: '4px 8px', borderRadius: '4px'}}>
                                       {index + 1}. {m.tipo_sigla} {m.numero}/{m.ano}
                                     </span>
                                   </div>
                                   <p className={styles.materiaEmenta} style={{ fontSize: '0.875rem', color: '#4b5563', lineHeight: '1.5', margin: '0 0 10px 0' }}>
                                     {formatarEmenta(m.ementa)}
                                   </p>
                                   <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '8px', marginTop: '4px' }}>
                                     <span className={styles.materiaAutor} style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
                                       <strong>Autoria(s):</strong> {m.autores?.map((a:any) => a.nome).join(', ') || 'N/A'}
                                     </span>
                                   </div>
                                 </div>
                               </label>
                             </div>
                              );
                            })
                          )}
                        </div>

                        <button 
                          onClick={handleGerarEmLote} 
                          className={styles.generateButton} 
                          disabled={selectedMaterias.length === 0 || isGenerating}
                          style={{ marginTop: '20px', width: '100%', padding: '12px', fontSize: '0.9375rem' }}
                        >
                          {isGenerating ? (
                            <><Loader2 size={16} className={styles.spinIcon} /> Analisando Matérias...</>
                          ) : (
                            <><BrainCircuit size={16} /> Gerar Resumo ({selectedMaterias.length} {selectedMaterias.length === 1 ? 'matéria' : 'matérias'})</>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ABA 2: UPLOAD MANUAL DE PDF DA PAUTA */}
            {activeTab === 'pdf' && (
              <div className={styles.tabContent}>
                <p className={styles.helperText}>O SAPL não atualizou a ordem do dia? Suba o PDF da Pauta fornecido pela mesa diretora. A IA extrairá os PLs a partir do PDF.</p>
                <div
                  className={styles.uploadArea}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handlePdfUpload(file);
                  }}
                >
                  {isExtractingPdf ? (
                    <><Loader2 size={32} className={styles.spinIcon} color="var(--primary-400)" /><p>Extraindo matérias do PDF...</p></>
                  ) : (
                    <>
                      <UploadCloud size={32} color="var(--gray-400)" />
                      <p>Arraste o PDF da Pauta aqui ou</p>
                      <label className={styles.uploadLabel}>
                        Procurar Arquivo
                        <input
                          type="file"
                          accept="application/pdf"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePdfUpload(file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
                {pdfAviso && (
                  <p style={{ marginTop: '12px', fontSize: '0.8125rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', padding: '10px 14px' }}>
                    ⚠️ {pdfAviso}
                  </p>
                )}
              </div>
            )}

            {/* ABA 3: LINK AVULSO (Legacy fallback) */}
            {activeTab === 'link' && (
              <form onSubmit={handleGenerateFromLink} className={styles.tabContent}>
                <div className={styles.formGroup}>
                  <label>Link Direto de Uma Matéria (SAPL)</label>
                  <div className={styles.inputWithIcon}>
                    <Link2 className={styles.inputIcon} size={18} />
                    <input 
                      type="url" 
                      className={styles.input}
                      placeholder="https://sapl.../materia/12345"
                      value={urlSapl}
                      onChange={(e) => setUrlSapl(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <button 
                  type="submit" 
                  className={styles.generateButton}
                  disabled={isGenerating || !urlSapl}
                >
                  {isGenerating ? (
                    <><Loader2 size={18} className={styles.spinIcon} /> Escrevendo...</>
                  ) : (
                    <><Send size={18} /> Processar Avulso</>
                  )}
                </button>
              </form>
            )}

            {/* FIM: Conteúdo das Abas */}

            <hr className={styles.divider} />

            <div className={styles.flexRow} style={{ marginTop: '16px' }}>
              <div className={styles.formGroup} style={{ flex: 1 }}>
                <label>IA de Texto</label>
                <div className={styles.inputWithIcon}>
                  <BrainCircuit className={styles.inputIcon} size={18} />
                  <select 
                    className={styles.select}
                    value={modelType}
                    onChange={(e) => setModelType(e.target.value)}
                  >
                    <option value="flash">2.5 Flash</option>
                    <option value="pro">2.5 Pro</option>
                  </select>
                </div>
              </div>
            </div>
            
          </div>

          {/* Dicas / Workflow */}
          <div className={styles.infoCard}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Lightbulb size={16} color="#f59e0b" /> Workflow Avançado</h3>
            <ul>
              <li><strong>Prioridade 1:</strong> Use a aba "Ordem do Dia" para extrair a pauta automaticamente do SAPL.</li>
              <li><strong>Falha do SAPL?</strong> Se a Ordem do Dia não estiver publicada lá, baixe o PDF e faça o upload na Aba 2!</li>
              <li><strong>Voto "NÃO IDENTIFICADO" com link?</strong> O documento está em formato de imagem — a IA não conseguiu ler o conteúdo automaticamente. Clique em "Ver Parecer" para abrir o PDF, verifique o voto manualmente e edite o parecer gerado antes de exportar.</li>
            </ul>
          </div>

          {/* Histórico de Pareceres Gerados */}
          {historico.length > 0 && (
            <div style={{ marginTop: '16px', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', background: '#fff' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', cursor: 'pointer', background: '#f8fafc', borderBottom: isHistoricoOpen ? '1px solid #e2e8f0' : 'none' }}
                onClick={() => setIsHistoricoOpen(!isHistoricoOpen)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isHistoricoOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: '#64748b', flexShrink: 0 }}>
                  <path d="m9 18 6-6-6-6"/>
                </svg>
                <History size={15} color="#64748b" />
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Histórico de Pareceres
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', background: '#e0e7ff', color: '#3730a3', padding: '2px 7px', borderRadius: '100px', fontWeight: 700 }}>
                  {historico.length}
                </span>
              </div>

              {isHistoricoOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {historico.map((item, idx) => {
                    const dataFormatada = item.data_sessao
                      ? item.data_sessao.split('-').reverse().join('/')
                      : item.gerado_em
                        ? new Date(item.gerado_em).toLocaleDateString('pt-BR')
                        : '—';
                    const titulo = item.sessao_str || `Sessão ${dataFormatada}`;
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 16px',
                          borderTop: idx > 0 ? '1px solid #f1f5f9' : 'none',
                          transition: 'background 0.15s',
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {titulo}
                          </p>
                          <p style={{ margin: 0, fontSize: '0.7rem', color: '#64748b' }}>
                            {dataFormatada} · {item.total_materias} {item.total_materias === 1 ? 'matéria' : 'matérias'} · {item.model_usado?.includes('flash') ? 'Flash' : 'Pro'}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setParecerResult(item.parecer_md);
                            setSelectedOrdemTitulo(titulo);
                            setCachedTotalMaterias(item.total_materias || 0);
                            try {
                              sessionStorage.setItem(PARECER_CACHE_KEY, JSON.stringify({
                                parecer: item.parecer_md,
                                titulo,
                                sessao: null,
                                total: item.total_materias || 0,
                              }));
                            } catch {}
                          }}
                          style={{
                            flexShrink: 0, fontSize: '0.75rem', fontWeight: 600,
                            color: '#1c4076', background: '#eff6ff', border: '1px solid #bfdbfe',
                            borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                            transition: 'background 0.15s',
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.background = '#dbeafe')}
                          onMouseOut={(e) => (e.currentTarget.style.background = '#eff6ff')}
                        >
                          Ver
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          </>)}
        </section>

        {/* Visualizador de Resultado (Direita) */}
        <section className={styles.outputSection}>
          <div className={`${styles.outputCard} ${parecerResult ? styles.hasContent : ''}`}>
            {/* Theme Toggle removido daqui para evitar dupla ação, focado na exibição limpa. */}

            {!parecerResult && !isGenerating && (
                    <div className={styles.emptyState}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--primary-50, #eff6ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--primary-100, #dbeafe)' }}>
                        <FileText size={24} color="var(--primary-400, #60a5fa)" />
                      </div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1f2937', margin: 0 }}>Pronta para iniciar</h3>
                      <p style={{ fontSize: '0.8125rem', color: '#6b7280', maxWidth: '380px', lineHeight: 1.5, margin: 0 }}>
                        Selecione uma sessão ao lado, escolha as matérias desejadas e clique em <strong>Gerar Resumo</strong>.
                      </p>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', textAlign: 'left', maxWidth: '320px', width: '100%' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px', textAlign: 'center' }}>Fluxo rápido</div>
                        {[
                          { n: '1', text: 'Clique em "Buscar no SAPL" para atualizar sessões' },
                          { n: '2', text: 'Selecione a sessão desejada' },
                          { n: '3', text: 'Marque as matérias para análise' },
                          { n: '4', text: 'Clique em "Gerar Resumo"' },
                        ].map(step => (
                          <div key={step.n} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.8125rem', color: '#4b5563' }}>
                            <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--primary-50, #eff6ff)', color: 'var(--primary-600, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0, border: '1px solid var(--primary-100, #dbeafe)' }}>{step.n}</span>
                            {step.text}
                          </div>
                        ))}
                      </div>

                      <div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#475569', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', maxWidth: '380px', lineHeight: 1.4 }}>
                        <Lightbulb size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />
                        <strong>Dica:</strong> Se a pauta não apareceu, use <strong>&quot;Pauta em PDF&quot;</strong> ou cole o link em <strong>&quot;Link Direto&quot;</strong>.
                      </div>
                    </div>
                  )}
            
            {isGenerating && (
              <div className={styles.generatingState}>
                <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'center' }}>
                  <LogoLoader size={88} />
                </div>
                <p>A inteligência está processando a fundamentação jurídica de {selectedMaterias.length} matéria(s)... Isso pode levar entre 1 e 5 minutos a depender do tamanho dos documentos e anexos do SAPL.</p>
              </div>
            )}

            {parecerResult && (
              <div className={styles.documentViewer}>
                <div className={styles.documentHeader}>
                  <div className={styles.documentTitleGroup}>
                    <span className={styles.documentSparkle}>✦</span>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#1f2937' }}>PARECER ANALÍTICO</h2>
                  </div>
                  <div style={{display: 'flex', gap: '8px'}}>
                    <button onClick={handleExportOdt} className={styles.exportButton} style={{ background: '#0284c7', color: 'white', borderColor: '#0369a1' }}>
                      <FileText size={16} /> Exportar SAPL (.odt)
                    </button>
                    <button onClick={handleExportDocx} className={styles.exportButton}>
                      <Download size={16} /> Exportar DOCX Pronto
                    </button>
                  </div>
                </div>
                
                <A4DocumentViewer>
                  <div className={styles.documentMeta} style={{ marginBottom: '48px', borderBottom: '2px solid #e5e7eb', paddingBottom: '24px' }}>
                    <span className={styles.metaLabel} style={{ fontSize: '0.8rem', fontWeight: 600, color: '#6366f1', textTransform: 'uppercase' }}>Documento Gerado</span>
                    <h3 className={styles.metaTitle} style={{ fontFamily: 'var(--font-family, sans-serif)', fontSize: '1.25rem', marginTop: '4px' }}>Modelo CyaParecer — {selectedOrdemTitulo || 'Pauta Selecionada'}</h3>
                    <p className={styles.metaDescription} style={{ fontFamily: 'var(--font-family, sans-serif)', color: '#475569', fontSize: '0.9rem' }}>
                      O documento foi produzido e formatado para conformidade com Padrão Gabinete. Realize o download acima para revisar os apontamentos finais.
                    </p>
                  </div>

                  <div className={styles.markdownContent}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {parecerResult}
                    </ReactMarkdown>
                  </div>
                </A4DocumentViewer>
              </div>
            )}
          </div>
        </section>
      </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      {itemToDelete && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            padding: '24px',
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            maxWidth: '380px',
            width: '100%',
            textAlign: 'center',
            animation: 'fadeInUp 0.2s ease-out forwards'
          }}>
            <style>{`
              @keyframes fadeInUp {
                from { opacity: 0; transform: translateY(10px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>
            <div style={{
              width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#fef2f2',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#ef4444'
            }}>
              <Trash2 size={28} />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.15rem', color: '#0f172a', fontWeight: 700 }}>
              Excluir do Histórico?
            </h3>
            <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#475569', lineHeight: 1.5 }}>
              Você está prestes a deletar o parecer gerado:<br/>
              <strong style={{ color: '#1e293b' }}>{itemToDelete.sessao_str || itemToDelete.data_sessao || 'Sessão'}</strong>
              <br/><br/>
              Esta ação não pode ser desfeita.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setItemToDelete(null)}
                style={{ padding: '10px 16px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer', flex: 1, fontSize: '0.9rem', transition: 'all 0.15s' }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#fff')}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/pareceres/historico?id=${itemToDelete.id}`, { method: 'DELETE' });
                    if (res.ok) {
                      setHistorico(prev => prev.filter((item: any) => item.id !== itemToDelete.id));
                      setItemToDelete(null);
                    } else {
                      alert('Falha ao deletar.');
                    }
                  } catch { alert('Erro de rede ao deletar.'); }
                }}
                style={{ padding: '10px 16px', border: 'none', borderRadius: '8px', background: '#ef4444', color: '#fff', fontWeight: 600, cursor: 'pointer', flex: 1, fontSize: '0.9rem', transition: 'all 0.15s' }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#dc2626')}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#ef4444')}
              >
                Sim, Deletar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

