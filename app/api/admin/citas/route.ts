import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireApiRole } from '@/lib/auth/guards';
import { getAdminDb } from '@/lib/firebase-admin';
import { adminUpdateAppointmentStatusSchema } from '@/lib/validators/admin';
import { getAdminAppointmentsAndReport } from '@/services/admin';
import { AppointmentStatus, UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const { searchParams } = request.nextUrl;
  const result = await getAdminAppointmentsAndReport({
    dateFrom: searchParams.get('dateFrom') ?? undefined,
    dateTo: searchParams.get('dateTo') ?? undefined,
    barberId: searchParams.get('barberId') ?? undefined,
    status: searchParams.get('status') ?? undefined,
  });

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
    const db = getAdminDb();
    const apptRef = db.collection('citas').doc(appointmentId);
    const apptSnap = await apptRef.get();

    if (!apptSnap.exists) {
      return NextResponse.json(
        { error: 'La cita no existe.' },
        { status: 404 }
      );
    }

    const batch = db.batch();
    batch.update(apptRef, {
      status,
      updatedAt: Timestamp.now(),
    });

    // Si se cancela o el cliente no asistió, liberar los bloqueos de ocupación asociados
    if (
      status === AppointmentStatus.CANCELLED ||
      status === AppointmentStatus.NO_SHOW
    ) {
      const occupancySnap = await db
        .collection('ocupacion')
        .where('appointmentId', '==', appointmentId)
        .get();
      for (const occDoc of occupancySnap.docs) {
        batch.delete(occDoc.ref);
      }
    }

    await batch.commit();

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
