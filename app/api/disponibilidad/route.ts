import { NextRequest, NextResponse } from 'next/server';
import { checkAvailability } from '@/services/booking';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const barberId = searchParams.get('barberId') ?? '';
    const date = searchParams.get('date') ?? '';
    const serviceId = searchParams.get('serviceId') ?? undefined;
    const durationParam = searchParams.get('durationMinutes');
    const durationMinutes = durationParam ? Number(durationParam) : undefined;

    if (!barberId || !date) {
      return NextResponse.json(
        { error: 'Los parámetros barberId y date son obligatorios.' },
        { status: 400 }
      );
    }

    const availability = await checkAvailability({
      barberId,
      date,
      serviceId,
      durationMinutes,
    });

    return NextResponse.json(availability);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible consultar la disponibilidad.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
