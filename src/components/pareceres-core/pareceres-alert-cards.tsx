'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Users, CalendarCheck, AlertTriangle, ArrowRight, X } from 'lucide-react';
import styles from './pareceres-alert-cards.module.css';

// ─── Tipos (espelho da API, não importar de route) ──────────────────────────

export interface ParecerAlertas {
  materias_novas: {
    total: number;
    por_comissao: { sigla: string; nome: string; count: number }[];
    desde: string;
  };
  ordem_do_dia: {
    sessao_id: number;
    numero: string;
    data: string;
    total_materias: number;
  } | null;
  pendencias: {
    total: number;
    em_rascunho: number;
    aguardando_assinatura: number;
    sem_parecer: number;
    criticos: number;
    mais_antigo_dias: number;
  };
}

interface PareceresAlertCardsProps {
  dados: ParecerAlertas;
  modo: 'dashboard' | 'modulo';
  onNavegar?: (aba: 'vereador' | 'relatoria' | 'comissao', sessaoId?: number) => void;
  alertCardClass?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatarData(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

function storageKey(sessaoId: number): string {
  return `parecer_ordem_vista_${sessaoId}`;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function PareceresAlertCards({
  dados,
  modo,
  onNavegar,
  alertCardClass,
}: PareceresAlertCardsProps) {
  const { materias_novas, ordem_do_dia, pendencias } = dados;

  const [ordemDismissed, setOrdemDismissed] = useState(false);

  useEffect(() => {
    if (ordem_do_dia) {
      const dismissed = localStorage.getItem(storageKey(ordem_do_dia.sessao_id)) === '1';
      if (dismissed) setOrdemDismissed(true);
    }
  }, [ordem_do_dia]);

  const dismissOrdem = () => {
    if (!ordem_do_dia) return;
    localStorage.setItem(storageKey(ordem_do_dia.sessao_id), '1');
    setOrdemDismissed(true);
  };

  // Verificar se há algo a exibir
  const temMaterias = materias_novas.total > 0;
  const temOrdem = ordem_do_dia !== null && !ordemDismissed;
  const temPendencias = pendencias.total > 0;

  if (!temMaterias && !temOrdem && !temPendencias) return null;

  // ── Modo dashboard: Links ──────────────────────────────────────────────

  if (modo === 'dashboard') {
    return (
      <>
        {temMaterias && (
          <Link
            href="/pareceres?aba=relatoria"
            className={alertCardClass}
            style={{ '--alert-color': '#2563eb' } as React.CSSProperties}
          >
            <Users size={16} />
            <span>
              <strong>{materias_novas.total}</strong>{' '}
              {materias_novas.total === 1
                ? 'matéria nova aguardando'
                : 'matérias novas aguardando'}{' '}
              relatoria
            </span>
            <ArrowRight size={14} />
          </Link>
        )}

        {temOrdem && (
          <Link
            href={`/pareceres?aba=vereador&sessao=${ordem_do_dia!.sessao_id}`}
            className={alertCardClass}
            style={{ '--alert-color': '#0d9488' } as React.CSSProperties}
            onClick={dismissOrdem}
          >
            <CalendarCheck size={16} />
            <span>
              Ordem do dia publicada — Sessão N.º {ordem_do_dia!.numero} de{' '}
              {formatarData(ordem_do_dia!.data)}
            </span>
            <ArrowRight size={14} />
          </Link>
        )}

        {temPendencias && (
          <Link
            href="/pareceres?aba=comissao"
            className={alertCardClass}
            style={{ '--alert-color': '#d97706' } as React.CSSProperties}
          >
            <AlertTriangle size={16} />
            <span>
              <strong>{pendencias.total}</strong>{' '}
              {pendencias.total === 1 ? 'parecer pendente' : 'pareceres pendentes'}
              {pendencias.criticos > 0 && (
                <> ({pendencias.criticos} há mais de 7 dias)</>
              )}
            </span>
            <ArrowRight size={14} />
          </Link>
        )}
      </>
    );
  }

  // ── Modo módulo: Buttons ───────────────────────────────────────────────

  return (
    <>
      {temMaterias && (
        <button
          type="button"
          className={alertCardClass}
          style={{ '--alert-color': '#2563eb' } as React.CSSProperties}
          onClick={() => onNavegar?.('relatoria')}
        >
          <Users size={16} />
          <span>
            <strong>{materias_novas.total}</strong>{' '}
            {materias_novas.total === 1
              ? 'matéria nova aguardando'
              : 'matérias novas aguardando'}{' '}
            relatoria
            {materias_novas.por_comissao.length > 0 && (
              <span className={styles.detalhe}>
                {' — '}
                {materias_novas.por_comissao
                  .map((c) => `${c.sigla} (${c.count})`)
                  .join(', ')}
              </span>
            )}
          </span>
        </button>
      )}

      {temOrdem && (
        <button
          type="button"
          className={alertCardClass}
          style={{ '--alert-color': '#0d9488' } as React.CSSProperties}
          onClick={() => onNavegar?.('vereador', ordem_do_dia!.sessao_id)}
        >
          <CalendarCheck size={16} />
          <span>
            Ordem do dia publicada — Sessão N.º {ordem_do_dia!.numero} de{' '}
            {formatarData(ordem_do_dia!.data)}
            <span className={styles.detalhe}>
              {' — '}{ordem_do_dia!.total_materias} matérias para análise
            </span>
          </span>
          <button
            type="button"
            className={styles.dismissBtn}
            onClick={(e) => {
              e.stopPropagation();
              dismissOrdem();
            }}
            aria-label="Dispensar alerta"
          >
            <X size={14} />
          </button>
        </button>
      )}

      {temPendencias && (
        <button
          type="button"
          className={alertCardClass}
          style={{ '--alert-color': '#d97706' } as React.CSSProperties}
          onClick={() => onNavegar?.('comissao')}
        >
          <AlertTriangle size={16} />
          <span>
            <strong>{pendencias.total}</strong>{' '}
            {pendencias.total === 1 ? 'parecer pendente' : 'pareceres pendentes'}
            <span className={styles.detalhe}>
              {' — '}
              {[
                pendencias.em_rascunho > 0 && `${pendencias.em_rascunho} em rascunho`,
                pendencias.aguardando_assinatura > 0 && `${pendencias.aguardando_assinatura} aguardando assinatura`,
                pendencias.sem_parecer > 0 && `${pendencias.sem_parecer} sem parecer`,
                pendencias.criticos > 0 && `${pendencias.criticos} há mais de 7 dias`,
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          </span>
        </button>
      )}
    </>
  );
}
