'use client';

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Send, Loader2, Link2, BrainCircuit, Calendar, UploadCloud, Download, History, Shield, Search, Gavel, ExternalLink, CheckCircle2, Clock, ChevronRight, Building2, Users, Trash2, Eye, RefreshCw } from 'lucide-react';
import styles from './pareceres-dashboard.module.css';
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
  const [isUltimasOpen, setIsUltimasOpen] = useState(true);
  const [isDemaisOpen, setIsDemaisOpen] = useState(false);
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
  const [gabineteId, setGabineteId] = useState<string | null>(null);
  // Fila automática
  const [relatoriaFila, setRelatoriaFila] = useState<MateriaFila[]>([]);
  const [relatoriaFilaLoading, setRelatoriaFilaLoading] = useState(false);
  const [selectedMateriaFila, setSelectedMateriaFila] = useState<MateriaFila | null>(null);
  const [materiaContexto, setMateriaContexto] = useState<MateriaContexto | null>(null);
  const [materiaContextoLoading, setMateriaContextoLoading] = useState(false);
  const [buscarIdMode, setBuscarIdMode] = useState(false);
  const [relatorBuscarId, setRelatorBuscarId] = useState('');

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
        setRelatoriaFila(data.materias || []);
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
  const [comissaoMateriaId, setComissaoMateriaId] = useState('');
  const [comissaoFila, setComissaoFila] = useState<MateriaFila[]>([]);
  const [comissaoFilaLoading, setComissaoFilaLoading] = useState(false);
  const [selectedComissaoMateria, setSelectedComissaoMateria] = useState<MateriaContexto | null>(null);
  const [comissaoContextoLoading, setComissaoContextoLoading] = useState(false);
  const [comissaoVoto, setComissaoVoto] = useState<'FAVORÁVEL' | 'CONTRÁRIO' | 'SEGUIR RELATOR'>('FAVORÁVEL');
  const [comissaoInfoMembros, setComissaoInfoMembros] = useState<{nome:string;cargo:string}[]>([]);
  const [comissaoInfoLoading, setComissaoInfoLoading] = useState(false);
  const [ataData, setAtaData] = useState('');
  const [ataHoraInicio, setAtaHoraInicio] = useState('OITO HORAS');
  const [ataHoraFim, setAtaHoraFim] = useState('NOVE HORAS');
  const [comissaoResult, setComissaoResult] = useState<string | null>(null);
  const [ataResult, setAtaResult] = useState<string | null>(null);
  const [comissaoMembros, setComissaoMembros] = useState<{nome:string;cargo:string}[]>([]);
  const [isGerandoComissao, setIsGerandoComissao] = useState(false);
  const [comissaoBuscarIdMode, setComissaoBuscarIdMode] = useState(false);
  const [selectedComissaoMateriaFila, setSelectedComissaoMateriaFila] = useState<MateriaFila | null>(null);
  const [comissaoTitulo, setComissaoTitulo] = useState<string | null>(null);
  // ATA multi-select: IDs de matérias selecionadas via checkbox
  const [ataSelectedIds, setAtaSelectedIds] = useState<Set<number>>(new Set());
  const [isSyncingComissoes, setIsSyncingComissoes] = useState(false);

  const toggleAtaMateriaSelection = (materiaId: number) => {
    setAtaSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(materiaId)) next.delete(materiaId);
      else next.add(materiaId);
      return next;
    });
  };

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
    setSelectedComissaoMateriaFila(null);
    setSelectedComissaoMateria(null);
    setComissaoResult(null);
    setAtaResult(null);
    try {
      const res = await fetch(`/api/pareceres/relatoria/fila?comissao=${encodeURIComponent(comissao)}`);
      if (res.ok) { const d = await res.json(); setComissaoFila(d.materias || []); }
    } catch { /* silent */ } finally { setComissaoFilaLoading(false); }
  };

  const loadComissaoContexto = async (materiaId: number) => {
    setComissaoContextoLoading(true);
    setSelectedComissaoMateria(null);
    try {
      const res = await fetch(`/api/pareceres/relatoria/materia/${materiaId}`);
      if (res.ok) setSelectedComissaoMateria(await res.json());
    } catch { /* silent */ } finally { setComissaoContextoLoading(false); }
  };

  const loadComissaoInfo = async (sigla: string) => {
    const c = comissoesDisponiveis.find(x => x.sigla === sigla);
    if (!c?.sapl_unit_id) { setComissaoInfoMembros([]); return; }
    setComissaoInfoLoading(true);
    try {
      const res = await fetch(`/api/pareceres/comissao/membros?comissao_id=${c.sapl_unit_id}`);
      if (res.ok) {
        const d = await res.json();
        setComissaoInfoMembros(d.membros || []);
      }
    } catch { setComissaoInfoMembros([]); }
    finally { setComissaoInfoLoading(false); }
  };

  useEffect(() => {
    if (comissoesDisponiveis.length > 0) loadComissaoInfo(comissaoComissao);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comissaoComissao, comissoesDisponiveis]);

  const handleComissaoBuscarPorId = async () => {
    const q = comissaoMateriaId.trim();
    if (!q) return;
    setComissaoContextoLoading(true);
    setSelectedComissaoMateria(null);
    setComissaoResult(null);
    setAtaResult(null);
    try {
      const res = await fetch(`/api/pareceres/relatoria/buscar?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok || !data.found) {
        alert(data.error || `Matéria "${q}" não encontrada.`);
        setComissaoContextoLoading(false); return;
      }
      const m = data.materia ?? data.materias?.[0];
      if (!m) { alert('Nenhuma matéria encontrada.'); setComissaoContextoLoading(false); return; }
      const fakeItem: MateriaFila = {
        id: m.id, tipo_sigla: m.tipo_sigla, numero: m.numero, ano: m.ano, ementa: m.ementa, autores: '',
        status_relatoria: 'sem_rascunho', rascunho_voto: null, rascunho_em: null, ultima_tramitacao: '', sapl_url: m.sapl_url,
      };
      setSelectedComissaoMateriaFila(fakeItem);
      setComissaoBuscarIdMode(false);
      setComissaoMateriaId('');
      const ctxRes = await fetch(`/api/pareceres/relatoria/materia/${m.id}`);
      if (ctxRes.ok) setSelectedComissaoMateria(await ctxRes.json());
    } catch { alert('Erro ao buscar matéria. Tente novamente.'); }
    finally { setComissaoContextoLoading(false); }
  };

  const handleGerarParecer = async () => {
    // Prioridade: (1) matéria clicada, (2) único checkbox marcado, (3) contexto carregado
    const soloCheckbox = ataSelectedIds.size === 1 ? [...ataSelectedIds][0] : undefined;
    const id = selectedComissaoMateriaFila?.id ?? soloCheckbox ?? selectedComissaoMateria?.materia?.id;
    if (!id) return;
    setIsGerandoComissao(true);
    setComissaoResult(null);
    const tipoStr = selectedComissaoMateria?.materia
      ? `${selectedComissaoMateria.materia.tipo_sigla} ${selectedComissaoMateria.materia.numero}/${selectedComissaoMateria.materia.ano}`
      : `Matéria #${id}`;
    setComissaoTitulo(`Parecer_Comissao_${comissaoComissao}_${tipoStr.replace(/\s+/g,'_')}`);
    try {
      const res = await fetch('/api/pareceres/comissao/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materia_id: id, commission_sigla: comissaoComissao, voto: comissaoVoto, modo: 'parecer', data: ataData || undefined, hora_inicio: ataHoraInicio, hora_fim: ataHoraFim }),
      });
      const data = await res.json();
      if (res.ok) {
        setComissaoResult(data.parecer_comissao);
        setComissaoMembros(data.membros || []);
      } else { setComissaoResult(`**ERRO:** ${data.error || 'Falha ao gerar.'}`); }
    } catch { setComissaoResult('**ERRO DE REDE:** Servidor não alcançável.'); }
    finally { setIsGerandoComissao(false); }
  };

  const handleGerarAta = async () => {
    const ids = Array.from(ataSelectedIds);
    if (ids.length === 0) { alert('Selecione ao menos uma matéria para gerar a ATA.'); return; }
    setIsGerandoComissao(true);
    setAtaResult(null);
    setComissaoTitulo(`ATA_${comissaoComissao}_${ids.length}_materias`);
    try {
      const res = await fetch('/api/pareceres/comissao/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materia_ids: ids, commission_sigla: comissaoComissao, voto: comissaoVoto, modo: 'ata', data: ataData || undefined, hora_inicio: ataHoraInicio, hora_fim: ataHoraFim }),
      });
      const data = await res.json();
      if (res.ok) {
        setAtaResult(data.ata);
        setComissaoMembros(data.membros || []);
      } else { setAtaResult(`**ERRO:** ${data.error || 'Falha ao gerar ATA.'}`); }
    } catch { setAtaResult('**ERRO DE REDE:** Servidor não alcançável.'); }
    finally { setIsGerandoComissao(false); }
  };

  // Legacy — kept for backward compat:
  const handleGerarComissao = handleGerarParecer;

  const handleExportComissaoDocx = async (tipo: 'comissao' | 'ata') => {
    const text = tipo === 'comissao' ? comissaoResult : ataResult;
    if (!text) { alert(`Nenhum ${tipo === 'comissao' ? 'parecer' : 'ATA'} gerado para exportar.`); return; }
    const comissao = comissoesDisponiveis.find(c => c.sigla === comissaoComissao);
    const commissionNome = comissao?.nome || comissaoComissao;
    try {
      const res = await fetch('/api/pareceres/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parecer: text,
          tipo,
          commission_nome: commissionNome,
          commission_sigla: comissaoComissao,
          gabinete_nome: relatorNome,
          titulo: comissaoTitulo || tipo,
          membros: comissaoMembros,
          data_sessao: ataData || undefined,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        const errData = await res.json().catch(() => ({ error: `Erro HTTP ${res.status}` }));
        console.error(`[DOCX ${tipo}] Erro:`, errData);
        alert(`Erro ao gerar DOCX: ${errData.error || 'Falha no servidor'}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tipo === 'comissao' ? comissaoTitulo || `Parecer_Comissao_${comissaoComissao}` : `ATA_${comissaoComissao}`}.docx`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error(`[DOCX ${tipo}] Exception:`, err);
      alert('Erro ao gerar o DOCX. Verifique o console para detalhes.');
    }
  };

  const handleExportComissaoOdt = async (tipo: 'comissao' | 'ata') => {
    const text = tipo === 'comissao' ? comissaoResult : ataResult;
    if (!text) { alert(`Nenhum ${tipo === 'comissao' ? 'parecer' : 'ATA'} gerado para exportar.`); return; }
    const comissao = comissoesDisponiveis.find(c => c.sigla === comissaoComissao);
    const commissionNome = comissao?.nome || comissaoComissao;
    try {
      const res = await fetch('/api/exportar/odt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          titulo: comissaoTitulo || tipo,
          dados: {
            titulo: typeof comissaoTitulo === 'string' && comissaoTitulo ? comissaoTitulo : `PARECER DA COMISSÃO — ${comissaoComissao}`,
            data_extenso: getDataExtenso(ataData || undefined),
            municipio: 'Boa Vista',
            parlamentar: { nome_completo: relatorNome },
            comissao: { nome: commissionNome },
            cargo_relator: 'Presidente',
            materia: {
              tipo_sigla: selectedComissaoMateria?.materia?.tipo_sigla || selectedComissaoMateriaFila?.tipo_sigla || '',
              numero: selectedComissaoMateria?.materia?.numero || selectedComissaoMateriaFila?.numero || '',
              ano: selectedComissaoMateria?.materia?.ano || selectedComissaoMateriaFila?.ano || '',
              ementa: selectedComissaoMateria?.materia?.ementa || selectedComissaoMateriaFila?.ementa || '',
            },
            voto: comissaoVoto === 'SEGUIR RELATOR' ? 'FAVORÁVEL' : comissaoVoto,
            texto_relatorio: text || '',
            texto_voto_fundamentado: '',
          },
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('application/json')) {
        const errData = await res.json().catch(() => ({ error: `Erro HTTP ${res.status}` }));
        console.error(`[ODT ${tipo}] Erro:`, errData);
        alert(`Erro ao gerar ODT: ${errData.error || errData.detalhe || 'Falha no servidor'}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tipo === 'comissao' ? comissaoTitulo || `Parecer_Comissao_${comissaoComissao}` : `ATA_${comissaoComissao}`}.odt`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error(`[ODT ${tipo}] Exception:`, err);
      alert('Erro ao gerar o ODT. Verifique o console para detalhes.');
    }
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

  // Polling a cada 10 minutos para buscar novidades no SAPL
  useEffect(() => {
    const interval = setInterval(() => {
      handleSincronizarSapl(true);
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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

  const handleGerarRelator = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const id = selectedMateriaFila?.id ?? parseInt(relatorBuscarId, 10);
    if (!id || !relatorNome.trim()) return;
    setIsGerandoRelator(true);
    setRelatorResult(null);
    const tipoStr = materiaContexto?.materia
      ? `${materiaContexto.materia.tipo_sigla} ${materiaContexto.materia.numero}/${materiaContexto.materia.ano}`
      : `Matéria #${id}`;
    setRelatorTitulo(`Relatoria ${relatorComissao} — ${tipoStr}`);
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
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRelatorResult(data.parecer_relator);
        setRelatorTitulo(`Relatoria ${data.commission} — ${data.materia_tipo}`);
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
      <div style={{ display: 'flex', gap: '4px', borderBottom: '2px solid #e5e7eb', marginBottom: '20px' }}>
        {[
          { id: 'alia',      label: <div style={{display:'flex',alignItems:'center',gap:'8px'}}><Shield size={16}/> ALIA</div>,        title: 'Triagem de pautas identificadas por IA' },
          { id: 'vereador',  label: <div style={{display:'flex',alignItems:'center',gap:'8px'}}><Search size={16}/> Vereador</div>,    title: 'Parecer do Vereador — Ordem do Dia, PDF ou Link' },
          { id: 'relatoria', label: <div style={{display:'flex',alignItems:'center',gap:'8px'}}><Gavel size={16}/> Relatoria</div>,   title: 'Parecer do Relator de Comissão' },
          { id: 'comissao',  label: <div style={{display:'flex',alignItems:'center',gap:'8px'}}><Building2 size={16}/> Comissão</div>, title: 'Parecer da Comissão + ATA da Reunião' },
        ].map(aba => (
          <button
            key={aba.id}
            title={aba.title}
            onClick={() => setAbaPrincipal(aba.id as 'alia' | 'vereador' | 'relatoria' | 'comissao')}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderBottom: abaPrincipal === aba.id ? '3px solid #d946ef' : '3px solid transparent',
              background: 'none',
              cursor: 'pointer',
              fontWeight: abaPrincipal === aba.id ? 700 : 500,
              color: abaPrincipal === aba.id ? '#d946ef' : '#6b7280',
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
        /* ── ABA RELATORIA v2 — Fila automática ─────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0', minHeight: 0 }}>

          {/* Painel Pareceres Gerados */}
          {historico.length > 0 && (
            <div style={{ marginBottom: '16px', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}>
              <button
                onClick={() => setIsHistoricoOpen(h => !h)}
                style={{ width: '100%', padding: '10px 16px', background: '#f8fafc', border: 'none', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', fontWeight: 700, color: '#374151' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <History size={15} /> Pareceres Gerados ({historico.length})
                </span>
                <ChevronRight size={14} style={{ transform: isHistoricoOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} />
              </button>
              {isHistoricoOpen && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px', padding: '12px' }}>
                  {historico.slice(0, 12).map((h: any) => (
                    <div key={h.id}
                      style={{ padding: '10px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px',
                        fontSize: '0.76rem', cursor: 'pointer', transition: 'all 0.15s', position: 'relative' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1c4076'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(28,64,118,0.12)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <div style={{ fontWeight: 700, color: '#1c4076', flex: 1 }}>
                          {h.sessao_str || h.data_sessao || 'Sessão'}
                        </div>
                        <button
                          title="Deletar parecer"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm('Tem certeza que deseja deletar este parecer do histórico?')) return;
                            try {
                              const res = await fetch(`/api/pareceres/historico?id=${h.id}`, { method: 'DELETE' });
                              if (res.ok) {
                                setHistorico(prev => prev.filter((item: any) => item.id !== h.id));
                              } else {
                                alert('Falha ao deletar.');
                              }
                            } catch { alert('Erro de rede ao deletar.'); }
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#9ca3af', borderRadius: '4px', transition: 'color 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div style={{ color: '#6b7280' }}>
                        {h.total_materias} matéria(s) · {h.model_usado || 'flash'}
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: '0.68rem', marginTop: '3px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{new Date(h.gerado_em).toLocaleDateString('pt-BR')}</span>
                        <button
                          title="Recarregar em tela"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (h.parecer_md) {
                              setRelatorResult(h.parecer_md);
                              setRelatorTitulo(h.sessao_str || h.data_sessao || 'Parecer Histórico');
                            } else {
                              alert('Este parecer não possui conteúdo salvo.');
                            }
                          }}
                          style={{ background: '#f0f7ff', border: '1px solid #1c4076', cursor: 'pointer', padding: '3px 8px', color: '#1c4076',
                            borderRadius: '4px', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}
                        >
                          <Eye size={11} /> Abrir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tabs de comissões + botão buscar por ID */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', borderBottom: '1px solid #e5e7eb', marginBottom: '16px', flexWrap: 'wrap' }}>
            {comissoesDisponiveis.map(c => (
              <button
                key={c.sigla}
                onClick={() => { setRelatorComissao(c.sigla); setRelatorResult(null); setRelatorTitulo(null); }}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderBottom: relatorComissao === c.sigla ? '3px solid #1c4076' : '3px solid transparent',
                  background: 'none',
                  cursor: 'pointer',
                  fontWeight: relatorComissao === c.sigla ? 700 : 500,
                  color: relatorComissao === c.sigla ? '#1c4076' : '#6b7280',
                  fontSize: '0.85rem',
                  marginBottom: '-1px',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title={`${c.nome}${c.meu_cargo ? ` — ${c.meu_cargo}` : ''}`}
              >
                {c.sigla}
                {c.meu_cargo && c.meu_cargo !== 'acesso_geral' && (
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block',
                    background: c.meu_cargo === 'presidente' ? '#15803d' : c.meu_cargo === 'vice-presidente' ? '#1d4ed8' : '#94a3b8',
                  }} title={c.meu_cargo} />
                )}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
              {/* Botão Upload PDF */}
              <label
                style={{
                  padding: '5px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  background: '#fff',
                  color: '#374151',
                  fontSize: '0.8rem',
                  cursor: pdfUploadLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  opacity: pdfUploadLoading ? 0.7 : 1,
                }}
                title="Envie o PDF da matéria para identificação automática"
              >
                {pdfUploadLoading ? <Loader2 size={13} className={styles.spinIcon} /> : <UploadCloud size={13} />}
                {pdfUploadLoading ? 'Lendo PDF…' : 'Upload PDF'}
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  style={{ display: 'none' }}
                  disabled={pdfUploadLoading}
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    e.target.value = '';
                    setPdfUploadLoading(true);
                    try {
                      const fd = new FormData();
                      fd.append('file', file);
                      const res = await fetch('/api/pareceres/relatoria/upload-pdf', { method: 'POST', body: fd });
                      const data = await res.json();
                      if (data.found && data.materia_id) {
                        const fakeItem: MateriaFila = {
                          id: data.materia_id, tipo_sigla: data.tipo, numero: data.numero, ano: data.ano,
                          ementa: data.ementa, autores: '',
                          status_relatoria: 'sem_rascunho', rascunho_voto: null, rascunho_em: null,
                          ultima_tramitacao: '', sapl_url: data.sapl_url,
                        };
                        setSelectedMateriaFila(fakeItem);
                        setRelatorResult(null);
                        setRelatorTitulo(null);
                        loadMateriaContexto(data.materia_id);
                      } else {
                        const hint = data.suggested_query ? ` Tente buscar por: ${data.suggested_query}` : '';
                        alert((data.message || data.error || 'Não foi possível identificar a matéria no PDF.') + hint);
                      }
                    } catch {
                      alert('Erro ao enviar o PDF. Tente novamente.');
                    } finally {
                      setPdfUploadLoading(false);
                    }
                  }}
                />
              </label>
              {/* Botão Buscar por ID */}
              <button
                onClick={() => setBuscarIdMode(b => !b)}
                style={{
                  padding: '5px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  background: buscarIdMode ? '#1c4076' : '#fff',
                  color: buscarIdMode ? '#fff' : '#374151',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Link2 size={13} /> Buscar por ID
              </button>
            </div>
            {buscarIdMode && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'flex-end', width: '100%', paddingTop: '6px' }}>
                <input
                  type="text"
                  placeholder="PLL 32/2026 ou ID"
                  value={relatorBuscarId}
                  onChange={e => setRelatorBuscarId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBuscarPorId()}
                  style={{ width: '160px', padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem' }}
                  autoFocus
                />
                <button
                  onClick={handleBuscarPorId}
                  style={{ padding: '5px 12px', background: '#1c4076', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem' }}
                >
                  Buscar
                </button>
              </div>
            )}
          </div>

          {/* Grid dos 3 painéis */}
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 380px', gap: '12px', minHeight: '600px', alignItems: 'start' }}>

            {/* PAINEL ESQUERDO — Fila */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden', background: '#fafafa' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Fila — {relatorComissao}
                </span>
                {relatoriaFilaLoading && <Loader2 size={13} style={{ float: 'right', marginTop: '2px', color: '#94a3b8' }} className={styles.spinIcon} />}
              </div>
              <div style={{ maxHeight: '580px', overflowY: 'auto' }}>
                {!relatoriaFilaLoading && relatoriaFila.length === 0 && (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>
                    <Gavel size={28} color="#d1d5db" style={{ marginBottom: '8px' }} />
                    <p style={{ margin: 0 }}>Nenhuma matéria encontrada na fila.</p>
                    <p style={{ margin: '4px 0 0', fontSize: '0.73rem' }}>Use "Buscar por ID" para localizar uma matéria específica.</p>
                  </div>
                )}
                {relatoriaFila.map(m => (
                  <button
                    key={m.id}
                    onClick={() => handleSelecionarMateriaFila(m)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '10px 12px',
                      border: 'none',
                      borderBottom: '1px solid #f3f4f6',
                      background: selectedMateriaFila?.id === m.id ? '#eff6ff' : '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                      borderLeft: selectedMateriaFila?.id === m.id ? '3px solid #1c4076' : '3px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '4px' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1c4076' }}>
                        {m.tipo_sigla} {m.numero}/{m.ano}
                      </span>
                      {m.status_relatoria === 'rascunho_gerado' ? (
                        <CheckCircle2 size={14} color="#15803d" style={{ flexShrink: 0, marginTop: '1px' }} />
                      ) : (
                        <Clock size={14} color="#9ca3af" style={{ flexShrink: 0, marginTop: '1px' }} />
                      )}
                    </div>
                    <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.3,
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {m.ementa || '(sem ementa)'}
                    </p>
                    {m.status_relatoria === 'rascunho_gerado' && (
                      <span style={{ display: 'inline-block', marginTop: '4px', fontSize: '0.68rem', color: '#15803d', fontWeight: 600 }}>
                        ✓ Rascunho gerado
                      </span>
                    )}
                  </button>
                ))}
                {selectedMateriaFila && !relatoriaFila.find(m => m.id === selectedMateriaFila.id) && (
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', background: '#eff6ff', borderLeft: '3px solid #1c4076' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1c4076' }}>
                      Matéria #{selectedMateriaFila.id}
                    </span>
                    <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: '#6b7280' }}>
                      {materiaContexto?.materia?.ementa
                        ? materiaContexto.materia.ementa.substring(0, 80) + '...'
                        : 'Carregando...'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* PAINEL CENTRAL — Contexto da matéria */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', background: '#fff', overflow: 'hidden' }}>
              {!selectedMateriaFila && !materiaContextoLoading && (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af' }}>
                  <ChevronRight size={36} color="#d1d5db" />
                  <p style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>Selecione uma matéria na fila para ver o contexto completo.</p>
                </div>
              )}
              {materiaContextoLoading && (
                <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <Loader2 size={32} color="#94a3b8" className={styles.spinIcon} />
                  <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: '12px' }}>Buscando dados no SAPL...</p>
                </div>
              )}
              {materiaContexto && !materiaContextoLoading && (
                <div>
                  {/* Header */}
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1c4076', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {materiaContexto.materia.tipo_sigla} {materiaContexto.materia.numero}/{materiaContexto.materia.ano}
                        </span>
                        <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#374151', lineHeight: 1.4 }}>
                          {materiaContexto.materia.ementa}
                        </p>
                        <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#6b7280' }}>
                          Autor: {materiaContexto.materia.autores || '—'} · Regime: {materiaContexto.materia.regime}
                        </p>
                      </div>
                      <a
                        href={materiaContexto.materia.sapl_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ flexShrink: 0, padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
                          background: '#fff', color: '#374151', fontSize: '0.75rem', display: 'flex', alignItems: 'center',
                          gap: '4px', textDecoration: 'none', whiteSpace: 'nowrap' }}
                      >
                        <ExternalLink size={12} /> SAPL
                      </a>
                    </div>
                  </div>

                  <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Procuradoria */}
                    <div>
                      <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Procuradoria Jurídica
                      </p>
                      {materiaContexto.procuradoria.voto ? (
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px',
                          borderRadius: '6px',
                          background: materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '#f0fdf4' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '#fef2f2' : '#fffbeb',
                          border: `1px solid ${materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '#bbf7d0' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '#fecaca' : '#fde68a'}`,
                        }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700,
                            color: materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '#15803d' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '#b91c1c' : '#92400e' }}>
                            {materiaContexto.procuradoria.voto === 'FAVORÁVEL' ? '✓' : materiaContexto.procuradoria.voto === 'CONTRÁRIO' ? '✗' : '⚠'} {materiaContexto.procuradoria.voto}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Não encontrado nas tramitações</span>
                      )}
                    </div>

                    {/* Outras comissões */}
                    {materiaContexto.outras_comissoes.length > 0 && (
                      <div>
                        <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Pareceres de outras comissões
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {materiaContexto.outras_comissoes.map((oc, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '4px 10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                              <span style={{ fontSize: '0.78rem', color: '#374151' }}>{oc.comissao}</span>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700,
                                color: oc.voto.includes('FAVORÁVEL') || oc.voto.includes('APROVADO') ? '#15803d' :
                                       oc.voto.includes('CONTRÁRIO') ? '#b91c1c' : '#92400e' }}>
                                {oc.voto}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tramitações */}
                    <div>
                      <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Tramitações recentes
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '220px', overflowY: 'auto' }}>
                        {materiaContexto.tramitacoes.slice(0, 8).map((t, i) => (
                          <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '0.76rem', padding: '4px 0',
                            borderBottom: '1px solid #f3f4f6' }}>
                            <span style={{ color: '#9ca3af', flexShrink: 0, width: '72px' }}>{t.data}</span>
                            <span style={{ color: '#374151', lineHeight: 1.35 }}>{t.texto}</span>
                          </div>
                        ))}
                        {materiaContexto.tramitacoes.length === 0 && (
                          <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Sem tramitações registradas.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* PAINEL DIREITO — Geração */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className={styles.formCard}>
                <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 700, color: '#1c4076', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <Gavel size={17} /> Gerar Parecer
                </h3>

                {/* Aviso rascunho existente */}
                {materiaContexto && materiaContexto.rascunhos.length > 0 && (
                  <div style={{ padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px', marginBottom: '12px', fontSize: '0.76rem', color: '#92400e' }}>
                    Rascunho gerado em {new Date(materiaContexto.rascunhos[0].created_at).toLocaleDateString('pt-BR')} ({materiaContexto.rascunhos[0].commission_sigla} — {materiaContexto.rascunhos[0].voto}). Gerar novamente substituirá.
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Comissão */}
                  <div className={styles.formGroup}>
                    <label>Comissão</label>
                    <select className={styles.select} value={relatorComissao} onChange={e => setRelatorComissao(e.target.value)}>
                      {comissoesDisponiveis.map(c => <option key={c.sigla} value={c.sigla}>{c.sigla} — {c.nome}</option>)}
                    </select>
                  </div>

                  {/* Relator */}
                  <div className={styles.formGroup}>
                    <label>Relator</label>
                    <input type="text" className={styles.input} value={relatorNome}
                      onChange={e => setRelatorNome(e.target.value)} placeholder="Nome do relator" />
                  </div>

                  {/* Modelo */}
                  <div className={styles.formGroup}>
                    <label>Modelo IA</label>
                    <div className={styles.inputWithIcon}>
                      <BrainCircuit className={styles.inputIcon} size={16} />
                      <select className={styles.select} value={modelType} onChange={e => setModelType(e.target.value)}>
                        <option value="flash">Gemini 2.5 Flash</option>
                        <option value="pro">Gemini 2.5 Pro</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={() => handleGerarRelator()}
                    className={styles.generateButton}
                    disabled={isGerandoRelator || !relatorNome.trim() || !selectedMateriaFila}
                  >
                    {isGerandoRelator ? (
                      <><Loader2 size={17} className={styles.spinIcon} /> Elaborando parecer...</>
                    ) : (
                      <><Gavel size={17} /> Analisar pela Atribuição da Comissão</>
                    )}
                  </button>
                  {!selectedMateriaFila && (
                    <p style={{ margin: 0, fontSize: '0.74rem', color: '#9ca3af', textAlign: 'center' }}>
                      Selecione uma matéria na fila ou use "Buscar por ID"
                    </p>
                  )}
                  {/* Nota informativa sobre fundamentação da comissão */}
                  {(() => {
                    const c = comissoesDisponiveis.find(x => x.sigla === relatorComissao);
                    return c ? (
                      <div style={{ padding: '8px 10px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '7px', fontSize: '0.72rem', color: '#0369a1', lineHeight: 1.5 }}>
                        <strong>{c.sigla}</strong> — {c.area || c.nome}<br/>
                        <span style={{ color: '#64748b' }}>Regimento Interno da CMBV — Resolução 93/1998</span>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Resultado */}
              {isGerandoRelator && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '32px 16px', textAlign: 'center', background: '#fff' }}>
                  <LogoLoader size={72} />
                  <p style={{ color: '#6b7280', fontSize: '0.82rem', marginTop: '12px' }}>Buscando dados no SAPL e elaborando o parecer...</p>
                </div>
              )}
              {relatorResult && !isGerandoRelator && (
                <div className={styles.documentViewer}>
                  <div className={styles.documentHeader}>
                    <div className={styles.documentTitleGroup}>
                      <span className={styles.documentSparkle}>✦</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1f2937' }}>PARECER DE RELATOR</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={handleExportRelatorOdt} className={styles.exportButton} style={{ background: '#0284c7', color: 'white', borderColor: '#0369a1' }}>
                        <FileText size={15} /> SAPL (.odt)
                      </button>
                      <button onClick={handleExportRelatorDocx} className={styles.exportButton}>
                        <Download size={15} /> DOCX
                      </button>
                    </div>
                  </div>
                  <A4DocumentViewer>
                    <div style={{ marginBottom: '32px', borderBottom: '2px solid #e5e7eb', paddingBottom: '16px' }}>
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
            </div>
          </div>
        </div>
      ) : abaPrincipal === 'comissao' ? (
        /* ── ABA COMISSÃO — Parecer da Comissão + ATA ─────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0', minHeight: 0 }}>

          {/* Sub-tabs comissões + busca */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', borderBottom: '1px solid #e5e7eb', marginBottom: '16px', flexWrap: 'wrap' }}>
            {comissoesDisponiveis.map(c => (
              <button key={c.sigla} onClick={() => { setComissaoComissao(c.sigla); setComissaoResult(null); setAtaResult(null); setAtaSelectedIds(new Set()); }}
                style={{ padding: '6px 14px', border: 'none', borderBottom: comissaoComissao === c.sigla ? '3px solid #7c3aed' : '3px solid transparent',
                  background: 'none', cursor: 'pointer', fontWeight: comissaoComissao === c.sigla ? 700 : 500,
                  color: comissaoComissao === c.sigla ? '#7c3aed' : '#6b7280', fontSize: '0.85rem', marginBottom: '-1px', whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', gap: '4px' }}
                title={`${c.nome}${c.meu_cargo ? ` — ${c.meu_cargo}` : ''}`}>
                {c.sigla}
                {c.meu_cargo && c.meu_cargo !== 'acesso_geral' && (
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block',
                    background: c.meu_cargo === 'presidente' ? '#15803d' : c.meu_cargo === 'vice-presidente' ? '#1d4ed8' : '#94a3b8',
                  }} title={c.meu_cargo} />
                )}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button onClick={() => setComissaoBuscarIdMode(b => !b)}
                style={{ padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                  background: comissaoBuscarIdMode ? '#7c3aed' : '#fff', color: comissaoBuscarIdMode ? '#fff' : '#374151',
                  fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Link2 size={13} /> Buscar por ID
              </button>
            </div>
            {comissaoBuscarIdMode && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'flex-end', width: '100%', paddingTop: '6px' }}>
                <input type="text" placeholder="PLL 32/2026 ou ID" value={comissaoMateriaId}
                  onChange={e => setComissaoMateriaId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleComissaoBuscarPorId()}
                  style={{ width: '160px', padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem' }}
                  autoFocus />
                <button onClick={handleComissaoBuscarPorId}
                  style={{ padding: '5px 12px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem' }}>
                  Buscar
                </button>
              </div>
            )}
          </div>

          {/* Grade 3 painéis */}
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 380px', gap: '12px', minHeight: '600px', alignItems: 'start' }}>

            {/* PAINEL ESQUERDO — Fila */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden', background: '#fafafa' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Fila — {comissaoComissao}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {comissaoFila.length > 0 && (
                    <button
                      onClick={() => {
                        if (ataSelectedIds.size === comissaoFila.length) {
                          setAtaSelectedIds(new Set());
                        } else {
                          setAtaSelectedIds(new Set(comissaoFila.map(m => m.id)));
                        }
                      }}
                      style={{ padding: '3px 8px', border: '1px solid #d1d5db', borderRadius: '5px',
                        background: ataSelectedIds.size === comissaoFila.length ? '#f0fdf4' : '#fff',
                        color: ataSelectedIds.size === comissaoFila.length ? '#15803d' : '#6b7280',
                        fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      title={ataSelectedIds.size === comissaoFila.length ? 'Desmarcar todas' : 'Selecionar todas para ATA'}>
                      {ataSelectedIds.size === comissaoFila.length ? '✓ Todas' : '☐ Todas'}
                    </button>
                  )}
                  {comissaoFilaLoading && <Loader2 size={13} style={{ color: '#94a3b8' }} className={styles.spinIcon} />}
                </div>
              </div>
              <div style={{ maxHeight: '580px', overflowY: 'auto' }}>
                {!comissaoFilaLoading && comissaoFila.length === 0 && (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>
                    <Building2 size={28} color="#d1d5db" style={{ marginBottom: '8px' }} />
                    <p style={{ margin: 0 }}>Nenhuma matéria na fila.</p>
                    <p style={{ margin: '4px 0 0', fontSize: '0.73rem' }}>Use "Buscar por ID" para localizar.</p>
                  </div>
                )}
                {comissaoFila.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', borderBottom: '1px solid #f3f4f6',
                    background: selectedComissaoMateriaFila?.id === m.id ? '#f5f3ff' : '#fff',
                    borderLeft: selectedComissaoMateriaFila?.id === m.id ? '3px solid #7c3aed' : '3px solid transparent' }}>
                    {/* Checkbox para ATA */}
                    <label style={{ display: 'flex', alignItems: 'center', padding: '10px 4px 10px 8px', cursor: 'pointer' }}
                      title="Selecionar para ATA" onClick={e => e.stopPropagation()}>
                      <input type="checkbox"
                        checked={ataSelectedIds.has(m.id)}
                        onChange={() => toggleAtaMateriaSelection(m.id)}
                        style={{ accentColor: '#7c3aed', cursor: 'pointer', width: '14px', height: '14px' }} />
                    </label>
                    <button onClick={() => { setSelectedComissaoMateriaFila(m); setComissaoResult(null); setAtaResult(null); loadComissaoContexto(m.id); }}
                      style={{ display: 'block', flex: 1, padding: '10px 12px 10px 4px', border: 'none',
                        background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '4px' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#7c3aed' }}>{m.tipo_sigla} {m.numero}/{m.ano}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                          {m.status_tramitacao && (m.status_tramitacao.toLowerCase().includes('relatoria') || m.status_tramitacao.toLowerCase().includes('relator') || m.status_tramitacao.toLowerCase().includes('gabinete')) && (
                            <span style={{ fontSize: '0.6rem', fontWeight: 700, background: '#fef3c7', color: '#92400e',
                              padding: '1px 6px', borderRadius: '10px', whiteSpace: 'nowrap' }}
                              title="Matéria distribuída a relator">
                              Em Relatoria
                            </span>
                          )}
                          {m.status_relatoria === 'rascunho_gerado'
                            ? <CheckCircle2 size={14} color="#15803d" style={{ flexShrink: 0, marginTop: '1px' }} />
                            : <Clock size={14} color="#9ca3af" style={{ flexShrink: 0, marginTop: '1px' }} />}
                        </div>
                      </div>
                      <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.3,
                        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {m.ementa || '(sem ementa)'}
                      </p>
                    </button>
                  </div>
                ))}
                {selectedComissaoMateriaFila && !comissaoFila.find(m => m.id === selectedComissaoMateriaFila.id) && (
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', background: '#f5f3ff', borderLeft: '3px solid #7c3aed' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#7c3aed' }}>Matéria #{selectedComissaoMateriaFila.id}</span>
                    <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: '#6b7280' }}>
                      {selectedComissaoMateria?.materia?.ementa?.substring(0, 80) || 'Carregando...'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* PAINEL CENTRAL — Contexto */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', background: '#fff', overflow: 'hidden' }}>
              {!selectedComissaoMateriaFila && !comissaoContextoLoading && (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af' }}>
                  <ChevronRight size={36} color="#d1d5db" />
                  <p style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>Selecione uma matéria na fila para ver o contexto.</p>
                </div>
              )}
              {comissaoContextoLoading && (
                <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <Loader2 size={32} color="#94a3b8" className={styles.spinIcon} />
                  <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: '12px' }}>Buscando dados no SAPL...</p>
                </div>
              )}
              {selectedComissaoMateria && !comissaoContextoLoading && (
                <div>
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {selectedComissaoMateria.materia.tipo_sigla} {selectedComissaoMateria.materia.numero}/{selectedComissaoMateria.materia.ano}
                        </span>
                        <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#374151', lineHeight: 1.4 }}>{selectedComissaoMateria.materia.ementa}</p>
                        <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#6b7280' }}>Autor: {selectedComissaoMateria.materia.autores || '—'}</p>
                      </div>
                      <a href={selectedComissaoMateria.materia.sapl_url} target="_blank" rel="noopener noreferrer"
                        style={{ flexShrink: 0, padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
                          background: '#fff', color: '#374151', fontSize: '0.75rem', display: 'flex', alignItems: 'center',
                          gap: '4px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        <ExternalLink size={12} /> SAPL
                      </a>
                    </div>
                  </div>
                  <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {selectedComissaoMateria.procuradoria.voto && (
                      <div>
                        <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Procuradoria</p>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700,
                          color: selectedComissaoMateria.procuradoria.voto === 'FAVORÁVEL' ? '#15803d' : '#b91c1c' }}>
                          {selectedComissaoMateria.procuradoria.voto === 'FAVORÁVEL' ? '✓' : '✗'} {selectedComissaoMateria.procuradoria.voto}
                        </span>
                      </div>
                    )}
                    {selectedComissaoMateria.outras_comissoes.length > 0 && (
                      <div>
                        <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pareceres de outras comissões</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {selectedComissaoMateria.outras_comissoes.map((oc, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                              <span style={{ fontSize: '0.78rem', color: '#374151' }}>{oc.comissao}</span>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: oc.voto.includes('FAVORÁVEL') ? '#15803d' : oc.voto.includes('CONTRÁRIO') ? '#b91c1c' : '#92400e' }}>{oc.voto}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tramitações recentes</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '220px', overflowY: 'auto' }}>
                        {selectedComissaoMateria.tramitacoes.slice(0, 8).map((t, i) => (
                          <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '0.76rem', padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                            <span style={{ color: '#9ca3af', flexShrink: 0, width: '72px' }}>{t.data}</span>
                            <span style={{ color: '#374151', lineHeight: 1.35 }}>{t.texto}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* PAINEL DIREITO — Formulário + Resultados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

              {/* Card — Info da Comissão */}
              {(() => {
                const c = comissoesDisponiveis.find(x => x.sigla === comissaoComissao);
                if (!c) return null;
                const cargoBadge = (cargo: string) => {
                  const map: Record<string, { bg: string; color: string; label: string }> = {
                    presidente:    { bg: '#ede9fe', color: '#5b21b6', label: 'Presidente' },
                    'vice-presidente': { bg: '#dbeafe', color: '#1d4ed8', label: 'Vice' },
                    membro:        { bg: '#f1f5f9', color: '#475569', label: 'Membro' },
                    suplente:      { bg: '#f8fafc', color: '#94a3b8', label: 'Suplente' },
                  };
                  return map[cargo.toLowerCase()] ?? { bg: '#f1f5f9', color: '#475569', label: cargo };
                };
                return (
                  <div style={{ border: '1px solid #ede9fe', borderRadius: '10px', background: '#faf5ff', overflow: 'hidden' }}>
                    {/* Cabeçalho */}
                    <div style={{ padding: '12px 14px', borderBottom: '1px solid #ede9fe', background: '#fff', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Building2 size={18} color="#fff" />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#5b21b6' }}>{c.sigla}</span>
                          {c.artigoRegimento && (
                            <span style={{ fontSize: '0.67rem', background: '#ede9fe', color: '#6d28d9', padding: '2px 7px', borderRadius: '20px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {c.artigoRegimento.split(' ').slice(0, 3).join(' ')}
                            </span>
                          )}
                        </div>
                        <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.35 }}>{c.nome}</p>
                      </div>
                    </div>

                    {/* Área e Lei */}
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid #ede9fe', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <p style={{ margin: 0, fontSize: '0.71rem', color: '#374151', lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 600, color: '#5b21b6' }}>Competência: </span>{c.area}
                      </p>
                      {c.link_lei && (
                        <a href={c.link_lei} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.71rem', color: '#7c3aed', textDecoration: 'none', fontWeight: 600 }}>
                          <ExternalLink size={11} /> Ver resolução no SAPL
                        </a>
                      )}
                    </div>

                    {/* Membros */}
                    <div style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Users size={12} /> Membros
                        </span>
                        {comissaoInfoLoading && <Loader2 size={12} color="#94a3b8" className={styles.spinIcon} />}
                      </div>
                      {!comissaoInfoLoading && comissaoInfoMembros.length === 0 && (
                        <p style={{ margin: 0, fontSize: '0.71rem', color: '#94a3b8', fontStyle: 'italic' }}>
                          {c.sapl_unit_id ? 'Carregando membros...' : 'Composição não disponível no SAPL.'}
                        </p>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {comissaoInfoMembros.map((m, i) => {
                          const badge = cargoBadge(m.cargo);
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', background: '#fff', borderRadius: '6px', border: '1px solid #ede9fe' }}>
                              <span style={{ fontSize: '0.75rem', color: '#1f2937', fontWeight: 500 }}>Ver. {m.nome}</span>
                              <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: badge.bg, color: badge.color, whiteSpace: 'nowrap' }}>
                                {badge.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── CARD: Parecer da Comissão ── */}
              <div className={styles.formCard}>
                <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 700, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <Building2 size={17} /> Parecer da Comissão
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className={styles.formGroup}>
                    <label>Voto da Comissão</label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      {(['FAVORÁVEL', 'CONTRÁRIO', 'SEGUIR RELATOR'] as const).map(v => {
                        const sel = comissaoVoto === v;
                        const c = v === 'FAVORÁVEL' ? { border: '#15803d', bg: '#f0fdf4', text: '#15803d' }
                          : v === 'CONTRÁRIO'       ? { border: '#b91c1c', bg: '#fef2f2', text: '#b91c1c' }
                          :                           { border: '#b45309', bg: '#fffbeb', text: '#b45309' };
                        return (
                          <button key={v} type="button" onClick={() => setComissaoVoto(v)}
                            style={{ flex: v === 'SEGUIR RELATOR' ? 2 : 1, padding: '7px 3px',
                              border: `2px solid ${sel ? c.border : '#e2e8f0'}`,
                              borderRadius: '7px',
                              background: sel ? c.bg : '#fff',
                              color: sel ? c.text : '#6b7280',
                              fontWeight: sel ? 700 : 500, fontSize: '0.7rem', cursor: 'pointer', lineHeight: 1.2 }}>
                            {v === 'FAVORÁVEL' ? '✓ FAVORÁVEL' : v === 'CONTRÁRIO' ? '✗ CONTRÁRIO' : '↪ SEGUIR\nRELATOR'}
                          </button>
                        );
                      })}
                    </div>
                    {comissaoVoto === 'SEGUIR RELATOR' && (
                      <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: '#b45309' }}>
                        O voto acompanhará automaticamente o parecer do relator (padrão: FAVORÁVEL)
                      </p>
                    )}
                  </div>

                  {(() => {
                    // Resolve alvo do parecer: clicada > 1 checkbox > nenhum
                    const soloId = ataSelectedIds.size === 1 ? [...ataSelectedIds][0] : undefined;
                    const parecerTarget = selectedComissaoMateriaFila
                      ?? (soloId ? comissaoFila.find(m => m.id === soloId) : undefined);
                    const disabled = isGerandoComissao || !parecerTarget;
                    return (
                      <>
                        <button onClick={handleGerarParecer} className={styles.generateButton} disabled={disabled}>
                          {isGerandoComissao
                            ? <><Loader2 size={17} className={styles.spinIcon} /> Gerando Parecer...</>
                            : parecerTarget
                              ? <><Building2 size={17} /> Gerar Parecer — {parecerTarget.tipo_sigla} {parecerTarget.numero}/{parecerTarget.ano}</>
                              : <><Building2 size={17} /> Gerar Parecer</>}
                        </button>
                        {!parecerTarget && (
                          <p style={{ margin: 0, fontSize: '0.73rem', color: '#9ca3af', textAlign: 'center' }}>
                            Clique em uma matéria ou marque ☑ apenas uma para gerar o parecer
                          </p>
                        )}
                        {ataSelectedIds.size > 1 && !selectedComissaoMateriaFila && (
                          <p style={{ margin: 0, fontSize: '0.72rem', color: '#b45309', textAlign: 'center' }}>
                            Mais de 1 matéria marcada — clique em uma para selecionar qual gerar o parecer
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* ── CARD: ATA da Reunião ── */}
              <div className={styles.formCard}>
                <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 700, color: '#0f766e', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <FileText size={17} /> ATA da Reunião
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className={styles.formGroup}>
                    <label>Data da Reunião</label>
                    <input type="date" className={styles.input} value={ataData} onChange={e => setAtaData(e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div className={styles.formGroup}>
                      <label style={{ fontSize: '0.75rem' }}>Início (extenso)</label>
                      <input type="text" className={styles.input} value={ataHoraInicio} onChange={e => setAtaHoraInicio(e.target.value)} placeholder="OITO HORAS" style={{ fontSize: '0.8rem' }} />
                    </div>
                    <div className={styles.formGroup}>
                      <label style={{ fontSize: '0.75rem' }}>Fim (extenso)</label>
                      <input type="text" className={styles.input} value={ataHoraFim} onChange={e => setAtaHoraFim(e.target.value)} placeholder="NOVE HORAS" style={{ fontSize: '0.8rem' }} />
                    </div>
                  </div>
                  <button onClick={handleGerarAta} className={styles.generateButton}
                    disabled={isGerandoComissao || ataSelectedIds.size === 0}
                    style={{ background: ataSelectedIds.size > 0 ? '#0f766e' : undefined, borderColor: ataSelectedIds.size > 0 ? '#0d9488' : undefined }}>
                    {isGerandoComissao
                      ? <><Loader2 size={17} className={styles.spinIcon} /> Gerando ATA...</>
                      : <><FileText size={17} /> Gerar ATA ({ataSelectedIds.size} matéria{ataSelectedIds.size !== 1 ? 's' : ''})</>}
                  </button>
                  {ataSelectedIds.size === 0
                    ? <p style={{ margin: 0, fontSize: '0.73rem', color: '#9ca3af', textAlign: 'center' }}>Marque ☑ as matérias na fila para compor a ATA</p>
                    : <p style={{ margin: 0, fontSize: '0.72rem', color: '#0f766e', textAlign: 'center', fontWeight: 500 }}>✔ {ataSelectedIds.size} matéria{ataSelectedIds.size !== 1 ? 's' : ''} selecionada{ataSelectedIds.size !== 1 ? 's' : ''} para ATA</p>
                  }
                </div>
              </div>

              {/* Resultado: Parecer da Comissão */}
              {isGerandoComissao && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '32px 16px', textAlign: 'center', background: '#fff' }}>
                  <LogoLoader size={72} />
                  <p style={{ color: '#6b7280', fontSize: '0.82rem', marginTop: '12px' }}>Gerando documentos...</p>
                </div>
              )}
              {comissaoResult && !isGerandoComissao && (
                <div className={styles.documentViewer}>
                  <div className={styles.documentHeader}>
                    <div className={styles.documentTitleGroup}>
                      <span className={styles.documentSparkle}>✦</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1f2937' }}>PARECER DA COMISSÃO</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleExportComissaoOdt('comissao')} className={styles.exportButton} style={{ background: '#0284c7', color: 'white', borderColor: '#0369a1' }}>
                        <FileText size={15} /> SAPL (.odt)
                      </button>
                      <button onClick={() => handleExportComissaoDocx('comissao')} className={styles.exportButton}>
                        <Download size={15} /> DOCX
                      </button>
                    </div>
                  </div>
                  <A4DocumentViewer>
                    <div className={styles.markdownContent}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{comissaoResult}</ReactMarkdown>
                    </div>
                  </A4DocumentViewer>
                </div>
              )}
              {ataResult && !isGerandoComissao && (
                <div className={styles.documentViewer}>
                  <div className={styles.documentHeader}>
                    <div className={styles.documentTitleGroup}>
                      <span className={styles.documentSparkle}>✦</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1f2937' }}>ATA DA REUNIÃO</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleExportComissaoOdt('ata')} className={styles.exportButton} style={{ background: '#0284c7', color: 'white', borderColor: '#0369a1' }}>
                        <FileText size={15} /> SAPL (.odt)
                      </button>
                      <button onClick={() => handleExportComissaoDocx('ata')} className={styles.exportButton}>
                        <Download size={15} /> DOCX
                      </button>
                    </div>
                  </div>
                  <A4DocumentViewer>
                    <div className={styles.markdownContent}>
                      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, fontSize: '0.85rem', lineHeight: 1.7 }}>{ataResult}</pre>
                    </div>
                  </A4DocumentViewer>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
      <div className={styles.mainGrid}>
        {/* Painel Esquerdo (Inputs e Configs) */}
        <section className={styles.inputSection}>
          
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
                        <div 
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', cursor: 'pointer', padding: '8px 0', flexWrap: 'wrap', gap: '12px' }}
                          onClick={() => setIsUltimasOpen(!isUltimasOpen)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <svg 
                              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                              style={{ transform: isUltimasOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--gray-500)', flexShrink: 0 }}
                            >
                              <path d="m9 18 6-6-6-6"/>
                            </svg>
                            <h4 style={{ fontSize: '0.8125rem', color: '#4b5563', textTransform: 'uppercase', margin: 0, whiteSpace: 'nowrap' }}>
                              Últimas Ordens do Dia
                            </h4>
                            <span style={{ fontSize: '0.65rem', background: '#dbeafe', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, whiteSpace: 'nowrap' }}>Auto-Sync (10m)</span>
                          </div>
                          
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'nowrap' }}>
                            <button 
                              onClick={(e) => { e.stopPropagation(); fetchSessoes(); }} 
                              style={{ background: 'none', border: 'none', color: 'var(--primary-600)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}
                              title="Apenas Recarregar Tela"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>
                              Refresh
                            </button>

                            <button 
                              onClick={(e) => { e.stopPropagation(); handleSincronizarSapl(false); }} 
                              style={{ 
                                background: 'var(--primary-500)', border: 'none', color: 'white', 
                                display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', 
                                fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: '6px',
                                boxShadow: '0 2px 4px rgba(37,99,235,0.2)', whiteSpace: 'nowrap', flexShrink: 0
                              }}
                              title="Forçar Busca Direto no SAPL Imediatamente"
                            >
                              <BrainCircuit size={14} />
                              Sincronizar SAPL
                            </button>
                          </div>
                        </div>
                        
                        {isUltimasOpen && (
                          <div className={styles.sessoesList} style={{ maxHeight: 'max-content', marginBottom: '20px' }}>
                            {ordensDoDiaParaMostrar.length === 0 ? (
                               <p style={{fontSize:'0.812rem', color:'#6b7280', padding: '12px'}}>
                                 {dataFiltro ? 'Nenhuma Ordem do Dia encontrada para esta data.' : 'Procurando Ordens do Dia ativas...'}
                               </p>
                            ) : (
                              ordensDoDiaParaMostrar.map(s => {
                                // SAPL Date format is usually YYYY-MM-DD
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
                              })
                            )}
                          </div>
                        )}

                        <hr style={{ border: 'none', borderTop: '2px solid #cbd5e1', marginBottom: '8px' }} />

                        <div 
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '8px 0', marginBottom: '8px' }}
                          onClick={() => setIsDemaisOpen(!isDemaisOpen)}
                        >
                          <svg 
                            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            style={{ transform: isDemaisOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--gray-500)' }}
                          >
                            <path d="m9 18 6-6-6-6"/>
                          </svg>
                          <h4 style={{ fontSize: '0.8125rem', color: '#4b5563', textTransform: 'uppercase', margin: 0 }}>
                            Demais Sessões do SAPL
                          </h4>
                        </div>
                        
                        {isDemaisOpen && (
                          <div className={styles.sessoesList} style={{ maxHeight: 'max-content' }}>
                            {demaisSessoesParaMostrar.length === 0 ? (
                               <p style={{fontSize:'0.812rem', color:'#6b7280', padding: '12px'}}>Nenhuma sessão adicional encontrada.</p>
                            ) : (
                              demaisSessoesParaMostrar.slice(0, 10).map(s => {
                                const dt = s.data_inicio ? s.data_inicio.split('-').reverse().join('/') : '';
                                return (
                                  <div key={`sessao-${s.id}`} className={styles.sessaoCard} onClick={() => handleSelectSessao(s)}>
                                    <div className={styles.sessaoHeader}>
                                      <strong>{formatarDatasBR(s.__str__ || '') || dt}</strong>
                                    </div>
                                    <p>{dt ? `Sessão em: ${dt}` : 'Visualizar matérias da sessão'}</p>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
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
                            <><BrainCircuit size={16} /> Gerar Parecer ({selectedMaterias.length} {selectedMaterias.length === 1 ? 'matéria' : 'matérias'})</>
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
            <h3>💡 Workflow Avançado</h3>
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
        </section>

        {/* Visualizador de Resultado (Direita) */}
        <section className={styles.outputSection}>
          <div className={`${styles.outputCard} ${parecerResult ? styles.hasContent : ''}`}>
            {/* Theme Toggle removido daqui para evitar dupla ação, focado na exibição limpa. */}

            {!parecerResult && !isGenerating && (
                    <div className={styles.emptyState}>
                      <FileText size={48} color="var(--gray-300)" />
                      <h3>Pronta para iniciar.</h3>
                      <p>Selecione uma sessão na coluna ao lado, escolha as matérias desejadas e clique em <strong>Gerar Parecer</strong>.</p>
                      <br/>
                      <p style={{fontSize: '0.8125rem', color: 'var(--primary-600)', background: 'var(--primary-50)', padding: '12px', borderRadius: '8px'}}>💡 Dica: Se a pauta não apareceu na lista, use a aba <strong>&quot;Pauta em PDF&quot;</strong> para subir o arquivo recebido pelo WhatsApp, ou cole o link da matéria diretamente na aba <strong>&quot;Link Direto&quot;</strong>.</p>
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
    </div>
  );
}

