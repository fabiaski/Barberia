import 'server-only';
import { cookies } from 'next/headers';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
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

function normalizeRole(value: unknown): UserRole | null {
  if (value === UserRole.ADMIN || value === 'admin') return UserRole.ADMIN;
  if (value === UserRole.BARBER || value === 'barbero') return UserRole.BARBER;
  return null;
}

/**
 * Sincroniza y resuelve el perfil RBAC del usuario autenticado desde `usuarios/{uid}` en Firestore.
 * Si corresponde al correo administrador inicial verificado, asegura su documento en `usuarios`.
 * Si el barbero fue pre-registrado por correo antes de crear su UID de Auth, vincula el registro.
 */
export async function resolveAuthorizedUser(params: {
  uid: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
}): Promise<SessionUser | null> {
  const { uid, email, displayName, emailVerified = false } = params;
  const normalizedEmail = email?.trim().toLowerCase() ?? '';
  const db = getAdminDb();
  const userRef = db.collection('usuarios').doc(uid);
  const userSnap = await userRef.get();

  if (userSnap.exists) {
    const data = userSnap.data()!;
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

  // Bootstrap automático del administrador principal (verificado o primer registro único)
  if (normalizedEmail === ADMIN_BOOTSTRAP_EMAIL) {
    let allowBootstrap = emailVerified;
    if (!allowBootstrap) {
      const existingAdminSnap = await db
        .collection('usuarios')
        .where('role', '==', UserRole.ADMIN)
        .where('active', '==', true)
        .limit(1)
        .get();
      allowBootstrap = existingAdminSnap.empty;
    }

    if (allowBootstrap) {
      const now = Timestamp.now();
      const adminPayload = {
        uid,
        email: normalizedEmail,
        displayName: displayName?.trim() || 'Administrador',
        role: UserRole.ADMIN,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      await userRef.set(adminPayload, { merge: true });

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
    const byEmailSnap = await db
      .collection('usuarios')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!byEmailSnap.empty) {
      const legacyDoc = byEmailSnap.docs[0];
      const legacyData = legacyDoc.data();
      const role = normalizeRole(legacyData.role);
      const active = Boolean(legacyData.active);

      if (role && active) {
        const now = Timestamp.now();
        const barberId = legacyData.barberId
          ? String(legacyData.barberId)
          : undefined;
        const resolvedName = String(
          legacyData.displayName ?? displayName ?? 'Equipo'
        );

        const batch = db.batch();
        batch.set(userRef, {
          uid,
          email: normalizedEmail,
          displayName: resolvedName,
          role,
          ...(barberId ? { barberId } : {}),
          active: true,
          createdAt: legacyData.createdAt ?? now,
          updatedAt: now,
        });

        if (barberId) {
          const barberRef = db.collection('barberos').doc(barberId);
          batch.set(
            barberRef,
            {
              userId: uid,
              updatedAt: now,
            },
            { merge: true }
          );
        }

        if (legacyDoc.id !== uid) {
          batch.delete(legacyDoc.ref);
        }

        await batch.commit();

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

    const decoded = await getAdminAuth().verifySessionCookie(
      sessionCookie,
      true
    );

    return await resolveAuthorizedUser({
      uid: decoded.uid,
      email: decoded.email,
      displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
      emailVerified: Boolean(decoded.email_verified),
    });
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
      const decoded = await getAdminAuth().verifyIdToken(token, true);
      return await resolveAuthorizedUser({
        uid: decoded.uid,
        email: decoded.email,
        displayName:
          typeof decoded.name === 'string' ? decoded.name : undefined,
        emailVerified: Boolean(decoded.email_verified),
      });
    } catch {
      return null;
    }
  }

  return getServerSession();
}
