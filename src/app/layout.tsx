import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gabinete Virtual',
  description: 'Sistema integrado de assessoria legislativa digital',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
