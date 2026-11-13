import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireApiRole } from '@/lib/auth/guards';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { createBarberSchema } from '@/lib/validators/admin';
import { generateUniqueDocId, listAdminBarbers } from '@/services/admin';
import { UserRole } from '@/types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const barbers = await listAdminBarbers();
  return NextResponse.json({ barbers });
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = createBarberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const { name, email, password, phone, specialty, bio, photoUrl, active } =
      parsed.data;

    const adminAuth = getAdminAuth();
    const db = getAdminDb();

    // Crear o actualizar usuario en Firebase Authentication
    let uid: string;
    try {
      const existingAuthUser = await adminAuth.getUserByEmail(email);
      uid = existingAuthUser.uid;
      await adminAuth.updateUser(uid, {
        displayName: name,
        password,
        emailVerified: true,
        disabled: !active,
      });
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      if (code !== 'auth/user-not-found') {
        throw err;
      }
      const created = await adminAuth.createUser({
        email,
        password,
        displayName: name,
        emailVerified: true,
        disabled: !active,
      });
      uid = created.uid;
    }

    const barberId = await generateUniqueDocId('barberos', name);
    const now = Timestamp.now();

    const batch = db.batch();
    batch.set(db.collection('usuarios').doc(uid), {
      uid,
      email,
      ...(phone ? { phone } : {}),
      displayName: name,
      role: UserRole.BARBER,
      barberId,
      active,
      createdAt: now,
      updatedAt: now,
    });

    batch.set(db.collection('barberos').doc(barberId), {
      id: barberId,
      userId: uid,
      name,
      specialty,
      ...(bio ? { bio } : {}),
      photoUrl: photoUrl || '/images/barber_mateo.jpg',
      active,
      createdAt: now,
      updatedAt: now,
    });

    await batch.commit();

    return NextResponse.json(
      {
        message: 'Barbero y cuenta de acceso creados correctamente.',
        barberId,
        uid,
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible registrar el barbero.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
