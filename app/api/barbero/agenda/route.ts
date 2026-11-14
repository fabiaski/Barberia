import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import {
  getBarberWorkspaceData,
  type BarberAgendaRange,
} from '@/services/barbero';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [
    UserRole.BARBER,
    UserRole.ADMIN,
  ]);
  if (!authResult.ok) return authResult.response;

  const { searchParams } = request.nextUrl;
  const date = searchParams.get('date') ?? undefined;
  const rawRange = searchParams.get('range');
  const range: BarberAgendaRange =
    rawRange === 'week' || rawRange === 'upcoming' ? rawRange : 'day';
  const requestedBarberId = searchParams.get('barberId') ?? undefined;

  const workspace = await getBarberWorkspaceData({
    session: authResult.user,
    requestedBarberId,
    date,
    range,
    idToken: authResult.idToken,
  });

  return NextResponse.json(workspace);
}
