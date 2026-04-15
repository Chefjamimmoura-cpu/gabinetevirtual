import PareceresDashboard from '@/components/pareceres-core/pareceres-dashboard';

export const metadata = {
  title: 'Pareceres IA | Gabinete Virtual',
  description: 'Gerador inteligente de Pareceres Legislativos',
};

export default function PareceresPage() {
  return (
    <div style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Componente Nativo do Pareceres substituiu o antigo iframe */}
      <PareceresDashboard />
    </div>
  );
}
