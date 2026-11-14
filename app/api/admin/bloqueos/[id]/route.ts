import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { serverDeleteDoc, serverGetDoc } from '@/lib/firestore-server';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { UserRole } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const snap = await serverGetDoc('bloqueos', id, authResult.idToken);

    if (!snap.exists) {
      return NextResponse.json(
        { error: 'El bloqueo no existe.' },
        { status: 404 }
      );
    }

    await serverDeleteDoc('bloqueos', id, authResult.idToken);
    return NextResponse.json({ message: 'Bloqueo eliminado correctamente.' });
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible eliminar el bloqueo.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
