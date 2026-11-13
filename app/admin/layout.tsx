import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/admin-shell';
import { requireRole } from '@/lib/auth/guards';
import { UserRole } from '@/types';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireRole([UserRole.ADMIN]);

  return <AdminShell session={session}>{children}</AdminShell>;
}
