import Link from 'next/link';
import { ArrowUpRight, Clock } from 'lucide-react';
import { formatCurrencyCOP } from '@/lib/utils/timezone';
import type { Service } from '@/types';

interface ServicesSectionProps {
  services: Service[];
}

export function ServicesSection({ services }: ServicesSectionProps) {
  return (
    <section id="servicios" className="border-b border-stone-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <div className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-8 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-medium text-amber-700">
              Carta de servicios
            </p>
            <h2 className="mt-2 font-[var(--font-playfair)] text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
              Tarifas claras y duración garantizada
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-stone-600">
            Cada reserva bloquea exactamente el tiempo que requiere tu
            servicio. Selecciona el tratamiento para abrir la agenda.
          </p>
        </div>

        <div className="divide-y divide-stone-200">
          {services.map((service, index) => (
            <div
              key={service.id}
              className="grid gap-6 py-7 md:grid-cols-12 md:items-center"
            >
              <div className="md:col-span-7">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-stone-400 tabular-nums">
                    {String(index + 1).padStart(2, '0')}.
                  </span>
                  <h3 className="text-lg font-semibold text-stone-900">
                    {service.name}
                  </h3>
                </div>
                <p className="mt-2 pl-8 text-sm leading-relaxed text-stone-600">
                  {service.description}
                </p>
              </div>

              <div className="flex items-center justify-between gap-6 pl-8 md:col-span-5 md:justify-end md:pl-0">
                <div className="text-left md:text-right">
                  <p className="font-mono text-lg font-semibold text-stone-900 tabular-nums">
                    {formatCurrencyCOP(service.priceCop)}
                  </p>
                  <p className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-stone-500 tabular-nums">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {service.durationMinutes} min
                  </p>
                </div>

                <Link
                  href={`/reservar?servicio=${service.id}`}
                  className="inline-flex min-h-[42px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-900 transition-colors hover:border-stone-900 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                >
                  Reservar
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
