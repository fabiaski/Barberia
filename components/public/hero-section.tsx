import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Scissors } from 'lucide-react';
import { formatTime12h } from '@/lib/utils/timezone';
import type { BarbershopConfig, DaySchedule } from '@/types';

interface HeroSectionProps {
  config: BarbershopConfig;
  scheduleDays: DaySchedule[];
}

export function HeroSection({ config, scheduleDays }: HeroSectionProps) {
  const weekdaySchedule = scheduleDays.find((d) => d.dayOfWeek === 1);
  const sundaySchedule = scheduleDays.find((d) => d.dayOfWeek === 0);

  return (
    <section id="inicio" className="border-b border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl px-6 py-12 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-stretch">
          <div className="flex flex-col justify-between lg:col-span-6 lg:py-4">
            <div>
              <p className="text-xs font-medium tracking-wide text-stone-500">
                {config.city} · Barbería tradicional y contemporánea
              </p>

              <h1 className="mt-4 max-w-xl font-[var(--font-playfair)] text-4xl font-semibold leading-[1.1] tracking-tight text-stone-900 [text-wrap:balance] sm:text-5xl lg:text-[3.5rem]">
                Corte clásico, precisión en cada trazo y tu silla reservada a tiempo.
              </h1>

              <p className="mt-6 max-w-lg text-base leading-relaxed text-stone-600">
                {config.tagline} Elige el servicio, selecciona tu barbero de
                confianza y confirma tu cita en menos de un minuto sin crear
                cuenta.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-6">
                <Link
                  href="/reservar"
                  className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-stone-50 transition-colors hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
                >
                  Agendar ahora
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>

                <a
                  href="#servicios"
                  className="whitespace-nowrap shrink-0 text-sm font-medium text-stone-700 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-stone-900 hover:decoration-stone-900"
                >
                  Explorar servicios y tarifas
                </a>
              </div>
            </div>

            <div className="mt-10 border-t border-stone-200 pt-6 text-xs text-stone-500">
              <span>{config.address}</span>
              <span aria-hidden="true" className="mx-2">
                ·
              </span>
              <span>Confirmación inmediata por correo</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-200 lg:aspect-auto lg:h-full lg:min-h-[420px]">
              <div
                aria-hidden="true"
                className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-stone-800 to-stone-900 text-stone-400"
              >
                <Scissors className="h-8 w-8 text-amber-600" />
              </div>
              <Image
                src="/images/hero_barbershop_studio.jpg"
                alt="Interior de Barbería Estudio con estaciones de madera de nogal y sillas clásicas"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
                referrerPolicy="no-referrer"
                className="object-cover"
              />
            </div>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500">
              Lunes a Sábado
            </p>
            <p className="mt-1.5 font-mono text-sm font-medium text-stone-900 tabular-nums">
              {weekdaySchedule?.isOpen
                ? `${formatTime12h(weekdaySchedule.openTime)} – ${formatTime12h(weekdaySchedule.closeTime)}`
                : 'Consultar horario'}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500">Domingos</p>
            <p className="mt-1.5 font-mono text-sm font-medium text-stone-900 tabular-nums">
              {sundaySchedule?.isOpen
                ? `${formatTime12h(sundaySchedule.openTime)} – ${formatTime12h(sundaySchedule.closeTime)}`
                : 'Cerrado'}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500">Ubicación</p>
            <p className="mt-1.5 truncate text-sm font-medium text-stone-900">
              Chapinero Alto · Bogotá
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500">Zona horaria</p>
            <p className="mt-1.5 font-mono text-sm font-medium text-stone-900">
              {config.timezone}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
