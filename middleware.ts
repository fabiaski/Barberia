import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'barberia_session';

/**
 * Protección rápida en borde: evita acceso sin cookie de sesión a rutas privadas.
 * La verificación criptográfica del token y el rol real se ejecutan en Server Components y APIs.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME)?.value
  );

  if (
    (pathname.startsWith('/admin') || pathname.startsWith('/barbero')) &&
    !hasSessionCookie
  ) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/barbero/:path*'],
};
