import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { barberCreateBlockSchema } from '@/lib/validators/barbero';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import {
  BarberBlockConflictError,
  BarberBlockNotFoundError,
  BarberBlockValidationError,
  createValidatedScheduleBlock,
  resolveBarberForSession,
} from '@/services/barbero';
import { UserRole } from '@/types';

export async function POST(request: NextRequest) {
  const authResult = await requireApiRole(request, [
    UserRole.BARBER,
    UserRole.ADMIN,
  ]);
  if (!authResult.ok) return authResult.response;

  try {
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

    const { barber } = await resolveBarberForSession(
      authResult.user,
      authResult.user.role === UserRole.ADMIN ? barberId : undefined,
      authResult.idToken
    );

    const targetBarberUid =
      authResult.user.role === UserRole.BARBER
        ? authResult.user.uid
        : barber.userId;

    const result = await createValidatedScheduleBlock({
      session: authResult.user,
      targetBarberId: barber.id,
      targetBarberUid,
      date,
      allDay,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      reason,
      idToken: authResult.idToken,
    });

    return NextResponse.json(
      {
        message: result.message,
        block: result.block,
        deactivatedSlots: result.deactivatedSlots,
        deactivatedCount: result.deactivatedCount,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof BarberBlockConflictError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
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
      'No fue posible crear el bloqueo personal.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
