import type { ReactNode } from 'react';
import { BarberoShell } from '@/components/barbero/barbero-shell';
import { requireRole } from '@/lib/auth/guards';
import { UserRole } from '@/types';

export const dynamic = 'force-dynamic';

export default async function BarberoLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireRole([UserRole.BARBER, UserRole.ADMIN]);

  return <BarberoShell session={session}>{children}</BarberoShell>;
}
