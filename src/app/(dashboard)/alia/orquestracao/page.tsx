import styles from '../alia-dashboard.module.css';

export default function OrquestracaoPage() {
  return (
    <div className={styles.emptyState}>
      <h2>Orquestração</h2>
      <p>Painel de subagentes e métricas — em breve (Fase 1b).</p>
      <p className={styles.muted}>
        Esta seção exibirá os 13 agentes ALIA com status realtime, métricas de execução
        (tokens, custo, taxa de sucesso) e logs recentes.
      </p>
    </div>
  );
}
