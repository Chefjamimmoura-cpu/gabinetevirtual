import Topbar from '@/components/topbar';
import IndicacoesDashboard from './indicacoes-dashboard';

export default function IndicacoesPage() {
  return (
    <>
      <Topbar title="Gestão de Indicações" subtitle="Tracking inteligente: Gabinete -> Executivo" />
      <IndicacoesDashboard />
    </>
  );
}
