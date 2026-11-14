import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { serverSetDoc } from '@/lib/firestore-server';
import { barberUpdateScheduleSchema } from '@/lib/validators/barbero';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { resolveBarberForSession } from '@/services/barbero';
import { UserRole } from '@/types';

export async function PUT(request: NextRequest) {
  const authResult = await requireApiRole(request, [
    UserRole.BARBER,
    UserRole.ADMIN,
  ]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = barberUpdateScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'El formato del horario no es válido.'
          ),
        },
        { status: 400 }
      );
    }

    const { barber } = await resolveBarberForSession(
      authResult.user,
      authResult.user.role === UserRole.ADMIN
        ? parsed.data.barberId
        : undefined,
      authResult.idToken
    );

    const sanitizedDays = parsed.data.days.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isOpen: day.isOpen,
      openTime: day.openTime,
      closeTime: day.closeTime,
      ...(day.breakStart && day.breakEnd
        ? { breakStart: day.breakStart, breakEnd: day.breakEnd }
        : {}),
    }));

    await serverSetDoc(
      'horarios',
      barber.id,
      {
        id: barber.id,
        barberId: barber.id,
        isPublic: false,
        days: sanitizedDays,
      },
      { serverTimestampFields: ['updatedAt'] },
      authResult.idToken
    );

    return NextResponse.json({
      message: `Horario personalizado de ${barber.name} guardado correctamente.`,
    });
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible guardar tu horario personalizado.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
