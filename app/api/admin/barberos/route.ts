import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/guards';
import {
  getAdminAuth,
  getFirebaseProjectConfig,
  hasAdminServiceAccount,
} from '@/lib/firebase-admin';
import { serverSetDoc } from '@/lib/firestore-server';
import { createBarberSchema } from '@/lib/validators/admin';
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
    if (rawMsg === 'EMAIL_EXISTS') {
      throw new Error(
        'Ese correo ya está registrado en Firebase Authentication.'
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

export async function GET(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  const barbers = await listAdminBarbers(authResult.idToken);
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
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible registrar el barbero.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
