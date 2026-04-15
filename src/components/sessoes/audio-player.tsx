'use client';

// ══════════════════════════════════════════════════════════
// AudioPlayer — Player com waveform (wavesurfer) quando possível,
// com fallback para <audio> HTML nativo quando a decodificação
// falha (áudios longos estouram a memória do Web Audio API).
// ══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, SkipBack, SkipForward, Activity } from 'lucide-react';

interface AudioPlayerProps {
  audioUrl: string | null;
  onTimeUpdate?: (currentTime: number) => void;
  seekTo?: number | null;
  /**
   * Modo compacto: reduz padding, altura da barra/waveform e remove a
   * dica de teclado. Use quando o player estiver competindo por espaço
   * vertical com conteúdo principal (transcrição, etc.).
   */
  compact?: boolean;
}

// Áudios maiores que isso pulam direto para o player nativo
// (Web Audio API estoura RAM decodificando arquivos longos em Float32).
const MAX_WAVEFORM_SECONDS = 30 * 60; // 30 min

function formatTime(s: number): string {
  if (!isFinite(s)) return '00:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Player nativo (fallback robusto para áudios longos) ───
function NativeAudioPlayer({ audioUrl, onTimeUpdate, seekTo, reason, compact }: {
  audioUrl: string;
  onTimeUpdate?: (t: number) => void;
  seekTo?: number | null;
  reason?: 'long' | 'fallback';
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);

  useEffect(() => {
    if (seekTo == null || !audioRef.current) return;
    audioRef.current.currentTime = seekTo;
  }, [seekTo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const audio = audioRef.current;
      if (!audio) return;
      if (e.code === 'Space') { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play(); else a.pause();
  };
  const skip = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + sec));
  };

  return (
    <div style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', border: '1px solid #e2e8f0', borderRadius: 10, padding: compact ? '7px 10px 6px' : 14 }}>
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onTimeUpdate={e => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(t);
          onTimeUpdateRef.current?.(t);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        style={{ display: 'none' }}
      />

      {/* Barra de progresso clicável (substitui waveform) */}
      <div
        onClick={e => {
          const audio = audioRef.current;
          if (!audio || !audio.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          audio.currentTime = pct * audio.duration;
        }}
        style={{
          height: compact ? 22 : 40,
          background: '#e2e8f0',
          borderRadius: compact ? 4 : 6,
          marginBottom: compact ? 5 : 10,
          position: 'relative',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
        title="Clique para pular"
      >
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
          background: 'linear-gradient(90deg, #1c4076 0%, #2563eb 100%)',
          transition: 'width 0.1s linear',
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: compact ? '0.62rem' : '0.7rem', fontWeight: 600, color: '#475569',
          pointerEvents: 'none', mixBlendMode: 'multiply',
        }}>
          {reason === 'long' ? 'áudio longo — modo leve' : 'reprodução nativa'}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 7 : 10 }}>
        <button onClick={() => skip(-5)} style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 6, padding: compact ? '4px 8px' : '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Voltar 5s (←)">
          <SkipBack size={compact ? 12 : 14} />
        </button>
        <button onClick={togglePlay} style={{ background: '#1c4076', color: 'white', border: 'none', borderRadius: 6, padding: compact ? '5px 11px' : '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, fontSize: compact ? '0.74rem' : '0.82rem' }} title="Play/Pause (Espaço)">
          {isPlaying ? <Pause size={compact ? 12 : 14} /> : <Play size={compact ? 12 : 14} />}
          {isPlaying ? 'Pausar' : 'Tocar'}
        </button>
        <button onClick={() => skip(5)} style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 6, padding: compact ? '4px 8px' : '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Avançar 5s (→)">
          <SkipForward size={compact ? 12 : 14} />
        </button>
        <div style={{ fontSize: compact ? '0.72rem' : '0.78rem', color: '#475569', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>
      {!compact && (
        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 6, textAlign: 'center' }}>
          <kbd style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, padding: '0 4px', fontSize: '0.6rem' }}>Espaço</kbd> play/pause ·{' '}
          <kbd style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, padding: '0 4px', fontSize: '0.6rem' }}>←</kbd>{' '}
          <kbd style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, padding: '0 4px', fontSize: '0.6rem' }}>→</kbd> 5s
        </div>
      )}
    </div>
  );
}

// ─── Player com waveform (wavesurfer) — para áudios curtos ───
function WaveformPlayer({ audioUrl, onTimeUpdate, seekTo, onFallback, compact }: {
  audioUrl: string;
  onTimeUpdate?: (t: number) => void;
  seekTo?: number | null;
  onFallback: () => void;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);

  useEffect(() => {
    if (!containerRef.current) return;
    setLoading(true);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#cbd5e1',
      progressColor: '#1c4076',
      cursorColor: '#dc2626',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: compact ? 36 : 60,
      normalize: true,
      url: audioUrl,
    });
    wavesurferRef.current = ws;

    ws.on('ready', () => {
      setLoading(false);
      setDuration(ws.getDuration());
    });
    ws.on('error', (err) => {
      console.error('[AudioPlayer] WaveSurfer falhou, migrando para player nativo:', err);
      onFallback();
    });
    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));
    ws.on('audioprocess', () => {
      const t = ws.getCurrentTime();
      setCurrentTime(t);
      onTimeUpdateRef.current?.(t);
    });
    ws.on('seeking', () => {
      const t = ws.getCurrentTime();
      setCurrentTime(t);
      onTimeUpdateRef.current?.(t);
    });

    return () => {
      try { ws.destroy(); } catch { /* noop */ }
      wavesurferRef.current = null;
    };
  }, [audioUrl, onFallback, compact]);

  useEffect(() => {
    if (seekTo == null || !wavesurferRef.current) return;
    const ws = wavesurferRef.current;
    const dur = ws.getDuration();
    if (dur > 0) ws.seekTo(seekTo / dur);
  }, [seekTo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const ws = wavesurferRef.current;
      if (!ws) return;
      if (e.code === 'Space') { e.preventDefault(); ws.playPause(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); ws.setTime(Math.max(0, ws.getCurrentTime() - 5)); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); ws.setTime(Math.min(ws.getDuration(), ws.getCurrentTime() + 5)); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const togglePlay = () => wavesurferRef.current?.playPause();
  const skip = (sec: number) => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    ws.setTime(Math.max(0, Math.min(ws.getDuration(), ws.getCurrentTime() + sec)));
  };

  return (
    <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: compact ? '6px 10px 5px' : 12 }}>
      <div ref={containerRef} style={{ marginBottom: compact ? 4 : 8 }} />
      {loading && (
        <div style={{ fontSize: '0.7rem', color: '#6b7280', textAlign: 'center', marginBottom: compact ? 3 : 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Activity size={12} style={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
          Decodificando waveform…
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 7 : 10 }}>
        <button onClick={() => skip(-5)} disabled={loading} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: compact ? '4px 8px' : '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Voltar 5s (←)">
          <SkipBack size={compact ? 12 : 14} />
        </button>
        <button onClick={togglePlay} disabled={loading} style={{ background: '#1c4076', color: 'white', border: 'none', borderRadius: 6, padding: compact ? '5px 11px' : '8px 14px', cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, fontSize: compact ? '0.74rem' : '0.82rem' }} title="Play/Pause (Espaço)">
          {isPlaying ? <Pause size={compact ? 12 : 14} /> : <Play size={compact ? 12 : 14} />}
          {isPlaying ? 'Pausar' : 'Tocar'}
        </button>
        <button onClick={() => skip(5)} disabled={loading} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: compact ? '4px 8px' : '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Avançar 5s (→)">
          <SkipForward size={compact ? 12 : 14} />
        </button>
        <div style={{ fontSize: compact ? '0.72rem' : '0.78rem', color: '#6b7280', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>
      {!compact && (
        <div style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 6, textAlign: 'center' }}>
          <kbd style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, padding: '0 4px', fontSize: '0.6rem' }}>Espaço</kbd> play/pause ·{' '}
          <kbd style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, padding: '0 4px', fontSize: '0.6rem' }}>←</kbd>{' '}
          <kbd style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 3, padding: '0 4px', fontSize: '0.6rem' }}>→</kbd> 5s
        </div>
      )}
    </div>
  );
}

// ─── Player container: escolhe waveform ou nativo ───
export function AudioPlayer({ audioUrl, onTimeUpdate, seekTo, compact }: AudioPlayerProps) {
  const [forceNative, setForceNative] = useState(false);
  const [probedDuration, setProbedDuration] = useState<number | null>(null);

  // Sonda a duração primeiro — evita inicializar wavesurfer pra áudios longos demais
  useEffect(() => {
    setForceNative(false);
    setProbedDuration(null);
    if (!audioUrl) return;
    const probe = new Audio();
    probe.preload = 'metadata';
    const onMeta = () => {
      setProbedDuration(probe.duration);
      if (probe.duration > MAX_WAVEFORM_SECONDS) setForceNative(true);
    };
    const onErr = () => {
      console.error('[AudioPlayer] probe metadata falhou');
      setForceNative(true);
    };
    probe.addEventListener('loadedmetadata', onMeta);
    probe.addEventListener('error', onErr);
    probe.src = audioUrl;
    return () => {
      probe.removeEventListener('loadedmetadata', onMeta);
      probe.removeEventListener('error', onErr);
      probe.src = '';
    };
  }, [audioUrl]);

  if (!audioUrl) {
    return (
      <div style={{ padding: 12, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, fontSize: '0.78rem', color: '#92400e', textAlign: 'center' }}>
        📦 Áudio não disponível — pode ter expirado ou ainda está processando
      </div>
    );
  }

  // Enquanto a sonda ainda está carregando, mostra placeholder mínimo
  if (probedDuration == null && !forceNative) {
    return (
      <div style={{ padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.78rem', color: '#64748b', textAlign: 'center' }}>
        Preparando player…
      </div>
    );
  }

  if (forceNative) {
    const reason = probedDuration != null && probedDuration > MAX_WAVEFORM_SECONDS ? 'long' : 'fallback';
    return <NativeAudioPlayer audioUrl={audioUrl} onTimeUpdate={onTimeUpdate} seekTo={seekTo} reason={reason} compact={compact} />;
  }

  return (
    <WaveformPlayer
      audioUrl={audioUrl}
      onTimeUpdate={onTimeUpdate}
      seekTo={seekTo}
      onFallback={() => setForceNative(true)}
      compact={compact}
    />
  );
}
