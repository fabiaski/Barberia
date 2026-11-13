import type { Metadata } from 'next';
import { FirebaseProvider } from '@/components/shared/firebase-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Barbería Estudio — Sistema de Agendamiento',
  description:
    'Sistema web profesional para administración y agendamiento de citas de barbería.',
  openGraph: {
    title: 'Barbería Estudio — Sistema de Agendamiento',
    description:
      'Sistema web profesional para administración y agendamiento de citas de barbería.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Barbería Estudio — Sistema de Agendamiento',
    description:
      'Sistema web profesional para administración y agendamiento de citas de barbería.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body suppressHydrationWarning className="min-h-screen bg-stone-50 text-stone-900">
        <FirebaseProvider>{children}</FirebaseProvider>
      </body>
    </html>
  );
}
