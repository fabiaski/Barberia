import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import {
  getServerSession,
  getSessionFromRequest,
  type SessionUser,
} from '@/lib/auth/session';
import { getServerIdToken } from '@/lib/firestore-server';
import { UserRole } from '@/types';

export function getDefaultPanelPath(role: UserRole): string {
  return role === UserRole.ADMIN ? '/admin' : '/barbero';
}

/**
 * Protege Server Components exigiendo una sesión activa y un rol permitido.
 */
export async function requireRole(
  allowedRoles: UserRole[]
): Promise<SessionUser> {
  const session = await getServerSession();

  if (!session) {
    redirect('/login');
  }

  if (!allowedRoles.includes(session.role)) {
    redirect(getDefaultPanelPath(session.role));
  }

  return session;
}

/**
 * Protege Route Handlers (`/api/*`) verificando cookie HttpOnly o Bearer Token y rol permitido.
 */
export async function requireApiRole(
  request: NextRequest,
  allowedRoles: UserRole[]
): Promise<
  | { ok: true; user: SessionUser; idToken?: string }
  | { ok: false; response: NextResponse }
> {
  const authHeader = request.headers.get('authorization');
  const user = await getSessionFromRequest(authHeader);

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Sesión requerida. Inicia sesión para continuar.' },
        { status: 401 }
      ),
    };
  }

  if (!allowedRoles.includes(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No tienes permisos suficientes para realizar esta acción.' },
        { status: 403 }
      ),
    };
  }

  const headerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : undefined;
  const idToken = headerToken || (await getServerIdToken());

  return { ok: true, user, idToken };
}
