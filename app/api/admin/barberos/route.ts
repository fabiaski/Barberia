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
import { createBarberSchema } from '@/lib/validators/admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { generateUniqueDocId, listAdminBarbers } from '@/services/admin';
import { UserRole } from '@/types';

class BarberAuthConflictError extends Error {
  code: string;
  canSendReset: boolean;
  status: number;

  constructor(
    message: string,
    code: string,
    canSendReset = false,
    status = 409
  ) {
    super(message);
    this.name = 'BarberAuthConflictError';
    this.code = code;
    this.canSendReset = canSendReset;
    this.status = status;
  }
}

async function assertUserNotLinkedToAdminOrExistingBarber(params: {
  uid: string;
  idToken?: string;
}): Promise<{ existingBarberUserDoc: boolean }> {
  const [userSnap, existingBarbers] = await Promise.all([
    serverGetDoc('usuarios', params.uid, params.idToken).catch(() => ({
      exists: false,
      data: undefined,
    })),
    serverQueryCollection(
      'barberos',
      {
        filters: [{ field: 'userId', op: '==', value: params.uid }],
        limit: 1,
      },
      params.idToken
    ).catch(() => []),
  ]);

  if (userSnap.exists && userSnap.data?.role === UserRole.ADMIN) {
    throw new BarberAuthConflictError(
      'Ese correo pertenece a una cuenta de administrador activa y no puede reasignarse como barbero.',
      'ADMIN_EMAIL_PROTECTED'
    );
  }

  if (existingBarbers.length > 0) {
    throw new BarberAuthConflictError(
      'Ya existe un barbero registrado con ese correo electrónico. Edítalo directamente en la lista.',
      'BARBER_ALREADY_EXISTS'
    );
  }

  return {
    existingBarberUserDoc: Boolean(
      userSnap.exists && userSnap.data?.role === UserRole.BARBER
    ),
  };
}

async function resolveOrCreateAuthUserViaWebApi(params: {
  email: string;
  password: string;
  displayName: string;
  adminIdToken?: string;
}): Promise<{ uid: string; existingBarberUserDoc: boolean; reusedAuth: boolean }> {
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

  if (signUpRes.ok && signUpJson.localId) {
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

    return {
      uid: signUpJson.localId,
      existingBarberUserDoc: false,
      reusedAuth: false,
    };
  }

  const rawMsg = signUpJson.error?.message ?? '';
  if (rawMsg !== 'EMAIL_EXISTS') {
    throw new Error(
      translateErrorMessageEs(
        rawMsg,
        'No fue posible crear la cuenta de acceso del barbero.'
      )
    );
  }

  // Si el correo ya existía en Authentication (p. ej. de un barbero eliminado previamente
  // sin credenciales Admin), intentamos validarlo con la contraseña ingresada para reutilizarlo.
  const signInRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
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

  const signInJson = (await signInRes.json()) as {
    localId?: string;
    idToken?: string;
    error?: { message?: string };
  };

  if (signInRes.ok && signInJson.localId) {
    const check = await assertUserNotLinkedToAdminOrExistingBarber({
      uid: signInJson.localId,
      idToken: params.adminIdToken,
    });

    if (signInJson.idToken) {
      await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken: signInJson.idToken,
            displayName: params.displayName,
            returnSecureToken: false,
          }),
        }
      ).catch(() => {});
    }

    return {
      uid: signInJson.localId,
      existingBarberUserDoc: check.existingBarberUserDoc,
      reusedAuth: true,
    };
  }

  throw new BarberAuthConflictError(
    'Ese correo ya quedó registrado en Firebase Authentication (al eliminar un barbero sin clave de servidor Admin, su usuario en Authentication no se borra automáticamente). Ingresa la contraseña anterior de ese correo para reactivarlo, envía un enlace para restablecer la contraseña o usa un correo distinto.',
    'BARBER_AUTH_EMAIL_EXISTS',
    true
  );
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
    let existingBarberUserDoc = false;
    let reusedAuth = false;

    if (hasAdminServiceAccount()) {
      const adminAuth = getAdminAuth();
      try {
        const existingAuthUser = await adminAuth.getUserByEmail(email);
        uid = existingAuthUser.uid;
        const check = await assertUserNotLinkedToAdminOrExistingBarber({
          uid,
          idToken: authResult.idToken,
        });
        existingBarberUserDoc = check.existingBarberUserDoc;
        reusedAuth = true;

        await adminAuth.updateUser(uid, {
          displayName: name,
          password,
          emailVerified: true,
          disabled: !active,
        });
      } catch (err: unknown) {
        if (err instanceof BarberAuthConflictError) {
          throw err;
        }
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
      const resolved = await resolveOrCreateAuthUserViaWebApi({
        email,
        password,
        displayName: name,
        adminIdToken: authResult.idToken,
      });
      uid = resolved.uid;
      existingBarberUserDoc = resolved.existingBarberUserDoc;
      reusedAuth = resolved.reusedAuth;
    }

    const barberId = await generateUniqueDocId(
      'barberos',
      name,
      authResult.idToken
    );

    // Crear o actualizar `usuarios/{uid}` primero para cumplir `exists()` en firestore.rules
    if (existingBarberUserDoc) {
      await serverUpdateDoc(
        'usuarios',
        uid,
        {
          displayName: name,
          role: UserRole.BARBER,
          barberId,
          active,
          ...(phone ? { phone } : {}),
        },
        { serverTimestampFields: ['updatedAt'] },
        authResult.idToken
      );
    } else {
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
    }

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
        message: reusedAuth
          ? 'Barbero creado y vinculado nuevamente a la cuenta de correo.'
          : 'Barbero y cuenta de acceso creados correctamente.',
        barberId,
        uid,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof BarberAuthConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          canSendReset: error.canSendReset,
        },
        { status: error.status }
      );
    }

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
