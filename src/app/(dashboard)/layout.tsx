import Sidebar from '@/components/sidebar';
import GlobalAliaWidget from '@/components/global-alia-widget';
import styles from './dashboard.module.css';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.container}>
      <Sidebar />
      <main className={styles.main}>
        {children}
        <GlobalAliaWidget />
      </main>
    </div>
  );
}
