import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireApiRole } from '@/lib/auth/guards';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { updateBarberSchema } from '@/lib/validators/admin';
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
    const parsed = updateBarberSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const adminAuth = getAdminAuth();
    const barberRef = db.collection('barberos').doc(id);
    const barberSnap = await barberRef.get();

    if (!barberSnap.exists) {
      return NextResponse.json(
        { error: 'El barbero indicado no existe.' },
        { status: 404 }
      );
    }

    const barberData = barberSnap.data()!;
    let userId = String(barberData.userId ?? '');
    const userRef = db.collection('usuarios').doc(userId);
    const userSnap = await userRef.get();
    const userEmail = String(
      userSnap.data()?.email ?? `${id}@barberiaestudio.co`
    );

    const { name, specialty, bio, photoUrl, phone, active, newPassword } =
      parsed.data;

    // Si el barbero inicial (ej. José) fue sembrado sin cuenta Auth real y se le asigna contraseña, crear/vincular cuenta Auth
    let finalUid = userId;
    try {
      const authUser = await adminAuth
        .getUser(userId)
        .catch(() => adminAuth.getUserByEmail(userEmail));
      finalUid = authUser.uid;
      await adminAuth.updateUser(finalUid, {
        displayName: name,
        disabled: !active,
        ...(newPassword ? { password: newPassword } : {}),
      });
    } catch {
      if (newPassword) {
        const createdAuthUser = await adminAuth.createUser({
          email: userEmail,
          password: newPassword,
          displayName: name,
          emailVerified: true,
          disabled: !active,
        });
        finalUid = createdAuthUser.uid;
      }
    }

    const now = Timestamp.now();
    const batch = db.batch();

    if (finalUid !== userId) {
      batch.set(db.collection('usuarios').doc(finalUid), {
        uid: finalUid,
        email: userEmail,
        ...(phone ? { phone } : {}),
        displayName: name,
        role: UserRole.BARBER,
        barberId: id,
        active,
        createdAt: userSnap.data()?.createdAt ?? now,
        updatedAt: now,
      });
      if (userSnap.exists) {
        batch.delete(userRef);
      }
      userId = finalUid;
    } else if (userSnap.exists) {
      batch.update(userRef, {
        displayName: name,
        ...(phone ? { phone } : {}),
        active,
        updatedAt: now,
      });
    }

    batch.update(barberRef, {
      userId,
      name,
      specialty,
      bio: bio ?? '',
      photoUrl: photoUrl || '/images/barber_mateo.jpg',
      active,
      updatedAt: now,
    });

    await batch.commit();

    return NextResponse.json({
      message: 'Datos del barbero actualizados correctamente.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible actualizar el barbero.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await context.params;
    const db = getAdminDb();
    const adminAuth = getAdminAuth();

    const barberRef = db.collection('barberos').doc(id);
    const barberSnap = await barberRef.get();
    if (!barberSnap.exists) {
      return NextResponse.json(
        { error: 'El barbero indicado no existe.' },
        { status: 404 }
      );
    }

    const userId = String(barberSnap.data()?.userId ?? '');
    const historySnap = await db
      .collection('citas')
      .where('barberId', '==', id)
      .limit(1)
      .get();

    const now = Timestamp.now();

    if (!historySnap.empty) {
      const batch = db.batch();
      batch.update(barberRef, { active: false, updatedAt: now });
      if (userId) {
        const userRef = db.collection('usuarios').doc(userId);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          batch.update(userRef, { active: false, updatedAt: now });
        }
        await adminAuth.updateUser(userId, { disabled: true }).catch(() => {});
      }
      await batch.commit();

      return NextResponse.json({
        deactivatedOnly: true,
        message:
          'El barbero tiene citas registradas en el historial, por lo que fue desactivado.',
      });
    }

    const batch = db.batch();
    batch.delete(barberRef);
    batch.delete(db.collection('horarios').doc(id));
    if (userId) {
      batch.delete(db.collection('usuarios').doc(userId));
      await adminAuth.deleteUser(userId).catch(() => {});
    }
    await batch.commit();

    return NextResponse.json({
      deactivatedOnly: false,
      message: 'Barbero eliminado correctamente.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible eliminar el barbero.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
