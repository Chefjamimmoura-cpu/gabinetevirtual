import Topbar from '@/components/topbar';
import PlsDashboard from './pls-dashboard';

export default function ProjetosLeiPage() {
  return (
    <>
      <Topbar title="Legislativo Estratégico" subtitle="Criação automática de Projetos de Lei e justificativas" />
      <PlsDashboard />
    </>
  );
}
