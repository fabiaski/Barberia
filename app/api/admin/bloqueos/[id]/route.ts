import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { getAdminDb } from '@/lib/firebase-admin';
import { UserRole } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const db = getAdminDb();
    const ref = db.collection('bloqueos').doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json(
        { error: 'El bloqueo no existe.' },
        { status: 404 }
      );
    }

    await ref.delete();
    return NextResponse.json({ message: 'Bloqueo eliminado correctamente.' });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible eliminar el bloqueo.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
