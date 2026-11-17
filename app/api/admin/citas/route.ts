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
import { adminUpdateAppointmentStatusSchema } from '@/lib/validators/admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { getAdminAppointmentsAndReport } from '@/services/admin';
import { sendBookingCancelledEmails } from '@/services/email';
import { AppointmentStatus, UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
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
  } catch (error) {
    return NextResponse.json(
      {
        error: translateErrorMessageEs(
          error,
          'No fue posible consultar las citas.'
        ),
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = adminUpdateAppointmentStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'Datos inválidos para actualizar la cita.'
          ),
        },
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

    const previousStatus = String(apptSnap.data?.status ?? '');
    const emailNotification =
      status === AppointmentStatus.CANCELLED &&
      previousStatus !== AppointmentStatus.CANCELLED &&
      apptSnap.data
        ? await sendBookingCancelledEmails({
            summary: {
              id: appointmentId,
              bookingCode: String(
                apptSnap.data.bookingCode ??
                  appointmentId.slice(0, 8).toUpperCase()
              ),
              serviceId: String(apptSnap.data.serviceId ?? ''),
              serviceName: String(apptSnap.data.serviceName ?? ''),
              priceCop: Number(apptSnap.data.priceCop ?? 0),
              durationMinutes: Number(apptSnap.data.durationMinutes ?? 30),
              barberId: String(apptSnap.data.barberId ?? ''),
              barberName: String(apptSnap.data.barberName ?? ''),
              date: String(apptSnap.data.date ?? ''),
              startTime: String(apptSnap.data.startTime ?? ''),
              endTime: String(apptSnap.data.endTime ?? ''),
              status: AppointmentStatus.CANCELLED,
              notes: apptSnap.data.notes
                ? String(apptSnap.data.notes)
                : undefined,
              clientName: String(apptSnap.data.clientName ?? ''),
              clientPhone: String(apptSnap.data.clientPhone ?? ''),
              clientEmail: String(apptSnap.data.clientEmail ?? ''),
              canModify: false,
              manageToken: createBookingManageToken(
                appointmentId,
                String(apptSnap.data.clientEmail ?? '')
              ),
            },
            cancelledBy: 'admin',
            barberUid: String(apptSnap.data.barberUid ?? ''),
            idToken: authResult.idToken,
            requestOrigin: request.nextUrl.origin,
          })
        : undefined;

    return NextResponse.json({
      message: 'Estado de la cita actualizado correctamente.',
      ...(emailNotification ? { emailNotification } : {}),
    });
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible actualizar la cita.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
