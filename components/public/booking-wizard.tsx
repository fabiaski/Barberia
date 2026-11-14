'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  Lock,
  Scissors,
  Sun,
  SunMedium,
  Trash2,
  User,
} from 'lucide-react';
import { ManageBookingPanel } from '@/components/public/manage-booking-panel';
import {
  bookingContactFormSchema,
  type BookingContactFormInput,
} from '@/lib/validators/booking';
import {
  generateScheduleTimeSlots,
  getUpcomingBookingDates,
} from '@/lib/utils/schedule-slots';
import {
  formatCurrencyCOP,
  formatTime12h,
  minutesToTime,
  timeToMinutes,
} from '@/lib/utils/timezone';
import { SYSTEM_TIMEZONE } from '@/lib/constants/config';
import type { PublicBookingSummary } from '@/services/booking';
import type { PublicCatalogData } from '@/services/public-catalog';

interface BookingWizardProps {
  catalog: PublicCatalogData;
  initialServiceId?: string;
  initialBarberId?: string;
  initialMode?: 'book' | 'manage';
}

interface LiveAvailabilityPayload {
  requestKey: string;
  availableSlots: string[];
  reason?: string;
}

export function BookingWizard({
  catalog,
  initialServiceId,
  initialBarberId,
  initialMode = 'book',
}: BookingWizardProps) {
  const { config, schedule, services, barbers } = catalog;

  const validInitialService = services.find((s) => s.id === initialServiceId);
  const validInitialBarber = barbers.find((b) => b.id === initialBarberId);

  const [mode, setMode] = useState<'book' | 'manage'>(initialMode);
  const [manageInitialSummary, setManageInitialSummary] =
    useState<PublicBookingSummary | null>(null);

  const [step, setStep] = useState<1 | 2 | 3>(validInitialService ? 2 : 1);
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    validInitialService?.id ?? services[0]?.id ?? ''
  );
  const [selectedBarberId, setSelectedBarberId] = useState<string>(
    validInitialBarber?.id ?? barbers[0]?.id ?? 'any'
  );
  const [barberMenuOpen, setBarberMenuOpen] = useState(false);

  const upcomingDates = useMemo(
    () => getUpcomingBookingDates(schedule.days, 21),
    [schedule.days]
  );

  const firstOpenDate = useMemo(
    () => upcomingDates.find((d) => d.isOpen)?.date ?? upcomingDates[0]?.date ?? '',
    [upcomingDates]
  );

  const [datePageIndex, setDatePageIndex] = useState(0);
  const datesPerPage = 7;
  const maxDatePage = Math.max(
    0,
    Math.ceil(upcomingDates.length / datesPerPage) - 1
  );
  const visibleDates = upcomingDates.slice(
    datePageIndex * datesPerPage,
    datePageIndex * datesPerPage + datesPerPage
  );

  const [selectedDate, setSelectedDate] = useState<string>(firstOpenDate);
  const [selectedPeriod, setSelectedPeriod] = useState<'morning' | 'afternoon'>(
    'morning'
  );
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [slotError, setSlotError] = useState<string>('');
  const [confirmedSummary, setConfirmedSummary] =
    useState<PublicBookingSummary | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [availabilityRefreshNonce, setAvailabilityRefreshNonce] = useState(0);

  const [liveAvailability, setLiveAvailability] =
    useState<LiveAvailabilityPayload | null>(null);

  const activeService = useMemo(
    () => services.find((s) => s.id === selectedServiceId) ?? null,
    [services, selectedServiceId]
  );

  const activeBarber = useMemo(
    () =>
      selectedBarberId === 'any'
        ? null
        : barbers.find((b) => b.id === selectedBarberId) ?? null,
    [barbers, selectedBarberId]
  );

  const selectedDateMeta = useMemo(
    () => upcomingDates.find((d) => d.date === selectedDate),
    [upcomingDates, selectedDate]
  );

  const availabilityRequestKey = `${selectedBarberId}|${selectedDate}|${selectedServiceId}|${availabilityRefreshNonce}`;

  useEffect(() => {
    if (
      mode !== 'book' ||
      step !== 2 ||
      !selectedDate ||
      !selectedServiceId ||
      !selectedBarberId
    ) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      barberId: selectedBarberId,
      date: selectedDate,
      serviceId: selectedServiceId,
    });

    fetch(`/api/disponibilidad?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as {
          availableSlots?: string[];
          reason?: string;
        };
      })
      .then((data) => {
        if (!data || !Array.isArray(data.availableSlots)) return;
        setLiveAvailability({
          requestKey: availabilityRequestKey,
          availableSlots: data.availableSlots,
          reason: data.reason,
        });
      })
      .catch(() => {
        // Si falla la red, se conserva el cálculo base del horario general
      });

    return () => {
      controller.abort();
    };
  }, [
    mode,
    step,
    selectedDate,
    selectedServiceId,
    selectedBarberId,
    availabilityRequestKey,
  ]);

  const fallbackSlots = useMemo(() => {
    if (!selectedDate || !activeService) return [];
    const dayObj = schedule.days.find(
      (d) => d.dayOfWeek === selectedDateMeta?.dayOfWeek
    );
    return generateScheduleTimeSlots({
      date: selectedDate,
      daySchedule: dayObj,
      durationMinutes: activeService.durationMinutes,
      intervalMinutes: config.slotIntervalMinutes || 30,
    });
  }, [
    selectedDate,
    activeService,
    schedule.days,
    selectedDateMeta,
    config.slotIntervalMinutes,
  ]);

  const availableSlots = useMemo(() => {
    if (liveAvailability?.requestKey === availabilityRequestKey) {
      return liveAvailability.availableSlots;
    }
    return fallbackSlots;
  }, [liveAvailability, availabilityRequestKey, fallbackSlots]);

  const morningSlots = useMemo(
    () => availableSlots.filter((slot) => timeToMinutes(slot) < 12 * 60),
    [availableSlots]
  );

  const afternoonSlots = useMemo(
    () => availableSlots.filter((slot) => timeToMinutes(slot) >= 12 * 60),
    [availableSlots]
  );

  const activePeriod =
    selectedPeriod === 'morning' &&
    morningSlots.length === 0 &&
    afternoonSlots.length > 0
      ? 'afternoon'
      : selectedPeriod === 'afternoon' &&
          afternoonSlots.length === 0 &&
          morningSlots.length > 0
        ? 'morning'
        : selectedPeriod;

  const displayedSlots =
    activePeriod === 'morning' ? morningSlots : afternoonSlots;

  const effectiveTime = availableSlots.includes(selectedTime)
    ? selectedTime
    : displayedSlots[0] ?? availableSlots[0] ?? '';

  const computedEndTime = useMemo(() => {
    if (!effectiveTime || !activeService) return '';
    return minutesToTime(
      timeToMinutes(effectiveTime) + activeService.durationMinutes
    );
  }, [effectiveTime, activeService]);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BookingContactFormInput>({
    resolver: zodResolver(bookingContactFormSchema),
    mode: 'onBlur',
    defaultValues: {
      fullName: '',
      phone: '',
      email: '',
      notes: '',
    },
  });

  const watchedFullName = useWatch({ control, name: 'fullName' });
  const watchedNotes = useWatch({ control, name: 'notes' }) ?? '';

  const formattedSummaryDate = useMemo(() => {
    if (!selectedDate) return '';
    const [year, month, day] = selectedDate.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: SYSTEM_TIMEZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  }, [selectedDate]);

  const formatReceiptDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return dateStr;
    const d = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: SYSTEM_TIMEZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  };

  const handleContinueStep = () => {
    setSubmitError(null);
    if (step === 1) {
      if (!activeService) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!effectiveTime) {
        setSlotError('Selecciona una hora disponible para continuar.');
        return;
      }
      setSlotError('');
      setStep(3);
    }
  };

  const onConfirmSubmit = async (data: BookingContactFormInput) => {
    if (!activeService || !selectedDate || !effectiveTime) {
      setSlotError('Selecciona fecha y hora válidas.');
      setStep(2);
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/citas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: activeService.id,
          barberId: selectedBarberId,
          date: selectedDate,
          startTime: effectiveTime,
          fullName: data.fullName,
          phone: data.phone,
          email: data.email,
          notes: data.notes,
        }),
      });

      const payload = (await response.json()) as {
        summary?: PublicBookingSummary;
        error?: string;
        code?: string;
      };

      if (!response.ok || !payload.summary) {
        setSubmitError({
          message:
            payload.error ??
            'No fue posible confirmar tu cita en este momento.',
          code: payload.code,
        });
        return;
      }

      setConfirmedSummary(payload.summary);
      setAvailabilityRefreshNonce((n) => n + 1);
    } catch {
      setSubmitError({
        message:
          'No pudimos conectarnos con el servidor. Verifica tu conexión e intenta nuevamente.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setConfirmedSummary(null);
    setSubmitError(null);
    setStep(1);
    setSlotError('');
    setAvailabilityRefreshNonce((n) => n + 1);
    reset();
  };

  const handleCopyBookingCode = async () => {
    if (!confirmedSummary) return;
    try {
      await navigator.clipboard.writeText(confirmedSummary.bookingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignorar si el navegador bloquea el portapapeles
    }
  };

  const barberDisplayName = activeBarber
    ? activeBarber.name
    : 'Primer disponible';

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Barra superior de 3 zonas */}
      <header className="sticky top-0 z-40 border-b border-stone-800 bg-stone-950/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex items-center shrink-0">
            {mode === 'manage' || step === 1 || confirmedSummary ? (
              <Link
                href="/"
                className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap text-sm font-medium text-stone-300 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>Atrás</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSubmitError(null);
                  setStep((prev) => (prev === 3 ? 2 : 1));
                }}
                className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap text-sm font-medium text-stone-300 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>Atrás</span>
              </button>
            )}
          </div>

          <Link
            href="/"
            className="flex items-center gap-2 whitespace-nowrap shrink-0 font-[var(--font-playfair)] text-lg font-semibold tracking-tight text-white"
          >
            <Scissors className="h-4 w-4 text-amber-500" aria-hidden="true" />
            <span>{config.name}</span>
          </Link>

          <nav
            aria-label="Pasos de reserva"
            className="hidden items-center gap-3 text-xs font-medium sm:flex shrink-0"
          >
            {mode === 'book' ? (
              [
                { num: 1 as const, label: 'Servicios' },
                { num: 2 as const, label: 'Detalles' },
                { num: 3 as const, label: 'Confirmar' },
              ].map((item, idx) => {
                const isCurrent = !confirmedSummary && step === item.num;
                const isDone = confirmedSummary ? true : step > item.num;
                return (
                  <div key={item.num} className="flex items-center gap-3">
                    {idx > 0 && (
                      <span
                        className="h-px w-5 bg-stone-700"
                        aria-hidden="true"
                      />
                    )}
                    <button
                      type="button"
                      disabled={Boolean(confirmedSummary) || item.num > step}
                      onClick={() => {
                        if (!confirmedSummary && item.num < step) {
                          setSubmitError(null);
                          setStep(item.num);
                        }
                      }}
                      className={`flex items-center gap-2 whitespace-nowrap transition-colors ${
                        isCurrent
                          ? 'text-white'
                          : isDone
                            ? 'text-stone-300 hover:text-white'
                            : 'cursor-default text-stone-500'
                      }`}
                    >
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-semibold tabular-nums ${
                          isCurrent || isDone
                            ? 'bg-amber-600 text-white'
                            : 'bg-stone-800 text-stone-400'
                        }`}
                      >
                        {isDone && !isCurrent ? (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          item.num
                        )}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  </div>
                );
              })
            ) : (
              <span className="text-stone-400">Gestión de reserva</span>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 lg:py-10">
        {/* Selector de modo: Agendar nueva cita / Gestionar reserva */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div
            role="tablist"
            aria-label="Modo de reservas"
            className="inline-flex rounded-xl border border-stone-800 bg-stone-900 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'book'}
              onClick={() => {
                setMode('book');
                setManageInitialSummary(null);
              }}
              className={`min-h-[40px] whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                mode === 'book'
                  ? 'bg-amber-600 text-white'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              Agendar nueva cita
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'manage'}
              onClick={() => setMode('manage')}
              className={`min-h-[40px] whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                mode === 'manage'
                  ? 'bg-amber-600 text-white'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              Consultar o cancelar cita
            </button>
          </div>
        </div>

        {mode === 'manage' ? (
          <ManageBookingPanel
            key={manageInitialSummary?.id ?? 'lookup'}
            catalog={catalog}
            initialSummary={manageInitialSummary}
            onClearInitialSummary={() => setManageInitialSummary(null)}
            onSwitchToBook={() => {
              setManageInitialSummary(null);
              setMode('book');
              handleReset();
            }}
          />
        ) : confirmedSummary ? (
          <div className="mx-auto max-w-3xl rounded-2xl border border-stone-800 bg-stone-900 p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <CheckCircle2
                className="mt-1 h-7 w-7 shrink-0 text-emerald-500"
                aria-hidden="true"
              />
              <div className="w-full">
                <p className="text-xs font-medium text-emerald-400">
                  Reserva registrada y bloqueada en agenda
                </p>
                <h1 className="mt-1 font-[var(--font-playfair)] text-2xl font-semibold text-white sm:text-3xl">
                  ¡Cita confirmada en {config.name}!
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-stone-400">
                  Reservación confirmada para{' '}
                  <span className="font-medium text-stone-200">
                    {confirmedSummary.clientName}
                  </span>
                  . Guarda tu código de reserva por si necesitas reprogramar o
                  cancelar tu turno.
                </p>

                {/* Código de reserva destacado */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-stone-950 px-5 py-4">
                  <div>
                    <p className="text-xs text-stone-400">
                      Código de confirmación
                    </p>
                    <p className="mt-0.5 font-mono text-xl font-bold tracking-wider text-amber-400 tabular-nums">
                      {confirmedSummary.bookingCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyBookingCode}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-stone-700 bg-stone-900 px-3.5 py-2 text-xs font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white"
                  >
                    {copiedCode ? (
                      <>
                        <Check
                          className="h-3.5 w-3.5 text-emerald-400"
                          aria-hidden="true"
                        />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Copiar código</span>
                      </>
                    )}
                  </button>
                </div>

                <dl className="mt-5 grid gap-4 rounded-xl border border-stone-800 bg-stone-950 p-6 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-stone-500">Servicio</dt>
                    <dd className="mt-1 text-sm font-semibold text-white">
                      {confirmedSummary.serviceName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-stone-500">Valor y duración</dt>
                    <dd className="mt-1 font-mono text-sm font-semibold text-white tabular-nums">
                      {formatCurrencyCOP(confirmedSummary.priceCop)} ·{' '}
                      {confirmedSummary.durationMinutes} min
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-stone-500">Barbero asignado</dt>
                    <dd className="mt-1 text-sm font-semibold text-white">
                      {confirmedSummary.barberName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-stone-500">Fecha y horario</dt>
                    <dd className="mt-1 text-sm font-medium capitalize text-stone-200">
                      {formatReceiptDate(confirmedSummary.date)} ·{' '}
                      <span className="font-mono tabular-nums">
                        {formatTime12h(confirmedSummary.startTime)} –{' '}
                        {formatTime12h(confirmedSummary.endTime)}
                      </span>
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-stone-500">Contacto</dt>
                    <dd className="mt-1 text-sm text-stone-300">
                      {confirmedSummary.clientPhone} ·{' '}
                      {confirmedSummary.clientEmail}
                    </dd>
                  </div>
                  {confirmedSummary.notes && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-stone-500">
                        Notas enviadas al barbero
                      </dt>
                      <dd className="mt-1 text-sm text-stone-300">
                        {confirmedSummary.notes}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="min-h-[44px] rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500"
                  >
                    Agendar otra cita
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setManageInitialSummary(confirmedSummary);
                      setMode('manage');
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-700 px-5 py-2.5 text-xs font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white"
                  >
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                    <span>Reprogramar o cancelar</span>
                  </button>
                  <Link
                    href="/"
                    className="inline-flex min-h-[44px] items-center rounded-xl border border-stone-800 px-5 py-2.5 text-xs font-medium text-stone-300 transition-colors hover:border-stone-600 hover:text-white"
                  >
                    Volver al inicio
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
            {/* COLUMNA IZQUIERDA (8 cols): Contenido según el paso activo */}
            <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 sm:p-8 lg:col-span-8">
              {step === 1 && (
                <div>
                  <p className="text-xs font-medium text-amber-500">
                    Paso 1 de 3
                  </p>
                  <h1 className="mt-1 font-[var(--font-playfair)] text-2xl font-semibold text-white sm:text-3xl">
                    Selecciona tu servicio
                  </h1>
                  <p className="mt-2 text-sm text-stone-400">
                    Elige el tratamiento que deseas reservar para ver los
                    horarios disponibles.
                  </p>

                  <div className="mt-6 space-y-3">
                    {services.map((service) => {
                      const isSelected = service.id === selectedServiceId;
                      return (
                        <button
                          key={service.id}
                          type="button"
                          onClick={() => {
                            setSelectedServiceId(service.id);
                            setStep(2);
                          }}
                          className={`flex w-full items-center justify-between gap-4 rounded-xl border p-5 text-left transition-colors ${
                            isSelected
                              ? 'border-amber-600 bg-stone-950 ring-1 ring-amber-600'
                              : 'border-stone-800 bg-stone-950/60 hover:border-stone-600'
                          }`}
                        >
                          <div>
                            <h2 className="text-base font-semibold text-white">
                              {service.name}
                            </h2>
                            <p className="mt-1 text-sm text-stone-400">
                              {service.description}
                            </p>
                          </div>

                          <div className="shrink-0 text-right">
                            <p className="font-mono text-base font-semibold text-white tabular-nums">
                              {formatCurrencyCOP(service.priceCop)}
                            </p>
                            <p className="mt-0.5 font-mono text-xs text-stone-400 tabular-nums">
                              {service.durationMinutes} min
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 2 && activeService && (
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h1 className="text-base font-bold uppercase tracking-wide text-white sm:text-lg">
                        {activeService.name}
                      </h1>
                      <p className="mt-1 font-mono text-xs text-stone-400 tabular-nums">
                        {activeService.durationMinutes} min ·{' '}
                        <span className="uppercase">{barberDisplayName}</span> ·{' '}
                        {formatCurrencyCOP(activeService.priceCop)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      aria-label="Cambiar servicio"
                      title="Cambiar servicio"
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-800 text-red-400 transition-colors hover:border-red-900/60 hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Selector de colaborador */}
                  <div className="relative mt-5">
                    <p className="text-xs font-medium text-stone-400">
                      Colaborador seleccionado:
                    </p>
                    <button
                      type="button"
                      onClick={() => setBarberMenuOpen((prev) => !prev)}
                      aria-expanded={barberMenuOpen}
                      className="mt-2 inline-flex min-h-[46px] items-center gap-3 rounded-full border border-stone-700 bg-stone-950 py-1.5 pl-2 pr-4 text-left transition-colors hover:border-stone-500"
                    >
                      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-800">
                        {activeBarber?.photoUrl ? (
                          <Image
                            src={activeBarber.photoUrl}
                            alt={activeBarber.name}
                            fill
                            sizes="32px"
                            referrerPolicy="no-referrer"
                            className="object-cover"
                          />
                        ) : (
                          <User
                            className="h-4 w-4 text-amber-500"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wide text-white">
                        {barberDisplayName}
                      </span>
                      <ChevronDown
                        className="h-4 w-4 text-stone-400"
                        aria-hidden="true"
                      />
                    </button>

                    {barberMenuOpen && (
                      <div className="absolute left-0 z-20 mt-2 w-full max-w-xs rounded-xl border border-stone-700 bg-stone-950 p-1.5 shadow-xl">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBarberId('any');
                            setBarberMenuOpen(false);
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${
                            selectedBarberId === 'any'
                              ? 'bg-stone-800 font-semibold text-white'
                              : 'text-stone-300 hover:bg-stone-900'
                          }`}
                        >
                          <User
                            className="h-4 w-4 shrink-0 text-amber-500"
                            aria-hidden="true"
                          />
                          <span>Primer barbero disponible</span>
                        </button>

                        {barbers.map((barber) => (
                          <button
                            key={barber.id}
                            type="button"
                            onClick={() => {
                              setSelectedBarberId(barber.id);
                              setBarberMenuOpen(false);
                            }}
                            className={`mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${
                              selectedBarberId === barber.id
                                ? 'bg-stone-800 font-semibold text-white'
                                : 'text-stone-300 hover:bg-stone-900'
                            }`}
                          >
                            <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full bg-stone-800">
                              {barber.photoUrl && (
                                <Image
                                  src={barber.photoUrl}
                                  alt={barber.name}
                                  fill
                                  sizes="24px"
                                  referrerPolicy="no-referrer"
                                  className="object-cover"
                                />
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-white">
                                {barber.name}
                              </p>
                              <p className="truncate text-[11px] text-stone-400">
                                {barber.specialty}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Tarjeta interna: Horarios disponibles */}
                  <div className="mt-6 rounded-xl border border-stone-800 bg-stone-950/70 p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-white">
                        Horarios disponibles
                      </h2>
                      <span className="text-xs capitalize text-stone-400">
                        {selectedDateMeta?.fullLabel}
                      </span>
                    </div>

                    {/* Carrusel horizontal de días con flechas */}
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={datePageIndex === 0}
                        onClick={() =>
                          setDatePageIndex((prev) => Math.max(0, prev - 1))
                        }
                        aria-label="Días anteriores"
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-700 bg-stone-900 text-stone-300 transition-colors hover:border-stone-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </button>

                      <div className="grid flex-1 grid-cols-4 gap-2 sm:grid-cols-7">
                        {visibleDates.map((d) => {
                          const isSelected = d.date === selectedDate;
                          return (
                            <button
                              key={d.date}
                              type="button"
                              disabled={!d.isOpen}
                              onClick={() => {
                                setSelectedDate(d.date);
                                setSelectedTime('');
                                setSlotError('');
                              }}
                              className={`flex min-h-[68px] flex-col items-center justify-center rounded-xl border px-2 py-2 transition-colors ${
                                !d.isOpen
                                  ? 'cursor-not-allowed border-stone-800/80 bg-stone-900/40 text-stone-600'
                                  : isSelected
                                    ? 'border-amber-500 bg-amber-600 text-white'
                                    : 'border-stone-800 bg-stone-900 text-stone-200 hover:border-stone-600'
                              }`}
                            >
                              <span className="text-[11px] font-medium uppercase opacity-80">
                                {d.dayShort}
                              </span>
                              <span className="mt-1 font-mono text-base font-bold tabular-nums">
                                {d.dayNumber}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        disabled={datePageIndex >= maxDatePage}
                        onClick={() =>
                          setDatePageIndex((prev) =>
                            Math.min(maxDatePage, prev + 1)
                          )
                        }
                        aria-label="Siguientes días"
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-700 bg-stone-900 text-stone-300 transition-colors hover:border-stone-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="mt-6 border-t border-stone-800 pt-5">
                      <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-stone-800 bg-stone-900 p-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPeriod('morning');
                            if (morningSlots.length > 0) {
                              setSelectedTime(morningSlots[0]);
                            }
                          }}
                          className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                            activePeriod === 'morning'
                              ? 'bg-amber-600 text-white'
                              : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                          }`}
                        >
                          <Sun className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>Mañana</span>
                          <span
                            className={`font-mono text-xs tabular-nums ${
                              activePeriod === 'morning'
                                ? 'text-amber-100'
                                : 'text-stone-500'
                            }`}
                          >
                            {morningSlots.length}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPeriod('afternoon');
                            if (afternoonSlots.length > 0) {
                              setSelectedTime(afternoonSlots[0]);
                            }
                          }}
                          className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                            activePeriod === 'afternoon'
                              ? 'bg-amber-600 text-white'
                              : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                          }`}
                        >
                          <SunMedium
                            className="h-4 w-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Tarde</span>
                          <span
                            className={`font-mono text-xs tabular-nums ${
                              activePeriod === 'afternoon'
                                ? 'text-amber-100'
                                : 'text-stone-500'
                            }`}
                          >
                            {afternoonSlots.length}
                          </span>
                        </button>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-stone-200">
                          {displayedSlots.length} Horarios disponibles:{' '}
                          {activePeriod === 'morning' ? 'Mañana' : 'Tarde'}
                        </p>
                        <span className="font-mono text-xs text-stone-400 tabular-nums">
                          Duración {activeService.durationMinutes} min
                        </span>
                      </div>

                      {displayedSlots.length === 0 ? (
                        <p className="mt-4 rounded-xl border border-stone-800 bg-stone-900/60 px-4 py-4 text-center text-sm text-stone-400">
                          Sin horas para reservar en esta jornada. Selecciona la
                          otra pestaña o cambia el día.
                        </p>
                      ) : (
                        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
                          {displayedSlots.map((slot) => {
                            const isChosen = slot === effectiveTime;
                            return (
                              <button
                                key={slot}
                                type="button"
                                onClick={() => {
                                  setSelectedTime(slot);
                                  setSlotError('');
                                }}
                                className={`min-h-[44px] whitespace-nowrap rounded-xl border px-2 py-2 font-mono text-xs font-semibold tabular-nums transition-colors ${
                                  isChosen
                                    ? 'border-amber-500 bg-amber-600 text-white'
                                    : 'border-stone-800 bg-stone-900 text-stone-200 hover:border-stone-600 hover:text-white'
                                }`}
                              >
                                {formatTime12h(slot)}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {slotError && (
                        <p className="mt-3 text-xs font-medium text-red-400">
                          {slotError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && activeService && (
                <form
                  id="booking-contact-form"
                  onSubmit={handleSubmit(onConfirmSubmit)}
                  noValidate
                >
                  <p className="text-xs font-medium text-amber-500">
                    Paso 3 de 3
                  </p>
                  <h1 className="mt-1 font-[var(--font-playfair)] text-2xl font-semibold text-white sm:text-3xl">
                    Tus datos para confirmar
                  </h1>
                  <p className="mt-2 text-sm text-stone-400">
                    No necesitas crear cuenta. Agendaremos tu turno para el{' '}
                    <span className="capitalize text-stone-200">
                      {selectedDateMeta?.fullLabel}
                    </span>{' '}
                    a las{' '}
                    <span className="font-mono text-stone-200 tabular-nums">
                      {formatTime12h(effectiveTime)}
                    </span>
                    .
                  </p>

                  {submitError && (
                    <div
                      role="alert"
                      className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-xs text-red-200"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertCircle
                          className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                          aria-hidden="true"
                        />
                        <div className="space-y-2">
                          <p>{submitError.message}</p>
                          {submitError.code === 'SLOT_CONFLICT' && (
                            <button
                              type="button"
                              onClick={() => {
                                setSubmitError(null);
                                setSelectedTime('');
                                setAvailabilityRefreshNonce((n) => n + 1);
                                setStep(2);
                              }}
                              className="inline-flex min-h-[36px] items-center rounded-lg bg-red-900/60 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
                            >
                              Ver otros horarios disponibles
                            </button>
                          )}
                          {submitError.code === 'MISSING_ADMIN_CREDENTIALS' && (
                            <Link
                              href="/login"
                              className="inline-flex min-h-[36px] items-center rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-200 transition-colors hover:text-white"
                            >
                              Iniciar sesión como administrador
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-6 space-y-5">
                    <div>
                      <label
                        htmlFor="fullName"
                        className="block text-xs font-medium text-stone-300"
                      >
                        Nombre completo
                      </label>
                      <input
                        id="fullName"
                        type="text"
                        autoComplete="name"
                        disabled={isSubmitting}
                        placeholder="Ej. Camilo Andrés Torres"
                        {...register('fullName')}
                        className="mt-2 min-h-[46px] w-full rounded-xl border border-stone-700 bg-stone-950 px-4 py-3 text-sm text-white placeholder:text-stone-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60"
                      />
                      {errors.fullName && (
                        <p className="mt-1.5 text-xs text-red-400">
                          {errors.fullName.message}
                        </p>
                      )}
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="phone"
                          className="block text-xs font-medium text-stone-300"
                        >
                          Teléfono / WhatsApp
                        </label>
                        <input
                          id="phone"
                          type="tel"
                          autoComplete="tel"
                          disabled={isSubmitting}
                          placeholder="Ej. 310 458 9210"
                          {...register('phone')}
                          className="mt-2 min-h-[46px] w-full rounded-xl border border-stone-700 bg-stone-950 px-4 py-3 text-sm text-white placeholder:text-stone-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60"
                        />
                        {errors.phone && (
                          <p className="mt-1.5 text-xs text-red-400">
                            {errors.phone.message}
                          </p>
                        )}
                      </div>

                      <div>
                        <label
                          htmlFor="email"
                          className="block text-xs font-medium text-stone-300"
                        >
                          Correo electrónico
                        </label>
                        <input
                          id="email"
                          type="email"
                          autoComplete="email"
                          disabled={isSubmitting}
                          placeholder="tu@correo.com"
                          {...register('email')}
                          className="mt-2 min-h-[46px] w-full rounded-xl border border-stone-700 bg-stone-950 px-4 py-3 text-sm text-white placeholder:text-stone-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60"
                        />
                        {errors.email && (
                          <p className="mt-1.5 text-xs text-red-400">
                            {errors.email.message}
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="notes"
                          className="block text-xs font-medium text-stone-300"
                        >
                          Notas o indicaciones (opcional)
                        </label>
                        <span className="font-mono text-[11px] text-stone-500 tabular-nums">
                          {watchedNotes.length}/500
                        </span>
                      </div>
                      <textarea
                        id="notes"
                        rows={3}
                        maxLength={500}
                        disabled={isSubmitting}
                        placeholder="Ej. Degradado bajo con tijera arriba, o consulta sobre diseño de barba."
                        {...register('notes')}
                        className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-950 px-4 py-3 text-sm text-white placeholder:text-stone-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60"
                      />
                      {errors.notes && (
                        <p className="mt-1.5 text-xs text-red-400">
                          {errors.notes.message}
                        </p>
                      )}
                    </div>
                  </div>
                </form>
              )}
            </div>

            {/* COLUMNA DERECHA (4 cols): Tarjeta Resumen fija */}
            <aside className="rounded-2xl border border-stone-800 bg-stone-900 p-6 lg:sticky lg:top-24 lg:col-span-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">Resumen</h2>
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-stone-700 bg-stone-950 px-2.5 py-1.5 text-xs text-stone-300">
                  <Calendar
                    className="h-3.5 w-3.5 text-stone-400"
                    aria-hidden="true"
                  />
                  <span className="tabular-nums">
                    {formattedSummaryDate || 'Sin fecha'}
                  </span>
                </div>
              </div>

              {activeService ? (
                <div className="mt-5 rounded-xl border border-stone-800 bg-stone-950/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-600/20 text-amber-500">
                        <Scissors className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-white">
                          {activeService.name}
                        </p>
                        <p className="mt-1 text-xs text-stone-400">
                          Colaborador:{' '}
                          <span className="uppercase text-stone-200">
                            {barberDisplayName}
                          </span>
                        </p>
                        <div className="mt-2 flex items-center gap-2 font-mono text-xs text-stone-400 tabular-nums">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{activeService.durationMinutes} min</span>
                          {effectiveTime && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-stone-200">
                                {formatTime12h(effectiveTime)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setSubmitError(null);
                        setStep(1);
                      }}
                      aria-label="Cambiar servicio"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-800 text-red-400 transition-colors hover:border-red-900/60 hover:bg-red-950/40 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-3 flex justify-end border-t border-stone-800/80 pt-3">
                    <span className="font-mono text-sm font-semibold text-white tabular-nums">
                      {formatCurrencyCOP(activeService.priceCop)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-stone-800 bg-stone-950/60 p-4 text-xs text-stone-400">
                  Selecciona un servicio para ver el detalle.
                </div>
              )}

              {step === 3 && watchedFullName?.trim() && (
                <div className="mt-3 rounded-xl border border-stone-800 bg-stone-950/60 px-4 py-3 text-xs text-stone-300">
                  Cliente:{' '}
                  <span className="font-medium text-white">
                    {watchedFullName}
                  </span>
                </div>
              )}

              <div className="mt-6 flex items-baseline justify-between border-t border-stone-800 pt-4">
                <span className="text-sm font-medium text-stone-300">
                  Total de servicios
                </span>
                <span className="font-mono text-xl font-bold text-white tabular-nums">
                  {activeService
                    ? formatCurrencyCOP(activeService.priceCop)
                    : '$ 0'}
                </span>
              </div>

              {step === 3 ? (
                <button
                  type="submit"
                  form="booking-contact-form"
                  disabled={isSubmitting}
                  className="mt-5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      <span>Confirmando cita...</span>
                    </>
                  ) : (
                    <span>Confirmar cita</span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!activeService || (step === 2 && !effectiveTime)}
                  onClick={handleContinueStep}
                  className="mt-5 min-h-[46px] w-full rounded-xl bg-amber-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
                >
                  Continuar
                </button>
              )}

              <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-stone-500">
                <Lock className="h-3 w-3" aria-hidden="true" />
                <span>Reserva directa · Horario {SYSTEM_TIMEZONE}</span>
              </p>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
