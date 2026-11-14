import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { serverDeleteDoc, serverGetDoc } from '@/lib/firestore-server';
import { UserRole } from '@/types';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiRole(request, [
    UserRole.BARBER,
    UserRole.ADMIN,
  ]);
  if (!authResult.ok) return authResult.response;

  try {
    const { id: blockId } = await context.params;
    const blockSnap = await serverGetDoc(
      'bloqueos',
      blockId,
      authResult.idToken
    );

    if (!blockSnap.exists || !blockSnap.data) {
      return NextResponse.json(
        { error: 'El bloqueo no existe.' },
        { status: 404 }
      );
    }

    const data = blockSnap.data;
    if (authResult.user.role === UserRole.BARBER) {
      const ownsBlock =
        String(data.barberUid ?? '') === authResult.user.uid &&
        String(data.barberId ?? '') !== 'all';
      if (!ownsBlock) {
        return NextResponse.json(
          { error: 'No puedes eliminar bloqueos globales o de otros barberos.' },
          { status: 403 }
        );
      }
    }

    await serverDeleteDoc('bloqueos', blockId, authResult.idToken);

    return NextResponse.json({
      message: 'Bloqueo personal eliminado correctamente.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible eliminar el bloqueo.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
