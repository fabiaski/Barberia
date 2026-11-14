import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import { serverSetDoc } from '@/lib/firestore-server';
import { serviceMutationSchema } from '@/lib/validators/admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { generateUniqueDocId, listAdminServices } from '@/services/admin';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const services = await listAdminServices(authResult.idToken);
    return NextResponse.json({ services });
  } catch (error) {
    return NextResponse.json(
      {
        error: translateErrorMessageEs(
          error,
          'No fue posible cargar los servicios.'
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
    const parsed = serviceMutationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'Datos inválidos para crear el servicio.'
          ),
        },
        { status: 400 }
      );
    }

    const serviceId = await generateUniqueDocId(
      'servicios',
      parsed.data.name,
      authResult.idToken
    );

    await serverSetDoc(
      'servicios',
      serviceId,
      {
        id: serviceId,
        ...parsed.data,
      },
      { serverTimestampFields: ['createdAt', 'updatedAt'] },
      authResult.idToken
    );

    return NextResponse.json(
      { message: 'Servicio creado correctamente.', serviceId },
      { status: 201 }
    );
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible crear el servicio.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
