'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarClock,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Scissors,
  Settings,
  UserCheck,
  UserRound,
  Users,
} from 'lucide-react';
import type { SessionUser } from '@/lib/auth/session';
import { useFirebase } from '@/components/shared/firebase-provider';

interface AdminShellProps {
  session: SessionUser;
  children: ReactNode;
}

const ADMIN_NAV = [
  { href: '/admin', label: 'Resumen y reportes', icon: LayoutDashboard },
  { href: '/admin/barberos', label: 'Barberos', icon: Users },
  { href: '/admin/servicios', label: 'Servicios', icon: Scissors },
  { href: '/admin/clientes', label: 'Clientes', icon: UserRound },
  { href: '/admin/horarios', label: 'Horarios y bloqueos', icon: CalendarClock },
  { href: '/admin/configuracion', label: 'Configuración', icon: Settings },
] as const;

export function AdminShell({ session, children }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOutUser } = useFirebase();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOutUser();
    router.replace('/login');
    router.refresh();
  };

  const activeNav =
    ADMIN_NAV.find((item) =>
      item.href === '/admin'
        ? pathname === '/admin'
        : pathname.startsWith(item.href)
    ) ?? ADMIN_NAV[0];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="flex flex-col justify-between border-b border-stone-200 bg-white p-6 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div>
          <Link
            href="/"
            className="flex items-center gap-2 whitespace-nowrap font-[var(--font-playfair)] text-lg font-semibold tracking-tight text-stone-900"
          >
            <Scissors className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <span>Barbería Estudio</span>
          </Link>

          <p className="mt-1 text-xs text-stone-500">
            Administración · Rol {session.role}
          </p>

          <nav
            aria-label="Navegación de administración"
            className="mt-6 flex gap-1.5 overflow-x-auto pb-1 lg:mt-8 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
          >
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === '/admin'
                  ? pathname === '/admin'
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-[40px] items-center gap-3 whitespace-nowrap shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-stone-900 text-stone-50'
                      : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-amber-400' : 'text-stone-500'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}

            <Link
              href="/barbero"
              className="flex min-h-[40px] items-center gap-3 whitespace-nowrap shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900 lg:mt-3 lg:border-t lg:border-stone-200 lg:pt-3"
            >
              <UserCheck
                className="h-4 w-4 shrink-0 text-stone-500"
                aria-hidden="true"
              />
              <span>Vista de barbero</span>
            </Link>
          </nav>
        </div>

        <div className="mt-6 border-t border-stone-200 pt-5">
          <div className="flex items-center gap-2.5 text-xs">
            <Users className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-stone-900">
                {session.displayName}
              </p>
              <p className="truncate text-stone-500">{session.email}</p>
            </div>
          </div>

          <button
            type="button"
            disabled={signingOut}
            onClick={handleSignOut}
            className="mt-4 flex min-h-[40px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-60"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-stone-200 bg-white px-6 lg:px-8">
          <p className="truncate text-sm font-medium text-stone-600">
            Administración <span aria-hidden="true">/</span>{' '}
            <span className="text-stone-900">{activeNav.label}</span>
          </p>

          <Link
            href="/reservar"
            className="inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-xs font-medium text-stone-50 transition-colors hover:bg-stone-800"
          >
            <span>Reservas públicas</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </header>

        <main className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
