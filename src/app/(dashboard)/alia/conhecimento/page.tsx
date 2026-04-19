import styles from '../alia-dashboard.module.css';

export default function ConhecimentoPage() {
  return (
    <div className={styles.emptyState}>
      <h2>Conhecimento</h2>
      <p>Biblioteca e RAG — em breve (Fases 1c e 2).</p>
      <p className={styles.muted}>
        Aqui você poderá ingerir documentos (PDF, URL, YouTube, áudio, planilhas)
        e visualizar a base de conhecimento da ALIA por domínio.
      </p>
    </div>
  );
}
