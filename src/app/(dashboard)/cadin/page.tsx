import CadinDashboard from '@/components/cadin-core/cadin-dashboard';
import styles from './cadin.module.css';

export const metadata = {
  title: 'CADIN - Cadastro de Autoridades Inteligente',
  description: 'Governança institucional e cerimonial',
};

export default function CadinPage() {
  return (
    <div className={styles.container}>
      {/* 
        Aqui injetamos o componente isolado.
        No futuro, passaremos tenant_id="f25299db-1c33-45b9-830f-82f6d2d666ef" (Gabinete Carol)
        para garantir multi-tenancy.
      */}
      <CadinDashboard tenantId="Gabinete-Carol" />
    </div>
  );
}
