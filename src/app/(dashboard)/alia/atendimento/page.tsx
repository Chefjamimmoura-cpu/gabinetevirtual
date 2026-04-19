'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import AliaMonitor from '../components/alia-monitor';
import AliaChat from '../components/alia-chat';
import styles from '../alia-dashboard.module.css';

const SUBABAS = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'chat',    label: 'Chat ALIA' },
] as const;

type SubAbaId = typeof SUBABAS[number]['id'];

export default function AtendimentoPage() {
  const router = useRouter();
  const params = useSearchParams();
  const aba = (params.get('tab') as SubAbaId | null) ?? 'monitor';

  function setAba(novaAba: SubAbaId) {
    router.push(`/alia/atendimento?tab=${novaAba}`);
  }

  return (
    <div>
      <nav className={styles.subTabs}>
        {SUBABAS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`${styles.subTab} ${aba === id ? styles.subTabAtiva : ''}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {aba === 'monitor' && <AliaMonitor />}
      {aba === 'chat' && <AliaChat agente="alia" />}
    </div>
  );
}
