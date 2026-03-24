import Topbar from '@/components/topbar';
import OficiosDashboard from './oficios-dashboard';

export default function OficiosPage() {
  return (
    <>
      <Topbar title="Central de Ofícios" subtitle="Geração inteligente de correspondência oficial" />
      <OficiosDashboard />
    </>
  );
}
