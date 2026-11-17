import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { createBlockSchema } from '@/lib/validators/admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { getAdminSchedulesAndBlocks } from '@/services/admin';
import {
  BarberBlockConflictError,
  BarberBlockNotFoundError,
  BarberBlockValidationError,
  createValidatedScheduleBlock,
} from '@/services/barbero';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const { blocks } = await getAdminSchedulesAndBlocks(authResult.idToken);
    return NextResponse.json({ blocks });
  } catch (error) {
    return NextResponse.json(
      {
        error: translateErrorMessageEs(
          error,
          'No fue posible consultar los bloqueos.'
        ),
      },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = createBlockSchema.safeParse(body);

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

    const { barberId, date, allDay, startTime, endTime, reason } = parsed.data;

    const result = await createValidatedScheduleBlock({
      session: authResult.user,
      targetBarberId: barberId,
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
        id: result.block.id,
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
      'No fue posible crear el bloqueo.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
