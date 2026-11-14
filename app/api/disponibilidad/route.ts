import { NextRequest, NextResponse } from 'next/server';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { checkAvailability } from '@/services/booking';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const barberId = searchParams.get('barberId') ?? '';
    const date = searchParams.get('date') ?? '';
    const serviceId = searchParams.get('serviceId') ?? undefined;
    const durationParam = searchParams.get('durationMinutes');
    const durationMinutes = durationParam ? Number(durationParam) : undefined;
    const excludeAppointmentId =
      searchParams.get('excludeAppointmentId') ?? undefined;

    if (!barberId || !date) {
      return NextResponse.json(
        { error: 'Los parámetros de barbero y fecha son obligatorios.' },
        { status: 400 }
      );
    }

    const availability = await checkAvailability({
      barberId,
      date,
      serviceId,
      durationMinutes,
      excludeAppointmentId,
    });

    return NextResponse.json(availability);
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible consultar la disponibilidad.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
