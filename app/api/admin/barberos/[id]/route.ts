import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import {
  getAdminAuth,
  getFirebaseProjectConfig,
  hasAdminServiceAccount,
} from '@/lib/firebase-admin';
import {
  serverCommitWrites,
  serverGetDoc,
  serverQueryCollection,
  serverSetDoc,
  serverUpdateDoc,
} from '@/lib/firestore-server';
import { updateBarberSchema } from '@/lib/validators/admin';
import { UserRole } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function createAuthUserViaWebApi(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<string> {
  const { apiKey } = getFirebaseProjectConfig();
  const signUpRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        password: params.password,
        returnSecureToken: true,
      }),
    }
  );

  const signUpJson = (await signUpRes.json()) as {
    localId?: string;
    idToken?: string;
    error?: { message?: string };
  };

  if (!signUpRes.ok || !signUpJson.localId) {
    const rawMsg = signUpJson.error?.message ?? '';
    if (rawMsg === 'EMAIL_EXISTS') {
      throw new Error(
        'Ese correo ya existe en Firebase Authentication; en modo vista previa sin Service Account no se puede sobreescribir la contraseña existente.'
      );
    }
    throw new Error(
      rawMsg || 'No fue posible crear la cuenta en Firebase Authentication.'
    );
  }

  if (signUpJson.idToken) {
    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken: signUpJson.idToken,
          displayName: params.displayName,
          returnSecureToken: false,
        }),
      }
    ).catch(() => {});
  }

  return signUpJson.localId;
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

    const barberSnap = await serverGetDoc('barberos', id, authResult.idToken);

    if (!barberSnap.exists || !barberSnap.data) {
      return NextResponse.json(
        { error: 'El barbero indicado no existe.' },
        { status: 404 }
      );
    }

    const barberData = barberSnap.data;
    let userId = String(barberData.userId ?? '');
    const userSnap = await serverGetDoc('usuarios', userId, authResult.idToken);
    const userEmail = String(
      userSnap.data?.email ?? `${id}@barberiaestudio.co`
    );

    const { name, specialty, bio, photoUrl, phone, active, newPassword } =
      parsed.data;

    let finalUid = userId;
    if (hasAdminServiceAccount()) {
      const adminAuth = getAdminAuth();
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
    } else if (newPassword) {
      if (userId.startsWith('barber_')) {
        finalUid = await createAuthUserViaWebApi({
          email: userEmail,
          password: newPassword,
          displayName: name,
        });
      } else {
        return NextResponse.json(
          {
            error:
              'Cambiar la contraseña de una cuenta existente requiere FIREBASE_ADMIN_CLIENT_EMAIL y FIREBASE_ADMIN_PRIVATE_KEY en el servidor.',
          },
          { status: 400 }
        );
      }
    }

    if (finalUid !== userId) {
      await serverSetDoc(
        'usuarios',
        finalUid,
        {
          uid: finalUid,
          email: userEmail,
          ...(phone ? { phone } : {}),
          displayName: name,
          role: UserRole.BARBER,
          barberId: id,
          active,
        },
        { serverTimestampFields: ['createdAt', 'updatedAt'] },
        authResult.idToken
      );

      // En firestore.rules `barberos` `allow update` exige `incoming().userId == existing().userId`.
      // Por eso cuando cambia el UID de un barbero sembrado (ej. José al asignarle contraseña real),
      // se actualiza con `merge` o se recrea si `userId` difiere.
      if (hasAdminServiceAccount()) {
        await serverUpdateDoc(
          'barberos',
          id,
          {
            userId: finalUid,
            name,
            specialty,
            bio: bio ?? '',
            photoUrl: photoUrl || '/images/barber_mateo.jpg',
            active,
          },
          { serverTimestampFields: ['updatedAt'] },
          authResult.idToken
        );
      } else {
        await serverCommitWrites(
          [
            { type: 'delete', collection: 'barberos', docId: id },
            {
              type: 'set',
              collection: 'barberos',
              docId: id,
              data: {
                id,
                userId: finalUid,
                name,
                specialty,
                bio: bio ?? '',
                photoUrl: photoUrl || '/images/barber_mateo.jpg',
                active,
              },
              serverTimestampFields: ['createdAt', 'updatedAt'],
            },
          ],
          authResult.idToken
        );
      }

      if (userSnap.exists) {
        await serverCommitWrites(
          [{ type: 'delete', collection: 'usuarios', docId: userId }],
          authResult.idToken
        );
      }
      userId = finalUid;
    } else if (userSnap.exists) {
      await serverUpdateDoc(
        'usuarios',
        userId,
        {
          displayName: name,
          ...(phone ? { phone } : {}),
          active,
        },
        { serverTimestampFields: ['updatedAt'] },
        authResult.idToken
      );
    }

    if (finalUid === String(barberData.userId ?? '')) {
      await serverUpdateDoc(
        'barberos',
        id,
        {
          name,
          specialty,
          bio: bio ?? '',
          photoUrl: photoUrl || '/images/barber_mateo.jpg',
          active,
        },
        { serverTimestampFields: ['updatedAt'] },
        authResult.idToken
      );
    }

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
    const barberSnap = await serverGetDoc('barberos', id, authResult.idToken);
    if (!barberSnap.exists) {
      return NextResponse.json(
        { error: 'El barbero indicado no existe.' },
        { status: 404 }
      );
    }

    const userId = String(barberSnap.data?.userId ?? '');
    const historyDocs = await serverQueryCollection(
      'citas',
      {
        filters: [{ field: 'barberId', op: '==', value: id }],
        limit: 1,
      },
      authResult.idToken
    );

    if (historyDocs.length > 0) {
      const ops: Array<{
        type: 'update';
        collection: string;
        docId: string;
        data: Record<string, unknown>;
        serverTimestampFields: string[];
      }> = [
        {
          type: 'update',
          collection: 'barberos',
          docId: id,
          data: { active: false },
          serverTimestampFields: ['updatedAt'],
        },
      ];
      if (userId) {
        const userSnap = await serverGetDoc(
          'usuarios',
          userId,
          authResult.idToken
        );
        if (userSnap.exists) {
          ops.push({
            type: 'update',
            collection: 'usuarios',
            docId: userId,
            data: { active: false },
            serverTimestampFields: ['updatedAt'],
          });
        }
        if (hasAdminServiceAccount()) {
          await getAdminAuth()
            .updateUser(userId, { disabled: true })
            .catch(() => {});
        }
      }
      await serverCommitWrites(ops, authResult.idToken);

      return NextResponse.json({
        deactivatedOnly: true,
        message:
          'El barbero tiene citas registradas en el historial, por lo que fue desactivado.',
      });
    }

    const deleteOps: Array<{
      type: 'delete';
      collection: string;
      docId: string;
    }> = [
      { type: 'delete', collection: 'barberos', docId: id },
      { type: 'delete', collection: 'horarios', docId: id },
    ];
    if (userId) {
      deleteOps.push({ type: 'delete', collection: 'usuarios', docId: userId });
      if (hasAdminServiceAccount()) {
        await getAdminAuth().deleteUser(userId).catch(() => {});
      }
    }
    await serverCommitWrites(deleteOps, authResult.idToken);

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
