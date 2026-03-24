import PareceresDashboard from '@/components/pareceres-core/pareceres-dashboard';

export const metadata = {
  title: 'Pareceres IA | Gabinete Virtual',
  description: 'Gerador inteligente de Pareceres Legislativos',
};

export default function PareceresPage() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Componente Nativo do Pareceres substituiu o antigo iframe */}
      <PareceresDashboard />
    </div>
  );
}
