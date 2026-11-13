import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react';
import { DAYS_OF_WEEK_ES } from '@/lib/constants/config';
import { formatTime12h } from '@/lib/utils/timezone';
import type { BarbershopConfig, DaySchedule } from '@/types';

interface InfoFooterProps {
  config: BarbershopConfig;
  scheduleDays: DaySchedule[];
}

export function InfoFooter({ config, scheduleDays }: InfoFooterProps) {
  const orderedDays = [1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
    const label =
      DAYS_OF_WEEK_ES.find((d) => d.value === dayNum)?.label ?? '';
    const schedule = scheduleDays.find((d) => d.dayOfWeek === dayNum);
    return { dayNum, label, schedule };
  });

  return (
    <footer id="horarios" className="bg-stone-50 text-stone-800">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="font-[var(--font-playfair)] text-2xl font-semibold text-stone-900">
              {config.name}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-stone-600">
              {config.tagline}
            </p>

            <div className="mt-6 space-y-3 text-sm text-stone-700">
              <p className="flex items-start gap-2.5">
                <MapPin
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <span>
                  {config.address}, {config.city}
                </span>
              </p>
              <p className="flex items-center gap-2.5">
                <Phone
                  className="h-4 w-4 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <span className="font-mono tabular-nums">{config.phone}</span>
              </p>
              <p className="flex items-center gap-2.5">
                <Mail
                  className="h-4 w-4 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <span>{config.email}</span>
              </p>
            </div>
          </div>

          <div className="lg:col-span-5">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500">
              Horarios de atención ({config.timezone})
            </h2>
            <dl className="mt-4 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
              {orderedDays.map(({ dayNum, label, schedule }) => (
                <div
                  key={dayNum}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <dt className="font-medium text-stone-800">{label}</dt>
                  <dd className="font-mono text-xs text-stone-600 tabular-nums">
                    {schedule?.isOpen
                      ? `${formatTime12h(schedule.openTime)} – ${formatTime12h(schedule.closeTime)}`
                      : 'Cerrado'}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex flex-col justify-between lg:col-span-3">
            <div>
              <h2 className="text-xs font-semibold tracking-wide text-stone-500">
                Ubicación y canales
              </h2>
              <div className="mt-4 rounded-xl border border-stone-200 bg-white p-5">
                <p className="text-sm font-semibold text-stone-900">
                  Chapinero Alto
                </p>
                <p className="mt-1 text-xs leading-relaxed text-stone-600">
                  A dos cuadras de la Carrera 7ª, zona con parqueadero cercano y
                  fácil acceso.
                </p>
                {config.instagram && (
                  <p className="mt-4 font-mono text-xs text-stone-700">
                    Instagram · {config.instagram}
                  </p>
                )}
                {config.whatsapp && (
                  <p className="mt-1 font-mono text-xs text-stone-700 tabular-nums">
                    WhatsApp · {config.whatsapp}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500">
              <p>© {new Date().getFullYear()} {config.name}</p>
              <p className="mt-1.5">
                <Link
                  href="/login"
                  className="font-medium text-stone-700 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-stone-900 hover:decoration-stone-900"
                >
                  Acceso del equipo (Administración / Barberos)
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
