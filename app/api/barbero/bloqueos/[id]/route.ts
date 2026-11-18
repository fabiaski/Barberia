import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { serverDeleteDoc, serverGetDoc } from '@/lib/firestore-server';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { barberCreateBlockSchema } from '@/lib/validators/barbero';
import {
  BarberBlockConflictError,
  BarberBlockNotFoundError,
  BarberBlockPermissionError,
  BarberBlockValidationError,
  updateValidatedScheduleBlock,
} from '@/services/barbero';
import { UserRole } from '@/types';

export async function PATCH(
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
    const body = await request.json();
    const parsed = barberCreateBlockSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'Verifica los datos del bloqueo.'
          ),
        },
        { status: 400 }
      );
    }

    const { date, allDay, startTime, endTime, reason, barberId } = parsed.data;

    const result = await updateValidatedScheduleBlock({
      blockId,
      session: authResult.user,
      targetBarberId:
        authResult.user.role === UserRole.ADMIN ? barberId : undefined,
      date,
      allDay,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      reason,
      idToken: authResult.idToken,
    });

    return NextResponse.json({
      message: result.message,
      block: result.block,
      deactivatedSlots: result.deactivatedSlots,
      deactivatedCount: result.deactivatedCount,
    });
  } catch (error) {
    if (error instanceof BarberBlockConflictError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }
    if (error instanceof BarberBlockPermissionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403 }
      );
    }
    if (error instanceof BarberBlockNotFoundError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 404 }
      );
    }
    if (error instanceof BarberBlockValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    const message = translateErrorMessageEs(
      error,
      'No fue posible actualizar el bloqueo.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

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
    const message = translateErrorMessageEs(
      error,
      'No fue posible eliminar el bloqueo.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
