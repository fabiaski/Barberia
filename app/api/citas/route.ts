import { NextRequest, NextResponse } from 'next/server';
import { getServerIdToken } from '@/lib/firestore-server';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import { createBookingSchema } from '@/lib/validators/booking';
import {
  BookingConfigurationError,
  BookingConflictError,
  BookingValidationError,
  createAtomicBooking,
} from '@/services/booking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createBookingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ??
            'Verifica los datos ingresados para confirmar tu cita.',
        },
        { status: 400 }
      );
    }

    const idToken = hasAdminServiceAccount()
      ? undefined
      : await getServerIdToken();

    const { appointment, summary } = await createAtomicBooking(
      parsed.data,
      idToken
    );

    return NextResponse.json(
      {
        message: '¡Tu cita ha sido confirmada!',
        appointmentId: appointment.id,
        bookingCode: summary.bookingCode,
        manageToken: summary.manageToken,
        summary,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }
    if (error instanceof BookingConfigurationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 }
      );
    }
    if (error instanceof BookingValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible registrar tu reserva en este momento.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
