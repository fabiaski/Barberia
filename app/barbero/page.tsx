import { redirect } from 'next/navigation';
import { BarberWorkspaceClient } from '@/components/barbero/barber-workspace-client';
import { getServerSession } from '@/lib/auth/session';
import { getServerIdToken } from '@/lib/firestore-server';
import {
  getBarberWorkspaceData,
  type BarberAgendaRange,
} from '@/services/barbero';
import { UserRole } from '@/types';

export const dynamic = 'force-dynamic';

export default async function BarberoPage({
  searchParams,
}: {
  searchParams: Promise<{ barberId?: string; date?: string; range?: string }>;
}) {
  const [session, idToken, params] = await Promise.all([
    getServerSession(),
    getServerIdToken(),
    searchParams,
  ]);

  if (!session) {
    redirect('/login?next=/barbero');
  }

  const range: BarberAgendaRange =
    params.range === 'week' || params.range === 'upcoming'
      ? params.range
      : 'day';

  const workspace = await getBarberWorkspaceData({
    session,
    requestedBarberId:
      session.role === UserRole.ADMIN ? params.barberId : undefined,
    date: params.date,
    range,
    idToken,
  });

  return (
    <BarberWorkspaceClient
      initialData={workspace}
      isAdminPreview={session.role === UserRole.ADMIN}
    />
  );
}
