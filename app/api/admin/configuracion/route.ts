import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireApiRole } from '@/lib/auth/guards';
import { getAdminDb } from '@/lib/firebase-admin';
import { shopConfigMutationSchema } from '@/lib/validators/admin';
import { getAdminShopConfig } from '@/services/admin';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const config = await getAdminShopConfig();
  return NextResponse.json({ config });
}

export async function PUT(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = shopConfigMutationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const {
      name,
      tagline,
      address,
      city,
      phone,
      email,
      whatsapp,
      instagram,
      adminNotificationEmail,
      slotIntervalMinutes,
    } = parsed.data;

    await db
      .collection('configuracion')
      .doc('main')
      .set(
        {
          id: 'main',
          name,
          tagline,
          address,
          city,
          phone,
          email,
          ...(whatsapp ? { whatsapp } : { whatsapp: '' }),
          ...(instagram ? { instagram } : { instagram: '' }),
          ...(adminNotificationEmail
            ? { adminNotificationEmail }
            : { adminNotificationEmail: '' }),
          timezone: 'America/Bogota',
          slotIntervalMinutes,
          updatedByAdmin: true,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );

    return NextResponse.json({
      message: 'Configuración de la barbería guardada correctamente.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible guardar la configuración.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
