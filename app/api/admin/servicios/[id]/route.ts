import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import {
  serverDeleteDoc,
  serverGetDoc,
  serverQueryCollection,
  serverUpdateDoc,
} from '@/lib/firestore-server';
import { serviceMutationSchema } from '@/lib/validators/admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { UserRole } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const parsed = serviceMutationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'Datos inválidos para actualizar el servicio.'
          ),
        },
        { status: 400 }
      );
    }

    const snap = await serverGetDoc('servicios', id, authResult.idToken);

    if (!snap.exists) {
      return NextResponse.json(
        { error: 'El servicio no existe.' },
        { status: 404 }
      );
    }

    await serverUpdateDoc(
      'servicios',
      id,
      { ...parsed.data },
      { serverTimestampFields: ['updatedAt'] },
      authResult.idToken
    );

    return NextResponse.json({
      message: 'Servicio actualizado correctamente.',
    });
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible actualizar el servicio.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const snap = await serverGetDoc('servicios', id, authResult.idToken);

    if (!snap.exists) {
      return NextResponse.json(
        { error: 'El servicio no existe.' },
        { status: 404 }
      );
    }

    const usedDocs = await serverQueryCollection(
      'citas',
      {
        filters: [{ field: 'serviceId', op: '==', value: id }],
        limit: 1,
      },
      authResult.idToken
    );

    if (usedDocs.length > 0) {
      await serverUpdateDoc(
        'servicios',
        id,
        { active: false },
        { serverTimestampFields: ['updatedAt'] },
        authResult.idToken
      );
      return NextResponse.json({
        deactivatedOnly: true,
        message:
          'El servicio tiene citas asociadas en el historial, por lo que fue desactivado.',
      });
    }

    await serverDeleteDoc('servicios', id, authResult.idToken);
    return NextResponse.json({
      deactivatedOnly: false,
      message: 'Servicio eliminado correctamente.',
    });
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible eliminar el servicio.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
