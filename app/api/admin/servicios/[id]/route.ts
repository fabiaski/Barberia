import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireApiRole } from '@/lib/auth/guards';
import { getAdminDb } from '@/lib/firebase-admin';
import { serviceMutationSchema } from '@/lib/validators/admin';
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
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const serviceRef = db.collection('servicios').doc(id);
    const snap = await serviceRef.get();

    if (!snap.exists) {
      return NextResponse.json(
        { error: 'El servicio no existe.' },
        { status: 404 }
      );
    }

    await serviceRef.update({
      ...parsed.data,
      updatedAt: Timestamp.now(),
    });

    return NextResponse.json({
      message: 'Servicio actualizado correctamente.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible actualizar el servicio.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const db = getAdminDb();
    const serviceRef = db.collection('servicios').doc(id);
    const snap = await serviceRef.get();

    if (!snap.exists) {
      return NextResponse.json(
        { error: 'El servicio no existe.' },
        { status: 404 }
      );
    }

    const usedSnap = await db
      .collection('citas')
      .where('serviceId', '==', id)
      .limit(1)
      .get();

    if (!usedSnap.empty) {
      await serviceRef.update({ active: false, updatedAt: Timestamp.now() });
      return NextResponse.json({
        deactivatedOnly: true,
        message:
          'El servicio tiene citas asociadas en el historial, por lo que fue desactivado.',
      });
    }

    await serviceRef.delete();
    return NextResponse.json({
      deactivatedOnly: false,
      message: 'Servicio eliminado correctamente.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible eliminar el servicio.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
