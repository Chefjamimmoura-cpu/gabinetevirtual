import React from 'react';

interface LogoLoaderProps {
  size?: number;
  className?: string;
}

export function LogoLoader({ size = 64, className = '' }: LogoLoaderProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className={className}>
      <style>
        {`
          @keyframes pulseCircuit {
            0%, 100% { stroke-opacity: 0.3; fill-opacity: 0.3; }
            50% { stroke-opacity: 1; fill-opacity: 1; }
          }
          @keyframes bouncePillar {
            0%, 100% { transform: scaleY(1); }
            50% { transform: scaleY(0.7); }
          }
          .circuit-line { stroke-opacity: 0.3; animation: pulseCircuit 2s ease-in-out infinite; }
          .circuit-line:nth-child(even) { animation-delay: 1s; }
          .circuit-dot { fill-opacity: 0.3; animation: pulseCircuit 2s ease-in-out infinite; }
          .circuit-dot:nth-child(even) { animation-delay: 0.5s; }
          
          .pillar {
            animation: bouncePillar 1.2s ease-in-out infinite;
          }
          .pillar-1 { animation-delay: 0s; }
          .pillar-2 { animation-delay: 0.2s; }
          .pillar-3 { animation-delay: 0.4s; }
          .pillar-4 { animation-delay: 0.6s; }
        `}
      </style>

      {/* Fundo Gradient Escuro */}
      <defs>
        <linearGradient id="bgGradientLoader" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#16325B" />
          <stop offset="100%" stopColor="#0B192C" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#bgGradientLoader)" />

      {/* Circulo Eletrônico / Trilhas */}
      <g stroke="#488DC7" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* Trilhas da esquerda */}
        <path className="circuit-line" d="M4 16h6l4-4h8" />
        <path className="circuit-line" d="M4 24h10l4 4" />
        <path className="circuit-line" d="M4 32h14" />
        <path className="circuit-line" d="M4 40h10l4-4" />
        <path className="circuit-line" d="M4 48h6l4 4h8" />
        <circle className="circuit-dot" cx="22" cy="12" r="2" fill="#488DC7" stroke="none" />
        <circle className="circuit-dot" cx="22" cy="52" r="2" fill="#488DC7" stroke="none" />
        <circle className="circuit-dot" cx="18" cy="28" r="1.5" fill="#488DC7" stroke="none" />
        <circle className="circuit-dot" cx="18" cy="36" r="1.5" fill="#488DC7" stroke="none" />

        {/* Trilhas da direita */}
        <path className="circuit-line" d="M60 16h-6l-4-4h-8" />
        <path className="circuit-line" d="M60 24h-10l-4 4" />
        <path className="circuit-line" d="M60 32h-14" />
        <path className="circuit-line" d="M60 40h-10l-4-4" />
        <path className="circuit-line" d="M60 48h-6l-4 4h-8" />
        <circle className="circuit-dot" cx="42" cy="12" r="2" fill="#488DC7" stroke="none" />
        <circle className="circuit-dot" cx="42" cy="52" r="2" fill="#488DC7" stroke="none" />
        <circle className="circuit-dot" cx="46" cy="28" r="1.5" fill="#488DC7" stroke="none" />
        <circle className="circuit-dot" cx="46" cy="36" r="1.5" fill="#488DC7" stroke="none" />

        {/* Trilhas verticais baixo */}
        <path className="circuit-line" d="M26 60v-6" />
        <path className="circuit-line" d="M32 60v-10" />
        <path className="circuit-line" d="M38 60v-6" />
      </g>

      {/* Prédio Governamental (Centro) */}
      <g fill="#A9D4F5">
        {/* Telhado Triângulo */}
        <polygon points="32,16 18,24 46,24" />
        {/* Círculo Frontal do Telhado */}
        <circle cx="32" cy="21" r="1.5" fill="#0B192C" />
        {/* Base Telhado */}
        <rect x="18" y="25" width="28" height="2" />
        
        {/* Pilares animando como equalizador */}
        <rect className="pillar pillar-1" x="20" y="28" width="3" height="14" style={{ transformOrigin: '21.5px 42px' }} />
        <rect className="pillar pillar-2" x="26" y="28" width="3" height="14" style={{ transformOrigin: '27.5px 42px' }} />
        <rect className="pillar pillar-3" x="35" y="28" width="3" height="14" style={{ transformOrigin: '36.5px 42px' }} />
        <rect className="pillar pillar-4" x="41" y="28" width="3" height="14" style={{ transformOrigin: '42.5px 42px' }} />
        
        {/* Escadaria Base */}
        <rect x="18" y="43" width="28" height="2" />
        <rect x="16" y="46" width="32" height="3" />
      </g>
    </svg>
  );
}
