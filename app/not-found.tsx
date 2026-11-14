import Link from 'next/link';
import { ArrowLeft, Calendar, Scissors } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-16 text-stone-900">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <Scissors className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-widest text-amber-700">
          Error 404
        </p>
        <h1 className="mt-1 font-[var(--font-playfair)] text-2xl font-semibold text-stone-900">
          Página no encontrada
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          La dirección que buscas no existe o fue movida. Puedes volver a la
          portada o ir directamente a reservar tu cita.
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <Link
            href="/"
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition-colors hover:bg-stone-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Ir al inicio</span>
          </Link>
          <Link
            href="/reservar"
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-800"
          >
            <Calendar className="h-4 w-4" aria-hidden="true" />
            <span>Agendar cita</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
