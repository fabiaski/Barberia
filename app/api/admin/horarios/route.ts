import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireApiRole } from '@/lib/auth/guards';
import { getAdminDb } from '@/lib/firebase-admin';
import { updateScheduleSchema } from '@/lib/validators/admin';
import { getAdminSchedulesAndBlocks } from '@/services/admin';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const data = await getAdminSchedulesAndBlocks();
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = updateScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Horario inválido.' },
        { status: 400 }
      );
    }

    const { scheduleId, days } = parsed.data;
    const db = getAdminDb();
    const now = Timestamp.now();

    const sanitizedDays = days.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isOpen: day.isOpen,
      openTime: day.openTime,
      closeTime: day.closeTime,
      ...(day.breakStart && day.breakEnd
        ? { breakStart: day.breakStart, breakEnd: day.breakEnd }
        : {}),
    }));

    const batch = db.batch();
    batch.set(db.collection('horarios').doc(scheduleId), {
      id: scheduleId,
      ...(scheduleId !== 'general' ? { barberId: scheduleId } : {}),
      isPublic: scheduleId === 'general',
      days: sanitizedDays,
      updatedAt: now,
    });

    if (scheduleId === 'general') {
      batch.set(
        db.collection('configuracion').doc('main'),
        {
          updatedByAdmin: true,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    await batch.commit();

    return NextResponse.json({
      message: 'Horario de atención guardado correctamente.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible guardar el horario.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
