'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Phone, Mail, Calendar, FileText,
  MessageSquare, Loader2, X, Send, Pencil, Check,
  AlertCircle, Building2, Globe, ChevronLeft, ChevronRight,
  Bell, AlertTriangle, CheckCircle2, Clock, ShieldAlert,
  UserPlus, Download, Cake, Upload, MapPin, RefreshCw
} from 'lucide-react';
import { useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './cadin-dashboard.module.css';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface CadinAuthority {
  id: string;
  personId: string;
  orgId: string | null;
  photoUrl?: string | null;
  nomeOrgao: string;
  orgName: string;
  orgAcronym: string | null;
  tipo: string;
  sphere: string;
  titularNome: string | null;
  titularCargo: string | null;
  phone: string | null;
  email: string | null;
  party: string | null;
  birthday: string | null;   // MM-DD (raw) ou DD/MM (display)
  chefeGab: string | null;
  notes: string | null;
  orgPhone: string | null;
  orgEmail: string | null;
  orgAddress: string | null;
}

interface BirthdayPerson {
  id: string;
  full_name: string;
  phone: string | null;
  birthday_day: number;
  birthday_display: string | null;
  cargo: string | null;
  org_name: string | null;
}

interface PendingUpdate {
  id: string;
  update_type: string;
  extracted_text: string | null;
  source_url: string | null;
  source_date: string | null;
  suggested_changes: Record<string, string> | null;
  confidence: number;
  gemini_summary: string | null;
  status: string;
  created_at: string;
  cadin_persons: { id: string; full_name: string; phone: string | null } | null;
  cadin_organizations: { id: string; name: string; acronym: string | null } | null;
  cadin_monitor_sources: { id: string; name: string; source_type: string } | null;
}

interface CadinPerson {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  cadin_appointments: { title: string; active: boolean }[];
}

interface CiaResult {
  person_id: string;
  person_name: string;
  phone: string;
  status: 'sent' | 'error' | 'skipped';
  message_preview?: string;
  error?: string;
}

interface PdfCacheEntry {
  id: string;
  label: string;
  authority_count: number;
  created_at: string;
  expires_at: string;
  pdf_public_url: string;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const MESES_ABREV = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const MESES_FULL  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const SPHERE_LABEL: Record<string, string> = { federal: 'Federal', estadual: 'Estadual', municipal: 'Municipal' };
const SPHERE_COLOR: Record<string, string> = { federal: '#1d4ed8', estadual: '#9d174d', municipal: '#065f46' };
const SPHERE_BG:    Record<string, string> = { federal: '#eff6ff', estadual: '#fdf2f8', municipal: '#f0fdf4' };

const TIPO_FILTERS = [
  { id: '',                label: 'Todos' },
  { id: 'governo_estadual',label: 'Gov. Estadual' },
  { id: 'secretaria',      label: 'Secretarias' },
  { id: 'autarquia',       label: 'Autarquias' },
  { id: 'fundacao',        label: 'Fundações' },
  { id: 'empresa_publica', label: 'Empresas' },
  { id: 'camara',          label: 'Câmaras' },
  { id: 'prefeitura',      label: 'Prefeituras' },
  { id: 'judiciario',      label: 'Judiciário' },
  { id: 'outros',          label: 'Outros' },
];

const UPDATE_TYPE_LABEL: Record<string, string> = {
  nova_nomecao:  'Nova nomeação',
  exoneracao:    'Exoneração',
  mudanca_cargo: 'Mudança de cargo',
  novo_orgao:    'Novo órgão',
  dado_contato:  'Atualização de contato',
  aniversario:   'Aniversário',
  outros:        'Outro',
};

function getInitials(nome: string | null, orgao: string): string {
  const src = nome || orgao;
  const w = src.trim().split(/\s+/);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function formatBirthday(raw: string | null): string | null {
  if (!raw) return null;
  // Aceita MM-DD (do banco) e DD/MM (display legado)
  if (raw.includes('/')) return raw;
  const parts = raw.split('-');
  if (parts.length === 2) return `${parts[1]}/${parts[0]}`;
  return raw;
}

// ── Componente Principal ──────────────────────────────────────────────────────

export default function CadinDashboard({ tenantId }: { tenantId: string }) {
  void tenantId;

  const [abaPrincipal, setAbaPrincipal] = useState<'lista' | 'monitoramento' | 'aniversarios'>('lista');

  // ── Lista ──────────────────────────────────────────────────────────────────
  const [authorities, setAuthorities] = useState<CadinAuthority[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [esferaFilter, setEsferaFilter] = useState('todos');
  const [tipoFilter, setTipoFilter] = useState('');
  const [sortMode, setSortMode] = useState<'caderno' | 'az'>('caderno');
  const [visibleCount, setVisibleCount] = useState(12);

  const [importingCsv, setImportingCsv] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Monitoramento ──────────────────────────────────────────────────────────
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[]>([]);
  const [pendingStats, setPendingStats] = useState({ pendente: 0, aprovado: 0, rejeitado: 0, aplicado: 0 });
  const [pendingLoading, setPendingLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [syncingDO, setSyncingDO] = useState(false);

  // ── Aniversários ────────────────────────────────────────────────────────────
  const [bdMonth, setBdMonth] = useState(new Date().getMonth() + 1);
  const [bdDay, setBdDay] = useState<number | null>(null);
  const [bdPersons, setBdPersons] = useState<BirthdayPerson[]>([]);
  const [bdLoading, setBdLoading] = useState(false);
  const [bdStats, setBdStats] = useState<number[]>(Array(12).fill(0));

  // ── Edit drawer ─────────────────────────────────────────────────────────────
  const [editAuth, setEditAuth] = useState<CadinAuthority | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: '', phone: '', email: '', party: '',
    cargo: '', birthday: '', chefeGab: '', photo_url: '',
    org_sphere: '', org_type: '', org_address: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Nova Autoridade ─────────────────────────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    full_name: '', phone: '', email: '', party: '',
    cargo: '', birthday: '', chefeGab: '',
    org_name: '', org_acronym: '', org_type: 'secretaria', org_sphere: 'estadual',
    org_phone: '', org_email: '', org_address: '',
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // ── CIa Modal ───────────────────────────────────────────────────────────────
  const [ciaOpen, setCiaOpen] = useState(false);
  const [ciaPersons, setCiaPersons] = useState<CadinPerson[]>([]);
  const [ciaLoadingPersons, setCiaLoadingPersons] = useState(false);
  const [ciaSelected, setCiaSelected] = useState<string[]>([]);
  const [ciaContext, setCiaContext] = useState('');
  const [ciaDispatching, setCiaDispatching] = useState(false);
  const [ciaResults, setCiaResults] = useState<CiaResult[] | null>(null);

  // ── Export PDF + History ────────────────────────────────────────────────────
  const [exportingPDF, setExportingPDF] = useState(false);
  const [pdfHistory, setPdfHistory] = useState<PdfCacheEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  // ── Carregar dados ──────────────────────────────────────────────────────────
  const loadAuthorities = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ sort: sortMode });
    fetch(`/api/cadin/organizations?${params}`)
      .then(r => r.json())
      .then(d => setAuthorities(Array.isArray(d) ? d : []))
      .catch(() => setAuthorities([]))
      .finally(() => setLoading(false));
  }, [sortMode]);

  const loadPendingUpdates = useCallback(() => {
    setPendingLoading(true);
    fetch('/api/cadin/pending-updates?status=pendente&limit=30')
      .then(r => r.json())
      .then(d => {
        setPendingUpdates(d.results ?? []);
        if (d.stats) setPendingStats(d.stats);
      })
      .catch(() => setPendingUpdates([]))
      .finally(() => setPendingLoading(false));
  }, []);

  useEffect(() => { loadAuthorities(); }, [loadAuthorities]);

  useEffect(() => {
    if (abaPrincipal === 'monitoramento') loadPendingUpdates();
  }, [abaPrincipal, loadPendingUpdates]);

  useEffect(() => {
    setBdLoading(true);
    const params = new URLSearchParams({ month: String(bdMonth) });
    if (bdDay !== null) params.set('day', String(bdDay));
    fetch(`/api/cadin/birthdays?${params}`)
      .then(r => r.json())
      .then(d => setBdPersons(d.birthdays || []))
      .catch(() => setBdPersons([]))
      .finally(() => setBdLoading(false));
  }, [bdMonth, bdDay]);

  // Fecha o dropdown de histórico ao clicar fora
  useEffect(() => {
    if (!historyOpen) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [historyOpen]);

  useEffect(() => {
    if (abaPrincipal === 'aniversarios') {
      fetch('/api/cadin/birthdays?month=all')
        .then(r => r.json())
        .then(d => {
          if (d.stats) setBdStats(d.stats);
        })
        .catch(() => setBdStats(Array(12).fill(0)));
    }
  }, [abaPrincipal]);

  // ── Filtra cards ────────────────────────────────────────────────────────────
  const filtered = authorities.filter(a => {
    const q = searchTerm.toLowerCase();
    if (searchTerm && !(
      (a.titularNome || '').toLowerCase().includes(q) ||
      (a.nomeOrgao || '').toLowerCase().includes(q) ||
      (a.titularCargo || '').toLowerCase().includes(q) ||
      (a.party || '').toLowerCase().includes(q)
    )) return false;
    if (esferaFilter !== 'todos' && a.sphere !== esferaFilter) return false;
    if (tipoFilter && a.tipo?.toLowerCase() !== tipoFilter.toLowerCase()) return false;
    return true;
  });

  const sorted = sortMode === 'az'
    ? [...filtered].sort((a, b) =>
        (a.titularNome || a.nomeOrgao || '').localeCompare(b.titularNome || b.nomeOrgao || '', 'pt-BR'))
    : filtered;

  const resumo = {
    total:    authorities.length,
    estadual: authorities.filter(a => a.sphere === 'estadual').length,
    federal:  authorities.filter(a => a.sphere === 'federal').length,
    municipal: authorities.filter(a => a.sphere === 'municipal').length,
  };

  // ── Edit handlers ───────────────────────────────────────────────────────────
  const openEdit = (auth: CadinAuthority) => {
    setEditAuth(auth);
    setEditForm({
      full_name:  auth.titularNome || '',
      phone:      auth.phone || '',
      email:      auth.email || '',
      party:      auth.party || '',
      cargo:      auth.titularCargo || '',
      birthday:   formatBirthday(auth.birthday) || '',
      chefeGab:   auth.chefeGab || '',
      photo_url:  '',
      org_sphere: auth.sphere || 'estadual',
      org_type:   auth.tipo || 'secretaria',
      org_address: auth.orgAddress || '',
    });
    setSaveError('');
    setSaveOk(false);
    setConfirmDelete(false);
  };

  const closeEdit = () => { setEditAuth(null); setSaveError(''); setSaveOk(false); setConfirmDelete(false); };

  const handleDelete = async () => {
    if (!editAuth || !confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/cadin/persons/${editAuth.personId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao remover');
      setAuthorities(prev => prev.filter(a => a.personId !== editAuth.personId));
      closeEdit();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Erro ao remover');
    } finally { setDeleting(false); }
  };

  const handleSave = async () => {
    if (!editAuth) return;
    setSaving(true); setSaveError(''); setSaveOk(false);
    try {
      // DD/MM → MM-DD
      let bd = '';
      if (editForm.birthday) {
        const p = editForm.birthday.split('/');
        if (p.length === 2) bd = `${p[1]}-${p[0]}`;
        else bd = editForm.birthday;
      }
      const res = await fetch(`/api/cadin/persons/${editAuth.personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: editForm.full_name, phone: editForm.phone || null,
          email: editForm.email || null, party: editForm.party || null,
          cargo: editForm.cargo, birthday: bd || null,
          chefeGab: editForm.chefeGab || null, photo_url: editForm.photo_url || null,
          org_sphere: editForm.org_sphere || null, org_type: editForm.org_type || null,
          org_address: editForm.org_address || null,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Erro ao salvar'); }
      setSaveOk(true);
      setAuthorities(prev => prev.map(a =>
        a.personId === editAuth.personId
          ? { ...a, titularNome: editForm.full_name, phone: editForm.phone || null,
              email: editForm.email || null, party: editForm.party || null,
              titularCargo: editForm.cargo, birthday: bd || null,
              chefeGab: editForm.chefeGab || null,
              sphere: editForm.org_sphere || a.sphere, tipo: editForm.org_type || a.tipo,
              orgAddress: editForm.org_address || a.orgAddress }
          : a
      ));
      setTimeout(closeEdit, 1200);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Erro desconhecido');
    } finally { setSaving(false); }
  };

  const handlePhotoUpload = async (personId: string, file?: File | null) => {
    if (!file) return;
    setUploadingPhoto(true);
    setSaveError('');
    try {
      const formData = new FormData();
      formData.append('photo', file);
      
      const res = await fetch(`/api/cadin/persons/${personId}/photo`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao subir foto');
      
      setEditForm(f => ({ ...f, photo_url: data.photo_url }));
      setAuthorities(prev => prev.map(a => 
        a.personId === personId ? { ...a, photoUrl: data.photo_url } : a
      ));
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (e: any) {
      setSaveError(e.message || 'Erro ao subir foto');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // ── Nova Autoridade ─────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newForm.full_name.trim()) { setCreateError('Nome é obrigatório'); return; }
    setCreating(true); setCreateError('');
    try {
      let bd = '';
      if (newForm.birthday) {
        const p = newForm.birthday.split('/');
        if (p.length === 2) bd = `${p[1]}-${p[0]}`;
        else bd = newForm.birthday;
      }
      const res = await fetch('/api/cadin/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: newForm.full_name.trim(), phone: newForm.phone || null,
          email: newForm.email || null, party: newForm.party || null,
          cargo: newForm.cargo || null, birthday: bd || null,
          chefe_gabinete: newForm.chefeGab || null,
          org_name: newForm.org_name || null, org_acronym: newForm.org_acronym || null,
          org_type: newForm.org_type, org_sphere: newForm.org_sphere,
          org_phone: newForm.org_phone || null, org_email: newForm.org_email || null,
          org_address: newForm.org_address || null,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Erro ao criar'); }
      setNewOpen(false);
      setNewForm({ full_name: '', phone: '', email: '', party: '', cargo: '', birthday: '',
        chefeGab: '', org_name: '', org_acronym: '', org_type: 'secretaria', org_sphere: 'estadual',
        org_phone: '', org_email: '', org_address: '' });
      loadAuthorities();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Erro ao criar');
    } finally { setCreating(false); }
  };

  // ── Monitoramento ───────────────────────────────────────────────────────────
  const handleReview = async (id: string, action: 'aprovar' | 'rejeitar') => {
    setReviewingId(id);
    try {
      const res = await fetch(`/api/cadin/pending-updates/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('Falha');
      setPendingUpdates(prev => prev.filter(p => p.id !== id));
      setPendingStats(s => ({
        ...s,
        pendente: Math.max(0, s.pendente - 1),
        [action === 'aprovar' ? 'aplicado' : 'rejeitado']: s[action === 'aprovar' ? 'aplicado' : 'rejeitado'] + 1,
      }));
    } catch { /* silent */ } finally { setReviewingId(null); }
  };

  // ── CIa ─────────────────────────────────────────────────────────────────────
  const openCiaModal = async () => {
    setCiaOpen(true); setCiaResults(null); setCiaSelected([]); setCiaContext('');
    if (ciaPersons.length > 0) return;
    setCiaLoadingPersons(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('cadin_persons')
        .select('id, full_name, phone, email, cadin_appointments(title, active)')
        .not('phone', 'is', null).order('full_name');
      setCiaPersons((data as CadinPerson[]) ?? []);
    } catch { /* silent */ } finally { setCiaLoadingPersons(false); }
  };

  const handleDisparar = async () => {
    if (!ciaSelected.length || !ciaContext.trim()) return;
    setCiaDispatching(true); setCiaResults(null);
    try {
      const res = await fetch('/api/cadin/assistente/disparar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_ids: ciaSelected, context: ciaContext.trim() }),
      });
      const d = await res.json();
      setCiaResults(res.ok ? d.results ?? [] : [{ person_id: '', person_name: '', phone: '', status: 'error', error: d.error ?? 'Erro' }]);
    } catch (e: unknown) {
      setCiaResults([{ person_id: '', person_name: '', phone: '', status: 'error', error: e instanceof Error ? e.message : 'Erro de rede' }]);
    } finally { setCiaDispatching(false); }
  };

  // ── Export PDF + Histórico ───────────────────────────────────────────────────
  const loadPdfHistory = useCallback(() => {
    setLoadingHistory(true);
    fetch('/api/cadin/pdf-history')
      .then(r => r.json())
      .then(d => setPdfHistory(d.entries ?? []))
      .catch(() => setPdfHistory([]))
      .finally(() => setLoadingHistory(false));
  }, []);

  const handleExportPDF = async () => {
    setExportingPDF(true);
    try {
      let url: string;
      let filename: string;

      if (abaPrincipal === 'aniversarios') {
        const p = new URLSearchParams({ month: String(bdMonth) });
        if (bdDay !== null) p.set('day', String(bdDay));
        url = `/api/cadin/export-pdf-birthdays?${p}`;
        filename = bdDay !== null
          ? `Aniversariantes_${String(bdDay).padStart(2,'0')}_${MESES_FULL[bdMonth - 1]}.pdf`
          : `Aniversariantes_${MESES_FULL[bdMonth - 1]}.pdf`;
      } else {
        const p = new URLSearchParams();
        if (esferaFilter !== 'todos') p.set('sphere', esferaFilter);
        if (tipoFilter) p.set('type', tipoFilter);
        url = `/api/cadin/export-pdf?${p}`;
        filename = `Caderno_Autoridades_${new Date().toISOString().slice(0, 10)}.pdf`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const msg = text.startsWith('{') ? (JSON.parse(text)?.instrucao ?? text) : text;
        alert(`Erro ao gerar PDF (${res.status}): ${msg || 'Tente novamente.'}`);
        return;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
      // Atualiza histórico após geração
      loadPdfHistory();
    } catch (e) {
      alert(`Falha na geração do PDF: ${e instanceof Error ? e.message : 'Erro de rede'}`);
    } finally {
      setExportingPDF(false);
    }
  };

  // ── CSV Import ─────────────────────────────────────────────────────────────
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingCsv(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) throw new Error("CSV vazio ou sem cabeçalho (requer: nome, cargo, orgao, esfera...)");
      
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const data = lines.slice(1).map(line => {
        const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const obj: any = {};
        headers.forEach((h, i) => { obj[h] = (values[i] || '').replace(/^"|"$/g, '').trim() });
        return obj;
      });

      let successCount = 0;
      let errorCount = 0;

      for (const row of data) {
        if (!row.nome) continue;
        const res = await fetch('/api/cadin/persons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: row.nome,
            cargo: row.cargo || null,
            org_name: row.orgao || null,
            org_sphere: row.esfera || 'estadual',
            phone: row.telefone || null,
            email: row.email || null,
            party: row.partido || null,
            birthday: row.aniversario || null,
            org_type: row.tipo_orgao || 'secretaria'
          }),
        });
        if (res.ok) successCount++;
        else errorCount++;
      }
      alert(`Importação concluída: ${successCount} salvos, ${errorCount} erros.`);
      loadAuthorities();
    } catch (err: any) {
      alert("Erro ao importar CSV: " + err.message);
    } finally {
      setImportingCsv(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSyncDO = async () => {
    setSyncingDO(true);
    try {
      const res = await fetch('/api/cadin/sync-do', { method: 'POST' });
      if (!res.ok) throw new Error('Falha ao acionar sincronização');
      alert('Sincronização de Diários Oficiais iniciada com sucesso. A ALIA está vasculhando as publicações. Resultados aparecerão no Monitoramento em breve.');
    } catch (e: any) {
      alert(e.message || 'Erro de rede ao acionar Sync');
    } finally {
      setSyncingDO(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      <main className={styles.mainContent}>

        {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
        <div className={styles.topbar}>
          <div className={styles.searchGroup}>
            <Search className={styles.searchIcon} size={18} />
            <input
              type="text"
              placeholder="Buscar por nome, cargo, órgão, partido..."
              className={styles.searchInput}
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setVisibleCount(12); }}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className={styles.searchClear}>
                <X size={14} />
              </button>
            )}
          </div>
          <div className={styles.topActions}>
            <button className={styles.exportBtn} onClick={handleSyncDO} disabled={syncingDO} title="Sincronizar Diários Oficiais (Estado, Município, TJ) agora">
              {syncingDO ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={16} />}
              Sync D.O.
            </button>
            {pendingStats.pendente > 0 && (
              <button
                className={styles.alertBtn}
                onClick={() => setAbaPrincipal('monitoramento')}
                title="Atualizações pendentes do Diário Oficial"
              >
                <Bell size={16} />
                <span className={styles.alertCount}>{pendingStats.pendente}</span>
              </button>
            )}
            <button className={styles.exportBtn} onClick={handleExportPDF} disabled={exportingPDF}
              title={abaPrincipal === 'aniversarios'
                ? `Exportar aniversariantes em PDF`
                : (esferaFilter !== 'todos' || tipoFilter)
                  ? 'Exportar filtro atual em PDF'
                  : 'Exportar caderno completo em PDF'}
            >
              {exportingPDF ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={16} />}
              PDF
            </button>
            <div ref={historyRef} className={styles.historyWrapper}>
              <button
                className={styles.exportBtn}
                title="Histórico de PDFs gerados"
                onClick={() => { setHistoryOpen(o => !o); if (!historyOpen) loadPdfHistory(); }}
              >
                <Clock size={16} />
              </button>
              {historyOpen && (
                <div className={styles.historyDropdown}>
                  <div className={styles.historyDropHead}>
                    <span>PDFs Gerados</span>
                    <button className={styles.historyCloseBtn} onClick={() => setHistoryOpen(false)}>
                      <X size={13} />
                    </button>
                  </div>
                  {loadingHistory ? (
                    <div className={styles.historyEmpty}>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />
                      Carregando...
                    </div>
                  ) : pdfHistory.length === 0 ? (
                    <div className={styles.historyEmpty}>Nenhum PDF gerado ainda</div>
                  ) : (
                    pdfHistory.map(entry => (
                      <a
                        key={entry.id}
                        href={entry.pdf_public_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.historyItem}
                        download
                      >
                        <div className={styles.historyItemLabel}>{entry.label}</div>
                        <div className={styles.historyItemMeta}>
                          {entry.authority_count} registros · {new Date(entry.created_at).toLocaleDateString('pt-BR')}
                        </div>
                      </a>
                    ))
                  )}
                </div>
              )}
            </div>
            <button className={styles.ciaBtn} onClick={openCiaModal}>
              <MessageSquare size={16} />
              CIa
            </button>
            <input type="file" accept=".csv" ref={fileInputRef} style={{ display: 'none' }} onChange={handleCsvUpload} />
            <button className={styles.exportBtn} onClick={() => fileInputRef.current?.click()} disabled={importingCsv} title="Importar via arquivo CSV: nome, cargo, orgao, esfera, telefone, email, partido, aniversario">
              {importingCsv ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={16} />}
              Importar CSV
            </button>
            <button className={styles.newBtn} onClick={() => setNewOpen(true)}>
              <UserPlus size={16} />
              Nova Autoridade
            </button>
          </div>
        </div>

        {/* ── HEADER + STATS ─────────────────────────────────────────────── */}
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.headerTitle}>Caderno de Autoridades</h1>
            <p className={styles.headerSubtitle}>
              {resumo.total} autoridades ·{' '}
              <span style={{ color: SPHERE_COLOR.estadual }}>{resumo.estadual} estaduais</span> ·{' '}
              <span style={{ color: SPHERE_COLOR.federal }}>{resumo.federal} federais</span> ·{' '}
              <span style={{ color: SPHERE_COLOR.municipal }}>{resumo.municipal} municipais</span>
            </p>
          </div>
        </div>

        {/* ── ABAS ────────────────────────────────────────────────────────── */}
        <div className={styles.tabBar}>
          {([
            { id: 'lista',         label: 'Lista de Autoridades', Icon: Building2 },
            { id: 'monitoramento', label: `Monitoramento${pendingStats.pendente > 0 ? ` (${pendingStats.pendente})` : ''}`, Icon: ShieldAlert },
            { id: 'aniversarios',  label: 'Aniversários', Icon: Cake },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`${styles.tabBtn} ${abaPrincipal === id ? styles.tabBtnActive : ''}`}
              onClick={() => setAbaPrincipal(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            ABA LISTA
        ══════════════════════════════════════════════════════════════════ */}
        {abaPrincipal === 'lista' && (
          <>
            {/* Filtros */}
            <div className={styles.filtersRow}>
              <div className={styles.filterGroup}>
                <Globe size={12} style={{ color: '#94a3b8' }} />
                {['todos', 'estadual', 'federal', 'municipal'].map(s => (
                  <button
                    key={s}
                    className={`${styles.filterPill} ${esferaFilter === s ? styles.filterPillActive : ''}`}
                    style={esferaFilter === s && s !== 'todos' ? {
                      background: SPHERE_BG[s], color: SPHERE_COLOR[s],
                      borderColor: SPHERE_COLOR[s] + '60',
                    } : {}}
                    onClick={() => { setEsferaFilter(s); setVisibleCount(12); }}
                  >
                    {s === 'todos' ? 'Todos' : SPHERE_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className={styles.filterGroup}>
                <Building2 size={12} style={{ color: '#94a3b8' }} />
                {TIPO_FILTERS.map(f => (
                  <button
                    key={f.id}
                    className={`${styles.filterPill} ${tipoFilter === f.id ? styles.filterPillActive : ''}`}
                    onClick={() => { setTipoFilter(f.id); setVisibleCount(12); }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className={styles.filterGroup} style={{ marginLeft: 'auto' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>ORDEM</span>
                {(['caderno', 'az'] as const).map(m => (
                  <button
                    key={m}
                    className={`${styles.filterPill} ${sortMode === m ? styles.filterPillActive : ''}`}
                    onClick={() => { setSortMode(m); setVisibleCount(12); }}
                  >
                    {m === 'caderno' ? 'Caderno' : 'A-Z'}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid de cards */}
            {loading ? (
              <div className={styles.loadingState}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Carregando autoridades...</span>
              </div>
            ) : sorted.length === 0 ? (
              <div className={styles.emptyState}>
                <Building2 size={40} style={{ color: '#cbd5e1', marginBottom: 8 }} />
                <p>Nenhuma autoridade encontrada</p>
                {searchTerm && <button className={styles.filterPill} onClick={() => setSearchTerm('')}>Limpar busca</button>}
              </div>
            ) : (
              <>
                <div className={styles.cardsGrid}>
                  {sorted.slice(0, visibleCount).map(auth => (
                    <AuthorityCard
                      key={auth.id}
                      auth={auth}
                      onEdit={() => openEdit(auth)}
                    />
                  ))}
                </div>
                {visibleCount < sorted.length && (
                  <button className={styles.loadMoreBtn} onClick={() => setVisibleCount(v => v + 12)}>
                    Ver mais ({sorted.length - visibleCount} restantes)
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            ABA MONITORAMENTO
        ══════════════════════════════════════════════════════════════════ */}
        {abaPrincipal === 'monitoramento' && (
          <div className={styles.monitoramentoSection}>
            {/* Stats */}
            <div className={styles.monitorStats}>
              <div className={styles.monitorStat}>
                <Clock size={18} style={{ color: '#f59e0b' }} />
                <span className={styles.monitorStatNum}>{pendingStats.pendente}</span>
                <span className={styles.monitorStatLabel}>Pendentes</span>
              </div>
              <div className={styles.monitorStat}>
                <CheckCircle2 size={18} style={{ color: '#10b981' }} />
                <span className={styles.monitorStatNum}>{pendingStats.aplicado}</span>
                <span className={styles.monitorStatLabel}>Aplicados</span>
              </div>
              <div className={styles.monitorStat}>
                <X size={18} style={{ color: '#ef4444' }} />
                <span className={styles.monitorStatNum}>{pendingStats.rejeitado}</span>
                <span className={styles.monitorStatLabel}>Rejeitados</span>
              </div>
            </div>

            {pendingLoading ? (
              <div className={styles.loadingState}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Carregando fila de atualizações...</span>
              </div>
            ) : pendingUpdates.length === 0 ? (
              <div className={styles.emptyState}>
                <CheckCircle2 size={40} style={{ color: '#10b981', marginBottom: 8 }} />
                <p>Nenhuma atualização pendente</p>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>O monitoramento de Diários Oficiais está em dia.</span>
              </div>
            ) : (
              <div className={styles.updatesList}>
                {pendingUpdates.map(upd => (
                  <PendingUpdateCard
                    key={upd.id}
                    update={upd}
                    reviewing={reviewingId === upd.id}
                    onAprovar={() => handleReview(upd.id, 'aprovar')}
                    onRejeitar={() => handleReview(upd.id, 'rejeitar')}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            ABA ANIVERSÁRIOS
        ══════════════════════════════════════════════════════════════════ */}
        {abaPrincipal === 'aniversarios' && (
          <div className={styles.aniversariosSection}>
            {/* Gráfico Visual de Aniversários */}
            <div className={styles.chartContainer}>
              {MESES_ABREV.map((m, i) => {
                const count = bdStats[i];
                const maxCount = Math.max(...bdStats, 1);
                const heightPercent = `${(count / maxCount) * 100}%`;
                const isActive = bdMonth === i + 1;
                return (
                  <button 
                    key={i} 
                    className={`${styles.chartColumn} ${isActive ? styles.isActive : ''}`} 
                    onClick={() => { setBdMonth(i + 1); setBdDay(null); }}
                  >
                    <div className={styles.chartBarArea}>
                      <div className={styles.chartBar} style={{ height: heightPercent }}>
                        <span className={styles.chartValue}>{count > 0 ? count : ''}</span>
                      </div>
                    </div>
                    <span className={styles.chartLabel}>{m}</span>
                  </button>
                );
              })}
            </div>

            <div className={styles.birthdayDayFilter}>
              <button
                className={`${styles.filterPill} ${bdDay === new Date().getDate() && bdMonth === new Date().getMonth() + 1 ? styles.filterPillActive : ''}`}
                onClick={() => {
                  const today = new Date();
                  setBdMonth(today.getMonth() + 1);
                  setBdDay(today.getDate());
                }}
                style={bdDay === new Date().getDate() && bdMonth === new Date().getMonth() + 1 ? { background: '#fce7f3', color: '#be185d', borderColor: '#f9a8d4' } : {}}
              >
                <Cake size={12} />
                Hoje ({String(new Date().getDate()).padStart(2, '0')}/{String(new Date().getMonth() + 1).padStart(2, '0')})
              </button>

              <select
                className={styles.daySelect}
                value={bdDay ?? ''}
                onChange={e => setBdDay(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">Todos os dias</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{String(d).padStart(2, '0')}</option>
                ))}
              </select>

              {bdDay !== null && (
                <button
                  className={styles.filterPill}
                  onClick={() => setBdDay(null)}
                  style={{ background: '#fee2e2', color: '#b91c1c', borderColor: '#fca5a5' }}
                >
                  <X size={12} /> Limpar dia
                </button>
              )}
            </div>

            <div className={styles.birthdayHeader}>
              <h3 className={styles.birthdayTitle}>
                {bdDay !== null
                  ? `Aniversariantes em ${String(bdDay).padStart(2, '0')}/${String(bdMonth).padStart(2, '0')}`
                  : `Aniversariantes em ${MESES_FULL[bdMonth - 1]}`
                }
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!bdLoading && <span className={styles.bdCount}>{bdPersons.length} contatos</span>}
                {!bdLoading && bdPersons.length > 0 && (
                  <button
                    className={styles.exportBtn}
                    title="Exportar lista em PDF"
                    onClick={handleExportPDF}
                    disabled={exportingPDF}
                  >
                    {exportingPDF ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
                    PDF
                  </button>
                )}
              </div>
            </div>

            {bdLoading ? (
              <div className={styles.loadingState}>
                <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            ) : bdPersons.length === 0 ? (
              <div className={styles.emptyState}>
                <Cake size={36} style={{ color: '#cbd5e1', marginBottom: 8 }} />
                <p>Nenhum aniversariante em {MESES_FULL[bdMonth - 1]}</p>
              </div>
            ) : (
              <div className={styles.birthdayGrid}>
                {bdPersons.map(p => (
                  <div key={p.id} className={`glass-card ${styles.birthdayCard}`}>
                    <div className={styles.bdAvatar}>
                      {p.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.bdInfo}>
                      <span className={styles.bdNome}>{p.full_name}</span>
                      {p.cargo && <span className={styles.bdCargo}>{p.cargo}</span>}
                      {p.org_name && <span className={styles.bdOrg}>{p.org_name}</span>}
                      <span className={styles.bdDate}>
                        <Calendar size={12} /> {p.birthday_display ?? `dia ${p.birthday_day}`}
                      </span>
                    </div>
                    {p.phone && (
                      <a href={`https://wa.me/55${p.phone.replace(/\D/g, '')}`}
                         target="_blank" rel="noopener noreferrer"
                         className={styles.bdWaBtn} title="WhatsApp">
                        <MessageSquare size={14} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

      {/* ══════════════════════════════════════════════════════════════════════
          EDIT DRAWER
      ════════════════════════════════════════════════════════════════════════ */}
      {editAuth && (
        <div className={styles.drawerOverlay} onClick={closeEdit}>
          <aside className={styles.editDrawer} onClick={e => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <h2 className={styles.drawerTitle}>Editar Autoridade</h2>
              <button className={styles.drawerClose} onClick={closeEdit}><X size={20} /></button>
            </div>

            {/* Sphere badge */}
            <div className={styles.drawerSphereBadge} style={{
              background: SPHERE_BG[editAuth.sphere] ?? '#f8fafc',
              color: SPHERE_COLOR[editAuth.sphere] ?? '#64748b',
            }}>
              {SPHERE_LABEL[editAuth.sphere] ?? editAuth.sphere} · {editAuth.nomeOrgao}
            </div>

            <div className={styles.drawerAvatarSection}>
              <div 
                className={styles.drawerAvatarContainer} 
                onClick={() => document.getElementById('photo-upload-input')?.click()}
                title="Alterar Foto"
              >
                {uploadingPhoto ? (
                  <Loader2 className="animate-spin" size={24} />
                ) : editForm.photo_url ? (
                  <img src={editForm.photo_url} alt="Foto" className={styles.drawerAvatarImg} />
                ) : (
                  <span className={styles.drawerAvatarInitials}>{getInitials(editAuth.titularNome, editAuth.nomeOrgao)}</span>
                )}
                <div className={styles.drawerAvatarOverlay}>
                  <Upload size={16} />
                  <span>Mudar</span>
                </div>
              </div>
              <input 
                id="photo-upload-input" 
                type="file" 
                accept="image/*" 
                style={{ display: 'none' }} 
                onChange={(e) => handlePhotoUpload(editAuth.personId, e.target.files?.[0])}
              />
            </div>

            <div className={styles.drawerForm}>
              {/* Dados pessoais */}
              <div className={styles.drawerSection}>
                <span className={styles.drawerSectionLabel}>Dados da Autoridade</span>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Nome completo</label>
                  <input className={styles.drawerInput} value={editForm.full_name}
                    onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Cargo / Função</label>
                  <input className={styles.drawerInput} value={editForm.cargo}
                    onChange={e => setEditForm(f => ({ ...f, cargo: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldGrid}>
                  <div className={styles.drawerFieldRow}>
                    <label className={styles.drawerLabel}>Telefone / WhatsApp</label>
                    <input className={styles.drawerInput} value={editForm.phone} placeholder="(95) 99999-9999"
                      onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                  <div className={styles.drawerFieldRow}>
                    <label className={styles.drawerLabel}>Email</label>
                    <input className={styles.drawerInput} value={editForm.email} type="email"
                      onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
                <div className={styles.drawerFieldGrid}>
                  <div className={styles.drawerFieldRow}>
                    <label className={styles.drawerLabel}>Partido</label>
                    <input className={styles.drawerInput} value={editForm.party} placeholder="Ex: PSD"
                      onChange={e => setEditForm(f => ({ ...f, party: e.target.value }))} />
                  </div>
                  <div className={styles.drawerFieldRow}>
                    <label className={styles.drawerLabel}>Aniversário (DD/MM)</label>
                    <input className={styles.drawerInput} value={editForm.birthday} placeholder="Ex: 15/05"
                      onChange={e => setEditForm(f => ({ ...f, birthday: e.target.value }))} />
                  </div>
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Chefe de Gabinete</label>
                  <input className={styles.drawerInput} value={editForm.chefeGab}
                    onChange={e => setEditForm(f => ({ ...f, chefeGab: e.target.value }))} />
                </div>
              </div>

              {/* Dados da organização */}
              <div className={styles.drawerSection}>
                <span className={styles.drawerSectionLabel}>Organização</span>
                <div className={styles.drawerFieldGrid}>
                  <div className={styles.drawerFieldRow}>
                    <label className={styles.drawerLabel}>Esfera</label>
                    <select className={styles.drawerSelect} value={editForm.org_sphere}
                      onChange={e => setEditForm(f => ({ ...f, org_sphere: e.target.value }))}>
                      <option value="federal">Federal</option>
                      <option value="estadual">Estadual</option>
                      <option value="municipal">Municipal</option>
                    </select>
                  </div>
                  <div className={styles.drawerFieldRow}>
                    <label className={styles.drawerLabel}>Tipo</label>
                    <select className={styles.drawerSelect} value={editForm.org_type}
                      onChange={e => setEditForm(f => ({ ...f, org_type: e.target.value }))}>
                      <option value="governo_estadual">Governo Estadual</option>
                      <option value="secretaria">Secretaria</option>
                      <option value="autarquia">Autarquia</option>
                      <option value="fundacao">Fundação</option>
                      <option value="empresa_publica">Empresa Pública</option>
                      <option value="camara">Câmara</option>
                      <option value="prefeitura">Prefeitura</option>
                      <option value="judiciario">Judiciário</option>
                      <option value="outros">Outros</option>
                    </select>
                  </div>
                </div>
                <div className={styles.drawerFieldRow} style={{ marginTop: '12px' }}>
                  <label className={styles.drawerLabel}>Endereço do Departamento</label>
                  <input className={styles.drawerInput} value={editForm.org_address} placeholder="Logradouro..."
                    onChange={e => setEditForm(f => ({ ...f, org_address: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Feedback */}
            {saveError && (
              <div className={styles.saveError}>
                <AlertCircle size={14} /> {saveError}
              </div>
            )}
            {saveOk && (
              <div className={styles.saveOk}>
                <Check size={14} /> Salvo com sucesso
              </div>
            )}

            {/* Actions */}
            <div className={styles.drawerFooter}>
              <div>
                {!confirmDelete ? (
                  <button className={styles.btnDelete} onClick={() => setConfirmDelete(true)}>
                    Remover
                  </button>
                ) : (
                  <button className={styles.btnDeleteConfirm} onClick={handleDelete} disabled={deleting}>
                    {deleting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                    Confirmar remoção
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={styles.btnCancel} onClick={closeEdit}>Cancelar</button>
                <button className={styles.btnSave} onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
                  Salvar
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — NOVA AUTORIDADE
      ════════════════════════════════════════════════════════════════════════ */}
      {newOpen && (
        <div className={styles.drawerOverlay} onClick={() => setNewOpen(false)}>
          <div className={`glass-card ${styles.newModal}`} onClick={e => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <h2 className={styles.drawerTitle}>Nova Autoridade</h2>
              <button className={styles.drawerClose} onClick={() => setNewOpen(false)}><X size={20} /></button>
            </div>

            <div className={styles.newModalBody}>
              {/* Pessoa */}
              <p className={styles.drawerSectionLabel}>Dados da Autoridade</p>
              <div className={styles.drawerFieldGrid}>
                <div className={styles.drawerFieldRow} style={{ gridColumn: '1/-1' }}>
                  <label className={styles.drawerLabel}>Nome completo *</label>
                  <input className={styles.drawerInput} value={newForm.full_name} placeholder="Nome completo"
                    onChange={e => setNewForm(f => ({ ...f, full_name: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Telefone / WhatsApp</label>
                  <input className={styles.drawerInput} value={newForm.phone} placeholder="(95) 99999-9999"
                    onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Email</label>
                  <input className={styles.drawerInput} value={newForm.email} type="email"
                    onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Partido</label>
                  <input className={styles.drawerInput} value={newForm.party} placeholder="Ex: PSD"
                    onChange={e => setNewForm(f => ({ ...f, party: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Aniversário (DD/MM)</label>
                  <input className={styles.drawerInput} value={newForm.birthday} placeholder="Ex: 15/05"
                    onChange={e => setNewForm(f => ({ ...f, birthday: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Cargo / Função</label>
                  <input className={styles.drawerInput} value={newForm.cargo} placeholder="Secretário, Diretor..."
                    onChange={e => setNewForm(f => ({ ...f, cargo: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Chefe de Gabinete</label>
                  <input className={styles.drawerInput} value={newForm.chefeGab}
                    onChange={e => setNewForm(f => ({ ...f, chefeGab: e.target.value }))} />
                </div>
              </div>

              {/* Organização */}
              <p className={styles.drawerSectionLabel} style={{ marginTop: 20 }}>Organização</p>
              <div className={styles.drawerFieldGrid}>
                <div className={styles.drawerFieldRow} style={{ gridColumn: '1/-1' }}>
                  <label className={styles.drawerLabel}>Nome da Organização</label>
                  <input className={styles.drawerInput} value={newForm.org_name} placeholder="Ex: Secretaria de Saúde"
                    onChange={e => setNewForm(f => ({ ...f, org_name: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Sigla</label>
                  <input className={styles.drawerInput} value={newForm.org_acronym} placeholder="SESAU"
                    onChange={e => setNewForm(f => ({ ...f, org_acronym: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Esfera</label>
                  <select className={styles.drawerSelect} value={newForm.org_sphere}
                    onChange={e => setNewForm(f => ({ ...f, org_sphere: e.target.value }))}>
                    <option value="federal">Federal</option>
                    <option value="estadual">Estadual</option>
                    <option value="municipal">Municipal</option>
                  </select>
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Tipo</label>
                  <select className={styles.drawerSelect} value={newForm.org_type}
                    onChange={e => setNewForm(f => ({ ...f, org_type: e.target.value }))}>
                    <option value="governo_estadual">Governo Estadual</option>
                    <option value="secretaria">Secretaria</option>
                    <option value="autarquia">Autarquia</option>
                    <option value="fundacao">Fundação</option>
                    <option value="empresa_publica">Empresa Pública</option>
                    <option value="camara">Câmara</option>
                    <option value="prefeitura">Prefeitura</option>
                    <option value="judiciario">Judiciário</option>
                    <option value="outros">Outros</option>
                  </select>
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Endereço do Departamento</label>
                  <input className={styles.drawerInput} value={newForm.org_address} placeholder="Ex: Av. Ene Garcez, 1234"
                    onChange={e => setNewForm(f => ({ ...f, org_address: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Tel. da Organização</label>
                  <input className={styles.drawerInput} value={newForm.org_phone}
                    onChange={e => setNewForm(f => ({ ...f, org_phone: e.target.value }))} />
                </div>
                <div className={styles.drawerFieldRow}>
                  <label className={styles.drawerLabel}>Email da Organização</label>
                  <input className={styles.drawerInput} value={newForm.org_email} type="email"
                    onChange={e => setNewForm(f => ({ ...f, org_email: e.target.value }))} />
                </div>
              </div>
            </div>

            {createError && <div className={styles.saveError}><AlertCircle size={13} /> {createError}</div>}

            <div className={styles.drawerFooter}>
              <button className={styles.btnCancel} onClick={() => setNewOpen(false)}>Cancelar</button>
              <button className={styles.btnSave} onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
                Criar Autoridade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL CIa
      ════════════════════════════════════════════════════════════════════════ */}
      {ciaOpen && (
        <div className={styles.drawerOverlay} onClick={() => setCiaOpen(false)}>
          <div className={`glass-card ${styles.ciaModal}`} onClick={e => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <MessageSquare size={18} style={{ color: '#ec4899' }} />
              <h2 className={styles.drawerTitle}>Assistente CIa — Disparar WhatsApp</h2>
              <button className={styles.drawerClose} onClick={() => setCiaOpen(false)}><X size={18} /></button>
            </div>

            {!ciaResults ? (
              <>
                <div className={styles.ciaBody}>
                  <label className={styles.drawerLabel}>Contexto da mensagem</label>
                  <textarea
                    className={styles.ciaTextarea}
                    placeholder="Descreva o motivo do contato (ex: 'Convite para audiência pública de...')"
                    value={ciaContext}
                    onChange={e => setCiaContext(e.target.value)}
                  />

                  <div className={styles.ciaListHeader}>
                    <label className={styles.drawerLabel}>Selecionar destinatários ({ciaSelected.length}/{ciaPersons.length})</label>
                    <button className={styles.filterPill} onClick={() =>
                      setCiaSelected(ciaSelected.length === ciaPersons.length ? [] : ciaPersons.map(p => p.id))
                    }>
                      {ciaSelected.length === ciaPersons.length ? 'Desselecionar todos' : 'Selecionar todos'}
                    </button>
                  </div>

                  {ciaLoadingPersons ? (
                    <div className={styles.loadingState}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /></div>
                  ) : (
                    <div className={styles.ciaPersonList}>
                      {ciaPersons.map(p => {
                        const appt = p.cadin_appointments?.find(a => a.active);
                        return (
                          <label key={p.id} className={`${styles.ciaPersonRow} ${ciaSelected.includes(p.id) ? styles.ciaPersonSelected : ''}`}>
                            <input type="checkbox" checked={ciaSelected.includes(p.id)}
                              onChange={() => setCiaSelected(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])} />
                            <span className={styles.ciaPersonName}>{p.full_name}</span>
                            {appt && <span className={styles.ciaPersonCargo}>{appt.title}</span>}
                            <span className={styles.ciaPersonPhone}>{p.phone}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={styles.drawerFooter}>
                  <button className={styles.btnCancel} onClick={() => setCiaOpen(false)}>Cancelar</button>
                  <button className={styles.btnSave}
                    disabled={!ciaSelected.length || !ciaContext.trim() || ciaDispatching}
                    onClick={handleDisparar}>
                    {ciaDispatching ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                    Enviar para {ciaSelected.length || 0} contatos
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.ciaResults}>
                {ciaResults.map((r, i) => (
                  <div key={i} className={`${styles.ciaResult} ${r.status === 'sent' ? styles.ciaResultOk : styles.ciaResultErr}`}>
                    {r.status === 'sent' ? <Check size={14} /> : <AlertCircle size={14} />}
                    <span>{r.person_name || 'Erro'}</span>
                    {r.error && <span className={styles.ciaResultMsg}>{r.error}</span>}
                  </div>
                ))}
                <button className={styles.btnSave} style={{ marginTop: 16 }} onClick={() => setCiaOpen(false)}>Fechar</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-componente: Authority Card ────────────────────────────────────────────

function AuthorityCard({ auth, onEdit }: { auth: CadinAuthority; onEdit: () => void }) {
  const initials = auth.photoUrl ? null : getInitials(auth.titularNome, auth.nomeOrgao);
  const bdDisplay = formatBirthday(auth.birthday);

  return (
    <div className={`glass-card ${styles.authorityCard}`}>
      {/* Barra de esfera */}
      <div className={styles.cardSphereBar} style={{ background: SPHERE_COLOR[auth.sphere] ?? '#94a3b8' }} />

      <div className={styles.cardBody}>
        {/* Header: avatar + nome + cargo */}
        <div className={styles.cardHeader}>
          <div className={styles.cardAvatar}>
            {auth.photoUrl
              ? <img src={auth.photoUrl} alt={auth.titularNome ?? ''} className={styles.cardAvatarImg} />
              : <span className={styles.cardAvatarInitials}>{initials}</span>
            }
          </div>
          <div className={styles.cardIdentity} style={{ display: 'flex', flexDirection: 'column' }}>
            <span className={styles.cardOrgao} style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b' }}>{auth.nomeOrgao}</span>
            <span className={styles.cardCargo} style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginTop: '1px' }}>{auth.titularCargo ?? '—'}</span>
            <span className={styles.cardNome} style={{ fontSize: '0.82rem', color: '#0ea5e9', fontWeight: 700, marginTop: '2px' }}>{auth.titularNome ?? '(sem titular)'}</span>
          </div>
          <span className={styles.cardSpherePill} style={{
            background: SPHERE_BG[auth.sphere] ?? '#f1f5f9',
            color: SPHERE_COLOR[auth.sphere] ?? '#64748b',
          }}>
            {SPHERE_LABEL[auth.sphere] ?? auth.sphere}
          </span>
        </div>

        {/* Contatos */}
        <div className={styles.cardContacts}>
          {auth.phone && (
            <a href={`tel:${auth.phone}`} className={styles.cardContact}>
              <Phone size={12} /> {auth.phone}
            </a>
          )}
          {auth.email && (
            <a href={`mailto:${auth.email}`} className={styles.cardContact}>
              <Mail size={12} /> {auth.email}
            </a>
          )}
        </div>

        {/* Meta: partido, aniversário, chefe, endereco */}
        <div className={styles.cardMeta} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {auth.party && <span className={styles.cardMetaTag}><FileText size={10} /> {auth.party}</span>}
          {bdDisplay && <span className={styles.cardMetaTag}><Calendar size={10} /> {bdDisplay}</span>}
          {auth.chefeGab && <span className={styles.cardMetaTag} title="Chefe de Gabinete" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Gab: {auth.chefeGab}
          </span>}
          {auth.orgAddress && <span className={styles.cardMetaTag} title="Endereço" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><MapPin size={10} /> {auth.orgAddress}</span>}
        </div>
      </div>

      {/* Footer: ações */}
      <div className={styles.cardFooter}>
        {auth.phone && (
          <a href={`https://wa.me/55${auth.phone.replace(/\D/g, '')}`}
             target="_blank" rel="noopener noreferrer"
             className={styles.cardActionBtn} title="WhatsApp">
            <MessageSquare size={14} />
          </a>
        )}
        {auth.email && (
          <a href={`mailto:${auth.email}`} className={styles.cardActionBtn} title="Email">
            <Mail size={14} />
          </a>
        )}
        <button className={`${styles.cardActionBtn} ${styles.cardActionEdit}`} onClick={onEdit} title="Editar">
          <Pencil size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Sub-componente: Pending Update Card ──────────────────────────────────────

function PendingUpdateCard({
  update, reviewing, onAprovar, onRejeitar
}: {
  update: PendingUpdate;
  reviewing: boolean;
  onAprovar: () => void;
  onRejeitar: () => void;
}) {
  const confidenceColor = update.confidence >= 0.8 ? '#10b981' : update.confidence >= 0.5 ? '#f59e0b' : '#ef4444';

  return (
    <div className={`glass-card ${styles.updateCard}`}>
      <div className={styles.updateCardHeader}>
        <span className={styles.updateTypeBadge}>
          {UPDATE_TYPE_LABEL[update.update_type] ?? update.update_type}
        </span>
        {update.cadin_monitor_sources && (
          <span className={styles.updateSource}>{update.cadin_monitor_sources.name}</span>
        )}
        <span className={styles.updateDate}>
          {new Date(update.created_at).toLocaleDateString('pt-BR')}
        </span>
        <div className={styles.confidenceBar}>
          <span style={{ color: confidenceColor, fontWeight: 700, fontSize: 12 }}>
            {Math.round(update.confidence * 100)}%
          </span>
          <div className={styles.confidenceTrack}>
            <div className={styles.confidenceFill} style={{ width: `${update.confidence * 100}%`, background: confidenceColor }} />
          </div>
        </div>
      </div>

      {update.cadin_persons && (
        <div className={styles.updatePerson}>
          <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
          Autoridade: <strong>{update.cadin_persons.full_name}</strong>
        </div>
      )}

      {update.gemini_summary && (
        <p className={styles.updateSummary}>{update.gemini_summary}</p>
      )}

      {update.suggested_changes && Object.keys(update.suggested_changes).length > 0 && (
        <div className={styles.updateChanges}>
          {Object.entries(update.suggested_changes).map(([k, v]) => (
            <div key={k} className={styles.updateChangeRow}>
              <span className={styles.updateChangeKey}>{k}</span>
              <span className={styles.updateChangeVal}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {update.source_url && (
        <a href={update.source_url} target="_blank" rel="noopener noreferrer"
           className={styles.updateSourceLink}>
          Ver fonte original →
        </a>
      )}

      <div className={styles.updateActions}>
        <button className={styles.rejectBtn} onClick={onRejeitar} disabled={reviewing}>
          <X size={14} /> Rejeitar
        </button>
        <button className={styles.approveBtn} onClick={onAprovar} disabled={reviewing}>
          {reviewing
            ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : <Check size={14} />}
          Aplicar ao CADIN
        </button>
      </div>
    </div>
  );
}
