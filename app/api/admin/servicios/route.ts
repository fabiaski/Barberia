import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireApiRole } from '@/lib/auth/guards';
import { getAdminDb } from '@/lib/firebase-admin';
import { serviceMutationSchema } from '@/lib/validators/admin';
import { generateUniqueDocId, listAdminServices } from '@/services/admin';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const services = await listAdminServices();
  return NextResponse.json({ services });
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = serviceMutationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const serviceId = await generateUniqueDocId('servicios', parsed.data.name);
    const now = Timestamp.now();

    await db.collection('servicios').doc(serviceId).set({
      id: serviceId,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json(
      { message: 'Servicio creado correctamente.', serviceId },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible crear el servicio.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
