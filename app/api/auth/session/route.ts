import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionCookieValue,
  getServerSession,
  resolveAuthorizedUser,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verifyFirebaseIdToken,
} from '@/lib/auth/session';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import { ID_TOKEN_COOKIE_NAME } from '@/lib/firestore-server';
import { sessionExchangeSchema } from '@/lib/validators/auth';
import { ensureInitialCatalogSeeded } from '@/services/public-catalog';
import { UserRole } from '@/types';

const ID_TOKEN_MAX_AGE_SECONDS = 60 * 55; // 55 minutos

function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim() === 'https';
  }
  return request.nextUrl.protocol === 'https:';
}

function applyCookie(
  response: NextResponse,
  name: string,
  value: string,
  maxAge: number,
  isHttps: boolean
): void {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge,
  });
}

export async function GET() {
  const user = await getServerSession();
  if (!user) {
    return NextResponse.json({ authenticated: false, user: null });
  }
  return NextResponse.json({ authenticated: true, user });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = sessionExchangeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Token de autenticación inválido.' },
        { status: 400 }
      );
    }

    const decoded = await verifyFirebaseIdToken(parsed.data.idToken);
    const emailVerified = Boolean(decoded.email_verified);

    if (!hasAdminServiceAccount() && !emailVerified) {
      return NextResponse.json(
        {
          code: 'EMAIL_NOT_VERIFIED',
          error:
            'Debes verificar tu correo electrónico antes de ingresar al panel de gestión.',
        },
        { status: 403 }
      );
    }

    const authorizedUser = await resolveAuthorizedUser({
      uid: decoded.uid,
      email: decoded.email,
      displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
      emailVerified,
      idToken: parsed.data.idToken,
    });

    if (!authorizedUser) {
      return NextResponse.json(
        {
          error:
            'Tu cuenta no tiene permisos de administrador o barbero activo. Solicita acceso al propietario.',
        },
        { status: 403 }
      );
    }

    if (authorizedUser.role === UserRole.ADMIN) {
      await ensureInitialCatalogSeeded(parsed.data.idToken).catch((err) => {
        console.error('No se pudo inicializar catálogo inicial:', err);
      });
    }

    const sessionCookie = await createSessionCookieValue(
      parsed.data.idToken,
      authorizedUser
    );

    const response = NextResponse.json({
      authenticated: true,
      user: authorizedUser,
    });

    const isHttps = isHttpsRequest(request);
    applyCookie(
      response,
      SESSION_COOKIE_NAME,
      sessionCookie,
      SESSION_MAX_AGE_SECONDS,
      isHttps
    );

    if (!hasAdminServiceAccount()) {
      applyCookie(
        response,
        ID_TOKEN_COOKIE_NAME,
        parsed.data.idToken,
        ID_TOKEN_MAX_AGE_SECONDS,
        isHttps
      );
    }

    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible validar la sesión.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const currentSession = await getServerSession();
    if (!currentSession) {
      return NextResponse.json({ refreshed: false }, { status: 401 });
    }

    const body = await request.json();
    const parsed = sessionExchangeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ refreshed: false }, { status: 400 });
    }

    const decoded = await verifyFirebaseIdToken(parsed.data.idToken);
    if (decoded.uid !== currentSession.uid) {
      return NextResponse.json({ refreshed: false }, { status: 403 });
    }

    const response = NextResponse.json({ refreshed: true });
    if (!hasAdminServiceAccount()) {
      applyCookie(
        response,
        ID_TOKEN_COOKIE_NAME,
        parsed.data.idToken,
        ID_TOKEN_MAX_AGE_SECONDS,
        isHttpsRequest(request)
      );
    }
    return response;
  } catch {
    return NextResponse.json({ refreshed: false }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ authenticated: false, user: null });
  const isHttps = isHttpsRequest(request);
  applyCookie(response, SESSION_COOKIE_NAME, '', 0, isHttps);
  applyCookie(response, ID_TOKEN_COOKIE_NAME, '', 0, isHttps);
  return response;
}
