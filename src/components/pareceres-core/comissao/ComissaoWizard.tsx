'use client';
import React, { useState, useCallback, useEffect } from 'react';
import { WizardStepper } from './WizardStepper';
import { Step1Selecao } from './Step1Selecao';
import { Step2Ata } from './Step2Ata';
import { Step3Pareceres } from './Step3Pareceres';
import { ReunioesHistorico } from './ReunioesHistorico';
import { MateriaFila, ComissaoConfig, ComissaoMembro, Reuniao, ParecerResult } from './types';

interface ComissaoWizardProps {
  comissaoSigla: string;
  comissaoFila: MateriaFila[];
  comissaoFilaLoading: boolean;
  comissoesDisponiveis: ComissaoConfig[];
  onComissaoChange: (sigla: string) => void;
  gabineteNome?: string;
}

export function ComissaoWizard({
  comissaoSigla, comissaoFila, comissaoFilaLoading, comissoesDisponiveis, onComissaoChange, gabineteNome
}: ComissaoWizardProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [ataResult, setAtaResult] = useState<string | null>(null);
  const [parecerResults, setParecerResults] = useState<Map<number, ParecerResult>>(new Map());
  const [isGerando, setIsGerando] = useState(false);
  const [membros, setMembros] = useState<ComissaoMembro[]>([]);
  const [membrosLoading, setMembrosLoading] = useState(false);
  const [reunioes, setReunioes] = useState<Reuniao[]>([]);
  const [lastComissaoResult, setLastComissaoResult] = useState<string | null>(null);

  const comissao = comissoesDisponiveis.find(c => c.sigla === comissaoSigla);
  const selectedMaterias = comissaoFila.filter(m => selectedIds.has(m.id));

  // Load members when commission changes
  useEffect(() => {
    if (!comissao?.sapl_unit_id && !comissao?.sapl_comissao_id) return;
    setMembrosLoading(true);
    const id = comissao.sapl_comissao_id || comissao.sapl_unit_id;
    fetch(`/api/pareceres/comissao/membros?comissao_id=${id}`)
      .then(r => r.ok ? r.json() : { membros: [] })
      .then(d => setMembros(d.membros || []))
      .catch(() => setMembros([]))
      .finally(() => setMembrosLoading(false));
  }, [comissao?.sapl_unit_id, comissao?.sapl_comissao_id]);

  // Load meeting history
  useEffect(() => {
    fetch(`/api/pareceres/historico?commission_sigla=${comissaoSigla}&tipo=ata_comissao&limit=10`)
      .then(r => r.ok ? r.json() : { reunioes: [] })
      .then(d => setReunioes(d.reunioes || []))
      .catch(() => setReunioes([]));
  }, [comissaoSigla]);

  // Reset on commission change
  useEffect(() => {
    setCurrentStep(1);
    setSelectedIds(new Set());
    setAtaResult(null);
    setParecerResults(new Map());
  }, [comissaoSigla]);

  const toggleMateria = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleGerarAta = useCallback(async (params: { data: string; horaInicio: string; horaFim: string }) => {
    setIsGerando(true);
    try {
      const res = await fetch('/api/pareceres/comissao/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materia_ids: [...selectedIds],
          commission_sigla: comissaoSigla,
          modo: 'ata',
          data: params.data,
          hora_inicio: params.horaInicio,
          hora_fim: params.horaFim,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAtaResult(data.ata);
        if (data.membros) setMembros(data.membros);
      }
    } catch { /* silent */ } finally { setIsGerando(false); }
  }, [selectedIds, comissaoSigla]);

  const handleGerarParecer = useCallback(async (materiaId: number, voto: string) => {
    setIsGerando(true);
    try {
      const res = await fetch('/api/pareceres/comissao/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materia_id: materiaId,
          commission_sigla: comissaoSigla,
          voto,
          modo: 'parecer',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setParecerResults(prev => new Map(prev).set(materiaId, { texto: data.parecer_comissao, voto }));
        setLastComissaoResult(data.parecer_comissao);
      }
    } catch { /* silent */ } finally { setIsGerando(false); }
  }, [comissaoSigla]);

  const handleExport = useCallback(async (tipo: 'ata' | 'comissao', formato?: 'odt') => {
    const content = tipo === 'ata' ? ataResult : lastComissaoResult;
    if (!content || !comissao) return;
    try {
      const body: Record<string, unknown> = {
        parecer: content,
        tipo: tipo === 'ata' ? 'ata' : 'parecer_comissao',
        commission_nome: comissao.nome,
        commission_sigla: comissao.sigla,
      };
      if (formato === 'odt') body.formato = 'odt';
      const res = await fetch('/api/pareceres/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = formato === 'odt' ? 'odt' : 'docx';
        a.download = tipo === 'ata' ? `ATA_${comissao.sigla}.${ext}` : `Parecer_${comissao.sigla}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* silent */ }
  }, [ataResult, lastComissaoResult, comissao]);

  const handleReabrirReuniao = useCallback((reuniao: Reuniao) => {
    setSelectedIds(new Set(reuniao.materia_ids));
    setCurrentStep(3);
  }, []);

  const handleConcluir = useCallback(() => {
    setCurrentStep(1);
    setSelectedIds(new Set());
    setAtaResult(null);
    setParecerResults(new Map());
  }, []);

  if (!comissao) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minHeight: 0 }}>
      {/* Sub-tabs comissões */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', borderBottom: '1px solid #e5e7eb', marginBottom: 16, flexWrap: 'wrap' }}>
        {comissoesDisponiveis.map(c => (
          <button key={c.sigla} onClick={() => onComissaoChange(c.sigla)}
            style={{ padding: '6px 14px', border: 'none', borderBottom: comissaoSigla === c.sigla ? '3px solid #16325B' : '3px solid transparent',
              background: 'none', cursor: 'pointer', fontWeight: comissaoSigla === c.sigla ? 700 : 500,
              color: comissaoSigla === c.sigla ? '#16325B' : '#6b7280', fontSize: '0.85rem', marginBottom: -1, whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 4 }}
            title={`${c.nome}${c.meu_cargo ? ` — ${c.meu_cargo}` : ''}`}>
            {c.sigla}
            {c.meu_cargo && c.meu_cargo !== 'acesso_geral' && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                background: c.meu_cargo === 'presidente' ? '#15803d' : c.meu_cargo === 'vice-presidente' ? '#1d4ed8' : '#94a3b8' }}
                title={c.meu_cargo} />
            )}
          </button>
        ))}
      </div>

      {/* Histórico */}
      <ReunioesHistorico reunioes={reunioes} onReabrir={handleReabrirReuniao} />

      {/* Stepper */}
      <WizardStepper currentStep={currentStep} materiasCount={selectedIds.size} ataGerada={!!ataResult} />

      {/* Etapas */}
      {currentStep === 1 && (
        <Step1Selecao
          materias={comissaoFila}
          selectedIds={selectedIds}
          onToggle={toggleMateria}
          onSelectAll={() => setSelectedIds(new Set(comissaoFila.map(m => m.id)))}
          onDeselectAll={() => setSelectedIds(new Set())}
          onAvancar={() => setCurrentStep(2)}
          onIrDiretoPareceres={() => { if (selectedIds.size > 0) setCurrentStep(3); }}
          loading={comissaoFilaLoading}
        />
      )}
      {currentStep === 2 && (
        <Step2Ata
          materias={selectedMaterias}
          comissao={comissao}
          membros={membros}
          membrosLoading={membrosLoading}
          ataResult={ataResult}
          isGerando={isGerando}
          onGerarAta={handleGerarAta}
          onExportOdt={() => handleExport('ata', 'odt')}
          onExportDocx={() => handleExport('ata')}
          onVoltar={() => setCurrentStep(1)}
          onAvancar={() => setCurrentStep(3)}
        />
      )}
      {currentStep === 3 && (
        <Step3Pareceres
          materias={selectedMaterias}
          parecerResults={parecerResults}
          isGerando={isGerando}
          onGerarParecer={handleGerarParecer}
          onExportOdt={() => handleExport('comissao', 'odt')}
          onExportDocx={() => handleExport('comissao')}
          onVoltar={() => setCurrentStep(2)}
          onConcluir={handleConcluir}
        />
      )}
    </div>
  );
}
