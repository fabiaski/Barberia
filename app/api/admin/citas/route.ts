import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import {
  serverCommitWrites,
  serverGetDoc,
  serverQueryCollection,
  type ServerBatchOperation,
} from '@/lib/firestore-server';
import { adminUpdateAppointmentStatusSchema } from '@/lib/validators/admin';
import { getAdminAppointmentsAndReport } from '@/services/admin';
import { AppointmentStatus, UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const { searchParams } = request.nextUrl;
  const result = await getAdminAppointmentsAndReport(
    {
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo: searchParams.get('dateTo') ?? undefined,
      barberId: searchParams.get('barberId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    },
    authResult.idToken
  );

  return NextResponse.json(result);
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = adminUpdateAppointmentStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const { appointmentId, status } = parsed.data;
    const apptSnap = await serverGetDoc(
      'citas',
      appointmentId,
      authResult.idToken
    );

    if (!apptSnap.exists) {
      return NextResponse.json(
        { error: 'La cita no existe.' },
        { status: 404 }
      );
    }

    const ops: ServerBatchOperation[] = [
      {
        type: 'update',
        collection: 'citas',
        docId: appointmentId,
        data: { status },
        serverTimestampFields: ['updatedAt'],
      },
    ];

    // Si se cancela o el cliente no asistió, liberar los bloqueos de ocupación
    if (
      status === AppointmentStatus.CANCELLED ||
      status === AppointmentStatus.NO_SHOW
    ) {
      const { buildOccupancySlotKeys } = await import('@/services/booking');
      const apptData = apptSnap.data ?? {};
      const deleteIds = new Set<string>();

      if (
        apptData.barberId &&
        apptData.date &&
        apptData.startTime &&
        apptData.durationMinutes
      ) {
        const deterministic = buildOccupancySlotKeys(
          String(apptData.barberId),
          String(apptData.date),
          String(apptData.startTime),
          Number(apptData.durationMinutes)
        );
        for (const s of deterministic) {
          deleteIds.add(s.slotKey);
        }
      }

      if (hasAdminServiceAccount()) {
        const occupancyDocs = await serverQueryCollection(
          'ocupacion',
          {
            filters: [{ field: 'appointmentId', op: '==', value: appointmentId }],
          },
          authResult.idToken
        );
        for (const occDoc of occupancyDocs) {
          deleteIds.add(occDoc.id);
        }
      }

      for (const docId of deleteIds) {
        ops.push({
          type: 'delete',
          collection: 'ocupacion',
          docId,
        });
      }
    }

    await serverCommitWrites(ops, authResult.idToken);

    return NextResponse.json({
      message: 'Estado de la cita actualizado correctamente.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible actualizar la cita.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
