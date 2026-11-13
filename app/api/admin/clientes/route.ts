import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { listAdminClients } from '@/services/admin';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const q = request.nextUrl.searchParams.get('q') ?? undefined;
  const clients = await listAdminClients(q, authResult.idToken);
  return NextResponse.json({ clients });
}
