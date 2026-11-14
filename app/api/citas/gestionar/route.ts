import { NextRequest, NextResponse } from 'next/server';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import { getServerIdToken } from '@/lib/firestore-server';
import { manageBookingRequestSchema } from '@/lib/validators/booking';
import {
  BookingConfigurationError,
  BookingConflictError,
  BookingNotFoundError,
  BookingValidationError,
  cancelPublicBooking,
  lookupPublicBooking,
  reschedulePublicBooking,
  type BookingAuthProof,
} from '@/services/booking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = manageBookingRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ??
            'Verifica los datos de tu reserva.',
        },
        { status: 400 }
      );
    }

    const data = parsed.data;
    let proof: BookingAuthProof;

    if (data.manageToken) {
      proof = { manageToken: data.manageToken };
    } else if (data.bookingCode && data.email) {
      proof = { bookingCode: data.bookingCode, email: data.email };
    } else {
      return NextResponse.json(
        {
          error:
            'Ingresa tu código de reserva y el correo electrónico con el que agendaste.',
        },
        { status: 400 }
      );
    }

    const idToken = hasAdminServiceAccount()
      ? undefined
      : await getServerIdToken();

    if (data.mode === 'lookup') {
      const summary = await lookupPublicBooking(proof, idToken);
      return NextResponse.json({ summary });
    }

    if (data.mode === 'cancel') {
      const summary = await cancelPublicBooking(proof, idToken);
      return NextResponse.json({
        message: 'Tu cita fue cancelada y el horario quedó liberado.',
        summary,
      });
    }

    const summary = await reschedulePublicBooking(
      proof,
      {
        date: data.date,
        startTime: data.startTime,
        barberId: data.barberId,
      },
      idToken
    );

    return NextResponse.json({
      message: 'Tu cita fue reprogramada correctamente.',
      summary,
    });
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }
    if (error instanceof BookingNotFoundError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 404 }
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
        : 'No fue posible procesar la solicitud sobre la reserva.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
