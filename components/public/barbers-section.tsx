import Image from 'next/image';
import Link from 'next/link';
import { Scissors } from 'lucide-react';
import type { Barber } from '@/types';

interface BarbersSectionProps {
  barbers: Barber[];
}

export function BarbersSection({ barbers }: BarbersSectionProps) {
  const isSingleBarber = barbers.length === 1;

  return (
    <section id="barberos" className="border-b border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-medium text-amber-700">Nuestro equipo</p>
          <h2 className="mt-2 font-[var(--font-playfair)] text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            {isSingleBarber
              ? 'Atención directa de tu barbero'
              : 'Barberos dedicados al detalle'}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">
            Elige a tu barbero habitual o selecciona la opción de primer
            disponible dentro del agendamiento para encontrar el horario más
            cercano.
          </p>
        </div>

        {isSingleBarber ? (
          <div className="mt-10">
            {barbers.map((barber) => (
              <article
                key={barber.id}
                className="grid overflow-hidden rounded-xl border border-stone-200 bg-white md:grid-cols-12"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-stone-200 md:col-span-5 md:aspect-auto md:min-h-[340px]">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-stone-700 to-stone-900 text-stone-400"
                  >
                    <Scissors className="h-8 w-8" />
                  </div>
                  {barber.photoUrl && (
                    <Image
                      src={barber.photoUrl}
                      alt={`Retrato profesional de ${barber.name}`}
                      fill
                      sizes="(max-width: 768px) 100vw, 42vw"
                      referrerPolicy="no-referrer"
                      className="object-cover"
                    />
                  )}
                </div>

                <div className="flex flex-col justify-between p-8 md:col-span-7">
                  <div>
                    <p className="text-xs font-medium text-amber-700">
                      {barber.specialty}
                    </p>
                    <h3 className="mt-2 font-[var(--font-playfair)] text-3xl font-semibold text-stone-900">
                      {barber.name}
                    </h3>
                    {barber.bio && (
                      <p className="mt-4 max-w-xl text-sm leading-relaxed text-stone-600">
                        {barber.bio}
                      </p>
                    )}
                  </div>

                  <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-stone-100 pt-6">
                    <Link
                      href={`/reservar?barbero=${barber.id}`}
                      className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-lg bg-stone-900 px-6 py-2.5 text-xs font-medium text-stone-50 transition-colors hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                    >
                      Reservar con {barber.name}
                    </Link>
                    <span className="text-xs text-stone-500">
                      Horario sujeto a disponibilidad diaria de su agenda
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {barbers.map((barber) => (
              <article
                key={barber.id}
                className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-stone-200">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-stone-700 to-stone-900 text-stone-400"
                  >
                    <Scissors className="h-8 w-8" />
                  </div>
                  {barber.photoUrl && (
                    <Image
                      src={barber.photoUrl}
                      alt={`Retrato profesional de ${barber.name}`}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      referrerPolicy="no-referrer"
                      className="object-cover"
                    />
                  )}
                </div>

                <div className="flex flex-1 flex-col justify-between p-6">
                  <div>
                    <p className="text-xs font-medium text-amber-700">
                      {barber.specialty}
                    </p>
                    <h3 className="mt-1.5 font-[var(--font-playfair)] text-xl font-semibold text-stone-900">
                      {barber.name}
                    </h3>
                    {barber.bio && (
                      <p className="mt-2 text-sm leading-relaxed text-stone-600">
                        {barber.bio}
                      </p>
                    )}
                  </div>

                  <Link
                    href={`/reservar?barbero=${barber.id}`}
                    className="mt-6 inline-flex min-h-[42px] w-full items-center justify-center whitespace-nowrap rounded-lg bg-stone-900 px-4 py-2.5 text-xs font-medium text-stone-50 transition-colors hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                  >
                    Reservar con {barber.name.split(' ')[0]}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
