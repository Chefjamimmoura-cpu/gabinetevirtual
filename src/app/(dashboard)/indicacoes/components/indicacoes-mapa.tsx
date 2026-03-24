'use client';

import { useEffect, useRef, useState } from 'react';
import { GerarProtocolarModal } from './gerar-protocolar-modal';
import type { IndicacaoCampo } from './campo-kanban';
import styles from './indicacoes-mapa.module.css';
import { Map, AlertCircle, Info } from 'lucide-react';

const BOA_VISTA_CENTER: [number, number] = [-2.8235, -60.6758];

const STATUS_COR: Record<string, string> = {
  pendente: '#6b7280',    // Caixa de Entrada / ALIA
  protocolado: '#488DC7', // Protocolado SAPL
  tramitacao: '#d97706',  // Em Análise
  atendida: '#10b981',    // Atendimento Concedido
  arquivada: '#ef4444',   // Arquivada / Negada
};

export function IndicacoesMapa() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const [indicacoes, setIndicacoes] = useState<IndicacaoCampo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalIndicacao, setModalIndicacao] = useState<IndicacaoCampo | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/indicacoes/campo?com_geo=true&page_size=200')
      .then(r => r.json())
      .then((d: { results: IndicacaoCampo[] }) => setIndicacoes(d.results ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as unknown as Record<string, unknown>).L) {
      setLeafletLoaded(true);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      // Also load leaflet.heat for heatmap
      const heatScript = document.createElement('script');
      heatScript.src = 'https://unpkg.com/leaflet.heat/dist/leaflet-heat.js';
      heatScript.onload = () => setLeafletLoaded(true);
      document.head.appendChild(heatScript);
    };
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || loading || indicacoes.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!L) return;

    if (mapInstanceRef.current) {
      (mapInstanceRef.current as { remove: () => void }).remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapRef.current).setView(BOA_VISTA_CENTER, 12);
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    indicacoes.forEach(ind => {
      if (!ind.geo_lat || !ind.geo_lng) return;
      
      const cor = STATUS_COR[ind.status] ?? STATUS_COR.pendente;
      const urgEmoji = ind.classificacao === 'urgencia' ? '🔴' : ind.classificacao === 'prioridade' ? '🟡' : '🟢';

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:${cor};border:3px solid white;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          display:flex;align-items:center;justify-content:center;
          font-size:12px;font-weight:bold;color:white;
        ">${urgEmoji}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([ind.geo_lat, ind.geo_lng], { icon }).addTo(map);
      const idCurto = ind.id.substring(0, 8).toUpperCase();
      const setoresStr = (ind.setores ?? []).slice(0, 3).join(', ');

      marker.bindPopup(`
        <div style="min-width:200px;font-family:sans-serif">
          <div style="font-weight:700;margin-bottom:4px;color:#111827">${idCurto}</div>
          <div style="font-size:13px;color:#111827"><strong>${ind.logradouro}</strong></div>
          <div style="font-size:12px;color:#6b7280">${ind.bairro}</div>
          ${setoresStr ? `<div style="margin-top:4px;font-size:12px;color:#0369a1;background:#e0f2fe;padding:2px 6px;border-radius:8px;display:inline-block">${setoresStr}</div>` : ''}
          <div style="margin-top:8px">
            <span style="
              background:${cor};color:white;
              padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600
            ">${ind.status.replace('_', ' ').toUpperCase()}</span>
          </div>
          ${ind.responsavel_nome ? `<div style="font-size:11px;color:#6b7280;margin-top:6px">👤 ${ind.responsavel_nome}</div>` : ''}
          <button
            onclick="window.__abrirModal('${ind.id}')"
            style="
              margin-top:12px;width:100%;background:#1c4076;color:white;
              border:none;border-radius:6px;padding:8px;cursor:pointer;font-size:12px;font-weight:600;
              transition:background 0.2s;
            "
            onmouseover="this.style.background='#1d4ed8'"
            onmouseout="this.style.background='#1c4076'"
          >${ind.documento_ementa ? '📤 Ver no SAPL' : '✨ Gerar Documento'}</button>
        </div>
      `, { offset: [0, -10] });
    });

    // Heatmap Layer (if heat library loaded)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).L.heatLayer && indicacoes.length > 0) {
      const heatPoints = indicacoes
        .filter(i => i.geo_lat && i.geo_lng)
        .map(i => [i.geo_lat, i.geo_lng, 0.5]); // intensity 0.5
      
      if (heatPoints.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).L.heatLayer(heatPoints, { radius: 25, blur: 15, maxZoom: 14 }).addTo(map);
      }
    }

    if (indicacoes.length > 0) {
      const bounds = L.latLngBounds(
        indicacoes
          .filter(i => i.geo_lat && i.geo_lng)
          .map(i => [i.geo_lat!, i.geo_lng!]),
      );
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    }

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, [leafletLoaded, indicacoes, loading]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__abrirModal = (id: string) => {
      const ind = indicacoes.find(i => i.id === id);
      if (ind) setModalIndicacao(ind);
    };
    return () => { delete (window as unknown as Record<string, unknown>).__abrirModal; };
  }, [indicacoes]);

  const comGeo = indicacoes.filter(i => i.geo_lat && i.geo_lng).length;
  const semGeo = indicacoes.length === 0 ? 0 : (indicacoes.length - comGeo);

  return (
    <div className={styles.mapaContainer}>
      <div className={styles.statsRow}>
        {Object.entries(STATUS_COR).map(([st, cor]) => {
          const count = indicacoes.filter(i => i.status === st).length;
          if (count === 0) return null;
          return (
            <div key={st} className={styles.statItem} style={{ borderLeftColor: cor }}>
              <span className={styles.statValue} style={{ color: cor }}>{count}</span>
              <span className={styles.statLabel}>{st.replace('_', ' ')}</span>
            </div>
          );
        })}
      </div>

      {semGeo > 0 && (
        <div className={styles.avisoGeo}>
          <AlertCircle size={18} color="#f59e0b" />
          <span>
            <strong>{semGeo} indicações</strong> sem coordenadas GPS não aparecem no mapa.
            Coletadas via WhatsApp ou manual. Para adicionar coords, use o app de campo e aprove a geolocalização.
          </span>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px', color: '#6b7280' }}>
          Carregando mapa e dados espaciais...
        </div>
      )}

      {!loading && comGeo === 0 && (
        <div style={{ textAlign: 'center', padding: '72px 24px', background: 'linear-gradient(180deg, #f8fafc, #ffffff)', borderRadius: '16px', border: '1px dashed #d1d5db' }}>
          <Map size={56} style={{ margin: '0 auto 20px', color: '#cbd5e1' }}/>
          <p style={{ fontWeight: 800, color: '#1e293b', fontSize: '1.2rem', margin: '0 0 8px', letterSpacing: '-0.01em' }}>Nenhuma indicação geolocalizada</p>
          <p style={{ fontSize: '0.9rem', marginTop: '0', color: '#64748b', maxWidth: '400px', margin: '0 auto', lineHeight: 1.5 }}>
            As indicações precisam de coordenadas GPS para aparecer no mapa.
            Adicione <strong>geo_lat</strong> e <strong>geo_lng</strong> via formulário de campo ou peça à ALIA via WhatsApp com localização ativada.
          </p>
        </div>
      )}

      <div
        ref={mapRef}
        className={styles.mapWrapper}
        style={{ display: comGeo > 0 ? 'block' : 'none' }}
      />

      {comGeo > 0 && (
        <div className={styles.legenda}>
          {Object.entries(STATUS_COR).map(([st, cor]) => (
            <div key={st} className={styles.legendaItem}>
              <div className={styles.legendaDot} style={{ background: cor }} />
              <span className={styles.legendaText}>{st.replace('_', ' ')}</span>
            </div>
          ))}
          <div className={styles.legendaItem} style={{ marginLeft: 'auto', borderLeft: '1px solid #e5e7eb', paddingLeft: '16px' }}>
            <Info size={14} color="#6b7280" />
            <span style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>🔴 Urgência • 🟡 Prioridade • 🟢 Necessidade</span>
          </div>
        </div>
      )}

      {modalIndicacao && (
        <GerarProtocolarModal
          indicacao={modalIndicacao}
          onClose={() => setModalIndicacao(null)}
          onSuccess={() => {
            setModalIndicacao(null);
            fetch('/api/indicacoes/campo?com_geo=true&page_size=200')
              .then(r => r.json())
              .then((d: { results: IndicacaoCampo[] }) => setIndicacoes(d.results ?? []));
          }}
        />
      )}
    </div>
  );
}

