'use client';

import { useEffect } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { translateErrorMessageEs } from '@/lib/utils/error-es';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Error crítico en la aplicación:', error);
  }, [error]);

  const friendlyError = error?.message
    ? translateErrorMessageEs(
        error,
        'No fue posible conectar correctamente con los servicios de la aplicación.'
      )
    : '';

  return (
    <html lang="es">
      <body className="flex min-h-screen items-center justify-center bg-stone-950 px-6 py-16 text-stone-100">
        <div className="w-full max-w-md rounded-2xl border border-stone-800 bg-stone-900 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-950/60 text-red-400">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-white">
            Error interno del servidor
          </h1>
          <p className="mt-2 text-sm text-stone-400">
            No se pudo completar la carga de la página. Por favor intenta
            nuevamente en unos segundos.
          </p>
          {friendlyError && (
            <p className="mt-3 break-words rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-xs text-stone-300">
              {friendlyError}
            </p>
          )}
          {error?.digest && (
            <p className="mt-2 font-mono text-[11px] text-stone-500">
              Código de referencia: {error.digest}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-500"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Reintentar</span>
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="inline-flex min-h-[42px] items-center rounded-xl border border-stone-700 px-5 py-2 text-sm font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white"
            >
              Ir al inicio
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
