import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import {
  serverCommitWrites,
  serverGetDoc,
  type ServerBatchOperation,
} from '@/lib/firestore-server';
import { updateScheduleSchema } from '@/lib/validators/admin';
import { getAdminSchedulesAndBlocks } from '@/services/admin';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const data = await getAdminSchedulesAndBlocks(authResult.idToken);
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

    const sanitizedDays = days.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isOpen: day.isOpen,
      openTime: day.openTime,
      closeTime: day.closeTime,
      ...(day.breakStart && day.breakEnd
        ? { breakStart: day.breakStart, breakEnd: day.breakEnd }
        : {}),
    }));

    const ops: ServerBatchOperation[] = [
      {
        type: 'set',
        collection: 'horarios',
        docId: scheduleId,
        data: {
          id: scheduleId,
          ...(scheduleId !== 'general' ? { barberId: scheduleId } : {}),
          isPublic: scheduleId === 'general',
          days: sanitizedDays,
        },
        serverTimestampFields: ['updatedAt'],
      },
    ];

    if (scheduleId === 'general') {
      const configSnap = await serverGetDoc(
        'configuracion',
        'main',
        authResult.idToken
      );
      if (configSnap.exists) {
        ops.push({
          type: 'update',
          collection: 'configuracion',
          docId: 'main',
          data: { updatedByAdmin: true },
          serverTimestampFields: ['updatedAt'],
        });
      }
    }

    await serverCommitWrites(ops, authResult.idToken);

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
