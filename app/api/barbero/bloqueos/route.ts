import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { generateFirestoreAutoId, serverSetDoc } from '@/lib/firestore-server';
import { barberCreateBlockSchema } from '@/lib/validators/barbero';
import { resolveBarberForSession } from '@/services/barbero';
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
        { error: parsed.error.issues[0]?.message ?? 'Datos del bloqueo inválidos.' },
        { status: 400 }
      );
    }

    const { date, allDay, startTime, endTime, reason, barberId } = parsed.data;

    const { barber } = await resolveBarberForSession(
      authResult.user,
      authResult.user.role === UserRole.ADMIN ? barberId : undefined,
      authResult.idToken
    );

    const blockId = generateFirestoreAutoId();
    const targetBarberUid =
      authResult.user.role === UserRole.BARBER
        ? authResult.user.uid
        : barber.userId;

    await serverSetDoc(
      'bloqueos',
      blockId,
      {
        id: blockId,
        barberId: barber.id,
        barberUid: targetBarberUid,
        date,
        allDay,
        ...(!allDay && startTime && endTime ? { startTime, endTime } : {}),
        reason,
        createdBy: authResult.user.uid,
      },
      { serverTimestampFields: ['createdAt'] },
      authResult.idToken
    );

    return NextResponse.json(
      {
        message: 'Bloqueo personal agregado correctamente.',
        block: {
          id: blockId,
          barberId: barber.id,
          barberUid: targetBarberUid,
          date,
          allDay,
          ...(startTime && endTime && !allDay ? { startTime, endTime } : {}),
          reason,
          createdBy: authResult.user.uid,
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible crear el bloqueo personal.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
