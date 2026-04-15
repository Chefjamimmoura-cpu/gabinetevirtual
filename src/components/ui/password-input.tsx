'use client';

// ══════════════════════════════════════════════════════════
// PasswordInput — campo de senha com botão "olho" que revela
// por N segundos (default 2s) e volta ao modo oculto.
//
// Drop-in replacement para <input type="password" />. Aceita todas as
// props nativas de input (value, onChange, placeholder, required,
// className, autoFocus, minLength, id, etc.) e repassa ref.
// ══════════════════════════════════════════════════════════

import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  revealMs?: number;
  wrapperStyle?: React.CSSProperties;
  wrapperClassName?: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { revealMs = 2000, wrapperStyle, wrapperClassName, style, ...rest },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []);

    const reveal = () => {
      setVisible(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        timerRef.current = null;
      }, revealMs);
    };

    const hide = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setVisible(false);
    };

    return (
      <div
        className={wrapperClassName}
        style={{ position: 'relative', display: 'block', ...wrapperStyle }}
      >
        <input
          ref={ref}
          {...rest}
          type={visible ? 'text' : 'password'}
          style={{ ...style, paddingRight: 38 }}
        />
        <button
          type="button"
          onClick={visible ? hide : reveal}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha por 2 segundos'}
          title={visible ? 'Ocultar senha' : 'Mostrar senha por 2 segundos'}
          tabIndex={-1}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: '#6b7280',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4,
            zIndex: 2,
          }}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    );
  },
);
