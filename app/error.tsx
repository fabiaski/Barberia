'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RotateCcw, Home } from 'lucide-react';
import { translateErrorMessageEs } from '@/lib/utils/error-es';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Error en la aplicación:', error);
  }, [error]);

  const friendlyError = error?.message
    ? translateErrorMessageEs(
        error,
        'Ocurrió un inconveniente inesperado al procesar esta vista.'
      )
    : '';

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-16 text-stone-900">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-[var(--font-playfair)] text-2xl font-semibold text-stone-900">
          Algo salió mal
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Ocurrió un error inesperado al cargar esta vista. Si estabas en el
          panel administrativo, intenta iniciar sesión nuevamente.
        </p>
        {friendlyError && (
          <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700 break-words">
            {friendlyError}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-800"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Reintentar</span>
          </button>
          <Link
            href="/"
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition-colors hover:bg-stone-50"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            <span>Inicio</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
