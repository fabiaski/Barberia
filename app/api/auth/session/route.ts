import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase-admin';
import {
  getServerSession,
  resolveAuthorizedUser,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/auth/session';
import { sessionExchangeSchema } from '@/lib/validators/auth';

function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim() === 'https';
  }
  return request.nextUrl.protocol === 'https:';
}

function applySessionCookie(
  response: NextResponse,
  value: string,
  maxAge: number,
  isHttps: boolean
): void {
  response.cookies.set(SESSION_COOKIE_NAME, value, {
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

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(parsed.data.idToken, true);

    const authorizedUser = await resolveAuthorizedUser({
      uid: decoded.uid,
      email: decoded.email,
      displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
      emailVerified: Boolean(decoded.email_verified),
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

    const sessionCookie = await adminAuth.createSessionCookie(
      parsed.data.idToken,
      {
        expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
      }
    );

    const response = NextResponse.json({
      authenticated: true,
      user: authorizedUser,
    });

    applySessionCookie(
      response,
      sessionCookie,
      SESSION_MAX_AGE_SECONDS,
      isHttpsRequest(request)
    );

    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible validar la sesión.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ authenticated: false, user: null });
  applySessionCookie(response, '', 0, isHttpsRequest(request));
  return response;
}
