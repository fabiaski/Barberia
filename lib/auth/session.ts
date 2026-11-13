import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
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
import { UserRole } from '@/types';

export const SESSION_COOKIE_NAME = 'barberia_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5; // 5 días
export const ADMIN_BOOTSTRAP_EMAIL = 'fabiaski13@gmail.com';

export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  barberId?: string;
  active: boolean;
  emailVerified: boolean;
}

interface SignedSessionPayload {
  user: SessionUser;
  exp: number;
}

function getCookieHmacSecret(): string {
  const { projectId, databaseId } = getFirebaseProjectConfig();
  return (
    process.env.SESSION_SECRET ||
    process.env.GEMINI_API_KEY ||
    `${projectId}:${databaseId}:barberia-estudio-session`
  );
}

function signPayload(payload: SignedSessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', getCookieHmacSecret())
    .update(encoded)
    .digest('base64url');
  return `v1.${encoded}.${sig}`;
}

function verifySignedPayload(token: string): SessionUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;

    const [, encoded, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', getCookieHmacSecret())
      .update(encoded)
      .digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return null;
    }

    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SignedSessionPayload;

    if (!parsed?.user || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed.user;
  } catch {
    return null;
  }
}

function normalizeRole(value: unknown): UserRole | null {
  if (value === UserRole.ADMIN || value === 'admin') return UserRole.ADMIN;
  if (value === UserRole.BARBER || value === 'barbero') return UserRole.BARBER;
  return null;
}

/**
 * Verifica el Firebase ID Token recibido desde el cliente.
 * Si hay Service Account configurada valida revocación; en vista previa verifica firma criptográfica sin ADC.
 */
export async function verifyFirebaseIdToken(idToken: string) {
  const adminAuth = getAdminAuth();
  const checkRevoked = hasAdminServiceAccount();
  return adminAuth.verifyIdToken(idToken, checkRevoked);
}

/**
 * Crea la cookie de sesión (Session Cookie nativa de Firebase Admin si hay Service Account,
 * o cookie HttpOnly firmada con HMAC-SHA256 en modo vista previa).
 */
export async function createSessionCookieValue(
  idToken: string,
  user: SessionUser
): Promise<string> {
  if (hasAdminServiceAccount()) {
    return getAdminAuth().createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });
  }

  return signPayload({
    user,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  });
}

/**
 * Sincroniza y resuelve el perfil RBAC del usuario autenticado desde `usuarios/{uid}` en Firestore.
 */
export async function resolveAuthorizedUser(params: {
  uid: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  idToken?: string;
}): Promise<SessionUser | null> {
  const { uid, email, displayName, emailVerified = false, idToken } = params;
  const normalizedEmail = email?.trim().toLowerCase() ?? '';

  const userSnap = await serverGetDoc('usuarios', uid, idToken);

  if (userSnap.exists && userSnap.data) {
    const data = userSnap.data;
    const role = normalizeRole(data.role);
    const active = Boolean(data.active);

    if (!role || !active) {
      return null;
    }

    return {
      uid,
      email: String(data.email ?? normalizedEmail),
      displayName: String(data.displayName ?? displayName ?? 'Usuario'),
      role,
      barberId: data.barberId ? String(data.barberId) : undefined,
      active: true,
      emailVerified,
    };
  }

  // Bootstrap automático del administrador principal
  if (normalizedEmail === ADMIN_BOOTSTRAP_EMAIL) {
    let allowBootstrap = emailVerified;
    if (!allowBootstrap && hasAdminServiceAccount()) {
      const existingAdmins = await serverQueryCollection(
        'usuarios',
        {
          filters: [
            { field: 'role', op: '==', value: UserRole.ADMIN },
            { field: 'active', op: '==', value: true },
          ],
          limit: 1,
        },
        idToken
      );
      allowBootstrap = existingAdmins.length === 0;
    }

    if (allowBootstrap) {
      const adminPayload = {
        uid,
        email: normalizedEmail,
        displayName: displayName?.trim() || 'Administrador',
        role: UserRole.ADMIN,
        active: true,
      };
      await serverSetDoc(
        'usuarios',
        uid,
        adminPayload,
        { merge: false, serverTimestampFields: ['createdAt', 'updatedAt'] },
        idToken
      );

      return {
        uid,
        email: normalizedEmail,
        displayName: adminPayload.displayName,
        role: UserRole.ADMIN,
        active: true,
        emailVerified,
      };
    }
  }

  // Vincular registro previo por correo si fue creado antes del primer inicio de sesión
  if (normalizedEmail) {
    try {
      const byEmailDocs = await serverQueryCollection(
        'usuarios',
        {
          filters: [{ field: 'email', op: '==', value: normalizedEmail }],
          limit: 1,
        },
        idToken
      );

      if (byEmailDocs.length > 0 && byEmailDocs[0].data) {
        const legacyDoc = byEmailDocs[0];
        const legacyData = legacyDoc.data!;
        const role = normalizeRole(legacyData.role);
        const active = Boolean(legacyData.active);

        if (role && active) {
          const barberId = legacyData.barberId
            ? String(legacyData.barberId)
            : undefined;
          const resolvedName = String(
            legacyData.displayName ?? displayName ?? 'Equipo'
          );

          await serverCommitWrites(
            [
              {
                type: 'set',
                collection: 'usuarios',
                docId: uid,
                data: {
                  uid,
                  email: normalizedEmail,
                  displayName: resolvedName,
                  role,
                  ...(barberId ? { barberId } : {}),
                  active: true,
                },
                serverTimestampFields: ['createdAt', 'updatedAt'],
              },
              ...(barberId
                ? [
                    {
                      type: 'set' as const,
                      collection: 'barberos',
                      docId: barberId,
                      data: { userId: uid },
                      merge: true,
                      serverTimestampFields: ['updatedAt'],
                    },
                  ]
                : []),
              ...(legacyDoc.id !== uid
                ? [
                    {
                      type: 'delete' as const,
                      collection: 'usuarios',
                      docId: legacyDoc.id,
                    },
                  ]
                : []),
            ],
            idToken
          );

          return {
            uid,
            email: normalizedEmail,
            displayName: resolvedName,
            role,
            barberId,
            active: true,
            emailVerified,
          };
        }
      }
    } catch {
      // Usuarios sin permiso list en `usuarios` simplemente continúan a null
    }
  }

  return null;
}

/**
 * Obtiene y verifica criptográficamente la sesión actual en Server Components o Route Handlers.
 */
export async function getServerSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) {
      return null;
    }

    if (hasAdminServiceAccount()) {
      const decoded = await getAdminAuth().verifySessionCookie(
        sessionCookie,
        true
      );

      return await resolveAuthorizedUser({
        uid: decoded.uid,
        email: decoded.email,
        displayName:
          typeof decoded.name === 'string' ? decoded.name : undefined,
        emailVerified: Boolean(decoded.email_verified),
      });
    }

    const signedUser = verifySignedPayload(sessionCookie);
    if (!signedUser || !signedUser.active) {
      return null;
    }

    const idToken = cookieStore.get('barberia_id_token')?.value;
    if (!idToken) {
      return null;
    }

    try {
      await verifyFirebaseIdToken(idToken);
    } catch {
      return null;
    }

    return signedUser;
  } catch {
    return null;
  }
}

/**
 * Verifica un ID Token enviado por cabecera Bearer o la cookie de sesión HttpOnly.
 */
export async function getSessionFromRequest(
  authHeader: string | null
): Promise<SessionUser | null> {
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) return null;
    try {
      const decoded = await verifyFirebaseIdToken(token);
      return await resolveAuthorizedUser({
        uid: decoded.uid,
        email: decoded.email,
        displayName:
          typeof decoded.name === 'string' ? decoded.name : undefined,
        emailVerified: Boolean(decoded.email_verified),
        idToken: token,
      });
    } catch {
      return null;
    }
  }

  return getServerSession();
}
