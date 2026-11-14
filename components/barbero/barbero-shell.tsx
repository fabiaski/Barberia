'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  CalendarOff,
  Clock,
  ExternalLink,
  LogOut,
  Scissors,
  Shield,
  User,
} from 'lucide-react';
import type { SessionUser } from '@/lib/auth/session';
import { useFirebase } from '@/components/shared/firebase-provider';
import { UserRole } from '@/types';

interface BarberoShellProps {
  session: SessionUser;
  children: ReactNode;
}

export function BarberoShell({ session, children }: BarberoShellProps) {
  const router = useRouter();
  const { signOutUser } = useFirebase();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOutUser();
    router.replace('/login');
    router.refresh();
  };

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
            Agenda del barbero · Rol {session.role}
          </p>

          <nav aria-label="Navegación del barbero" className="mt-8 space-y-1">
            <a
              href="#agenda"
              className="flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              <Calendar className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
              <span className="truncate">Agenda y citas</span>
            </a>

            <a
              href="#horario-personal"
              className="flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              <Clock className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
              <span className="truncate">Mi horario</span>
            </a>

            <a
              href="#bloqueos-personales"
              className="flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              <CalendarOff className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
              <span className="truncate">Mis bloqueos</span>
            </a>

            {session.role === UserRole.ADMIN && (
              <Link
                href="/admin"
                className="flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                <Shield className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
                <span className="truncate">Volver a administración</span>
              </Link>
            )}
          </nav>
        </div>

        <div className="mt-8 border-t border-stone-200 pt-5">
          <div className="flex items-center gap-2.5 text-xs">
            <User className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
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
            className="mt-4 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-60"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-stone-200 bg-white px-6 lg:px-8">
          <p className="truncate text-sm font-medium text-stone-600">
            Barbería Estudio <span aria-hidden="true">/</span>{' '}
            <span className="text-stone-900">Panel del barbero</span>
          </p>

          <Link
            href="/"
            className="inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-800 transition-colors hover:bg-stone-100"
          >
            <span>Sitio público</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </header>

        <main className="mx-auto w-full max-w-5xl px-6 py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
