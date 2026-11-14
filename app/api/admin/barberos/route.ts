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
} from '@/lib/firestore-server';
import { createBarberSchema } from '@/lib/validators/admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { generateUniqueDocId, listAdminBarbers } from '@/services/admin';
import { UserRole } from '@/types';

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
    throw new Error(
      translateErrorMessageEs(
        rawMsg,
        'No fue posible crear la cuenta de acceso del barbero.'
      )
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

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const barbers = await listAdminBarbers(authResult.idToken);
    return NextResponse.json({ barbers });
  } catch (error) {
    return NextResponse.json(
      {
        error: translateErrorMessageEs(
          error,
          'No fue posible cargar la lista de barberos.'
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
    const parsed = createBarberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'Verifica los datos ingresados del barbero.'
          ),
        },
        { status: 400 }
      );
    }

    const { name, email, password, phone, specialty, bio, photoUrl, active } =
      parsed.data;

    let uid: string;
    if (hasAdminServiceAccount()) {
      const adminAuth = getAdminAuth();
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
    } else {
      uid = await createAuthUserViaWebApi({
        email,
        password,
        displayName: name,
      });
    }

    const barberId = await generateUniqueDocId(
      'barberos',
      name,
      authResult.idToken
    );

    // Crear primero `usuarios/{uid}` para cumplir `exists()` en firestore.rules
    await serverSetDoc(
      'usuarios',
      uid,
      {
        uid,
        email,
        ...(phone ? { phone } : {}),
        displayName: name,
        role: UserRole.BARBER,
        barberId,
        active,
      },
      { serverTimestampFields: ['createdAt', 'updatedAt'] },
      authResult.idToken
    );

    await serverSetDoc(
      'barberos',
      barberId,
      {
        id: barberId,
        userId: uid,
        name,
        specialty,
        ...(bio ? { bio } : {}),
        photoUrl: photoUrl || '/images/barber_mateo.jpg',
        active,
      },
      { serverTimestampFields: ['createdAt', 'updatedAt'] },
      authResult.idToken
    );

    return NextResponse.json(
      {
        message: 'Barbero y cuenta de acceso creados correctamente.',
        barberId,
        uid,
      },
      { status: 201 }
    );
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible registrar el barbero.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const barbersDocs = await serverQueryCollection(
      'barberos',
      {},
      authResult.idToken
    );

    if (barbersDocs.length === 0) {
      return NextResponse.json({
        deletedCount: 0,
        message: 'No hay barberos registrados para eliminar.',
      });
    }

    const deleteOps: Array<{
      type: 'delete';
      collection: string;
      docId: string;
    }> = [];

    for (const doc of barbersDocs) {
      deleteOps.push({ type: 'delete', collection: 'barberos', docId: doc.id });
      deleteOps.push({ type: 'delete', collection: 'horarios', docId: doc.id });

      const userId = String(doc.data?.userId ?? '').trim();
      if (userId) {
        const userSnap = await serverGetDoc(
          'usuarios',
          userId,
          authResult.idToken
        ).catch(() => ({ exists: false, data: undefined }));
        if (userSnap.exists && userSnap.data?.role === UserRole.BARBER) {
          deleteOps.push({
            type: 'delete',
            collection: 'usuarios',
            docId: userId,
          });
          if (hasAdminServiceAccount()) {
            await getAdminAuth().deleteUser(userId).catch(() => {});
          }
        }
      }
    }

    for (let i = 0; i < deleteOps.length; i += 400) {
      await serverCommitWrites(deleteOps.slice(i, i + 400), authResult.idToken);
    }

    return NextResponse.json({
      deletedCount: barbersDocs.length,
      message: `Se eliminaron ${barbersDocs.length} barbero(s). Ahora puedes agregarlos manualmente.`,
    });
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible vaciar la lista de barberos.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
