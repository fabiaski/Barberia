import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import {
  serverCommitWrites,
  serverGetDoc,
  serverQueryCollection,
  type ServerBatchOperation,
} from '@/lib/firestore-server';
import { createBookingManageToken } from '@/lib/auth/manage-token';
import { barberUpdateAppointmentStatusSchema } from '@/lib/validators/barbero';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { buildOccupancySlotKeys } from '@/services/booking';
import { sendBookingCancelledEmails } from '@/services/email';
import { AppointmentStatus, UserRole } from '@/types';

const TERMINAL_STATUSES = new Set<string>([
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
]);

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
    const { id: appointmentId } = await context.params;
    const body = await request.json();
    const parsed = barberUpdateAppointmentStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'El estado de la cita no es válido.'
          ),
        },
        { status: 400 }
      );
    }

    const { status: nextStatus } = parsed.data;
    const apptSnap = await serverGetDoc(
      'citas',
      appointmentId,
      authResult.idToken
    );

    if (!apptSnap.exists || !apptSnap.data) {
      return NextResponse.json(
        { error: 'La cita no existe.' },
        { status: 404 }
      );
    }

    const apptData = apptSnap.data;
    const currentStatus = String(apptData.status ?? '');

    if (authResult.user.role === UserRole.BARBER) {
      const ownsByUid = String(apptData.barberUid ?? '') === authResult.user.uid;
      const ownsByBarberId =
        Boolean(authResult.user.barberId) &&
        String(apptData.barberId ?? '') === authResult.user.barberId;

      if (!ownsByUid && !ownsByBarberId) {
        return NextResponse.json(
          { error: 'No tienes permiso para modificar citas de otro barbero.' },
          { status: 403 }
        );
      }

      if (TERMINAL_STATUSES.has(currentStatus)) {
        return NextResponse.json(
          {
            error:
              'Esta cita ya se encuentra en un estado final y no puede modificarse.',
          },
          { status: 400 }
        );
      }
    }

    const ops: ServerBatchOperation[] = [
      {
        type: 'update',
        collection: 'citas',
        docId: appointmentId,
        data: { status: nextStatus },
        serverTimestampFields: ['updatedAt'],
      },
    ];

    if (
      nextStatus === AppointmentStatus.CANCELLED ||
      nextStatus === AppointmentStatus.NO_SHOW
    ) {
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
        const occDocs = await serverQueryCollection(
          'ocupacion',
          {
            filters: [{ field: 'appointmentId', op: '==', value: appointmentId }],
          },
          authResult.idToken
        );
        for (const occDoc of occDocs) {
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

    if (nextStatus === AppointmentStatus.CANCELLED) {
      const clientEmail = String(apptData.clientEmail ?? '');
      await sendBookingCancelledEmails({
        summary: {
          id: appointmentId,
          bookingCode: String(
            apptData.bookingCode ?? appointmentId.slice(0, 8).toUpperCase()
          ),
          serviceId: String(apptData.serviceId ?? ''),
          serviceName: String(apptData.serviceName ?? ''),
          priceCop: Number(apptData.priceCop ?? 0),
          durationMinutes: Number(apptData.durationMinutes ?? 30),
          barberId: String(apptData.barberId ?? ''),
          barberName: String(apptData.barberName ?? ''),
          date: String(apptData.date ?? ''),
          startTime: String(apptData.startTime ?? ''),
          endTime: String(apptData.endTime ?? ''),
          status: AppointmentStatus.CANCELLED,
          notes: apptData.notes ? String(apptData.notes) : undefined,
          clientName: String(apptData.clientName ?? ''),
          clientPhone: String(apptData.clientPhone ?? ''),
          clientEmail,
          canModify: false,
          manageToken: createBookingManageToken(appointmentId, clientEmail),
        },
        cancelledBy:
          authResult.user.role === UserRole.ADMIN ? 'admin' : 'barbero',
        barberUid: String(apptData.barberUid ?? ''),
        idToken: authResult.idToken,
        requestOrigin: request.nextUrl.origin,
      });
    }

    return NextResponse.json({
      message: 'Estado de la cita actualizado correctamente.',
      status: nextStatus,
    });
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible actualizar el estado de la cita.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
