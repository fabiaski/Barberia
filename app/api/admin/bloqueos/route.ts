import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import {
  generateFirestoreAutoId,
  serverGetDoc,
  serverSetDoc,
} from '@/lib/firestore-server';
import { createBlockSchema } from '@/lib/validators/admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { getAdminSchedulesAndBlocks } from '@/services/admin';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const { blocks } = await getAdminSchedulesAndBlocks(authResult.idToken);
    return NextResponse.json({ blocks });
  } catch (error) {
    return NextResponse.json(
      {
        error: translateErrorMessageEs(
          error,
          'No fue posible consultar los bloqueos.'
        ),
      },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = createBlockSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'Verifica los datos del bloqueo.'
          ),
        },
        { status: 400 }
      );
    }

    const { barberId, date, allDay, startTime, endTime, reason } = parsed.data;

    let barberUid: string | undefined;
    if (barberId !== 'all') {
      const barberSnap = await serverGetDoc(
        'barberos',
        barberId,
        authResult.idToken
      );
      if (!barberSnap.exists) {
        return NextResponse.json(
          { error: 'El barbero seleccionado no existe.' },
          { status: 404 }
        );
      }
      barberUid = String(barberSnap.data?.userId ?? '');
    }

    const blockId = generateFirestoreAutoId();

    await serverSetDoc(
      'bloqueos',
      blockId,
      {
        id: blockId,
        barberId,
        ...(barberUid ? { barberUid } : {}),
        date,
        allDay,
        ...(!allDay && startTime && endTime ? { startTime, endTime } : {}),
        reason,
        createdBy: authResult.user.uid,
      },
      { serverTimestampFields: ['createdAt'] },
      authResult.idToken
    );

    return NextResponse.json(
      { message: 'Bloqueo de agenda creado correctamente.', id: blockId },
      { status: 201 }
    );
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible crear el bloqueo.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
