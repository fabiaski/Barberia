'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  Search,
  Scissors,
  User,
  XCircle,
} from 'lucide-react';
import {
  APPOINTMENT_STATUS_LABELS,
  SYSTEM_TIMEZONE,
} from '@/lib/constants/config';
import {
  generateScheduleTimeSlots,
  getUpcomingBookingDates,
} from '@/lib/utils/schedule-slots';
import {
  formatCurrencyCOP,
  formatTime12h,
} from '@/lib/utils/timezone';
import type { PublicBookingSummary } from '@/services/booking';
import type { PublicCatalogData } from '@/services/public-catalog';
import { AppointmentStatus } from '@/types';

interface ManageBookingPanelProps {
  catalog: PublicCatalogData;
  initialSummary?: PublicBookingSummary | null;
  onClearInitialSummary?: () => void;
  onSwitchToBook?: () => void;
}

export function ManageBookingPanel({
  catalog,
  initialSummary = null,
  onClearInitialSummary,
  onSwitchToBook,
}: ManageBookingPanelProps) {
  const { schedule, barbers, config } = catalog;

  const [bookingCode, setBookingCode] = useState(
    initialSummary?.bookingCode ?? ''
  );
  const [email, setEmail] = useState(initialSummary?.clientEmail ?? '');
  const [summary, setSummary] = useState<PublicBookingSummary | null>(
    initialSummary
  );

  const [lookupLoading, setLookupLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState(false);

  // Cancelación en dos pasos (sin window.confirm)
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Reprogramación
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const upcomingDates = useMemo(
    () => getUpcomingBookingDates(schedule.days, 21),
    [schedule.days]
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

  const [newBarberId, setNewBarberId] = useState(
    initialSummary?.barberId ?? barbers[0]?.id ?? 'any'
  );
  const [newDate, setNewDate] = useState(
    initialSummary?.date ??
      upcomingDates.find((d) => d.isOpen)?.date ??
      upcomingDates[0]?.date ??
      ''
  );
  const [newTime, setNewTime] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [liveSlots, setLiveSlots] = useState<{
    key: string;
    slots: string[];
  } | null>(null);

  const slotQueryKey = summary
    ? `${summary.id}|${newBarberId}|${newDate}|${summary.serviceId}|${refreshNonce}`
    : '';

  const isSlotsLoading =
    rescheduleOpen && Boolean(summary) && liveSlots?.key !== slotQueryKey;

  useEffect(() => {
    if (!rescheduleOpen || !summary || !newDate || !newBarberId) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      barberId: newBarberId,
      date: newDate,
      serviceId: summary.serviceId,
      excludeAppointmentId: summary.id,
    });

    fetch(`/api/disponibilidad?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { availableSlots?: string[] };
      })
      .then((data) => {
        setLiveSlots({
          key: slotQueryKey,
          slots: Array.isArray(data?.availableSlots) ? data.availableSlots : [],
        });
      })
      .catch(() => {
        setLiveSlots((prev) =>
          prev?.key === slotQueryKey ? prev : { key: slotQueryKey, slots: [] }
        );
      });

    return () => controller.abort();
  }, [rescheduleOpen, summary, newBarberId, newDate, slotQueryKey]);

  const fallbackSlots = useMemo(() => {
    if (!summary || !newDate) return [];
    const dateMeta = upcomingDates.find((d) => d.date === newDate);
    const dayObj = schedule.days.find((d) => d.dayOfWeek === dateMeta?.dayOfWeek);
    return generateScheduleTimeSlots({
      date: newDate,
      daySchedule: dayObj,
      durationMinutes: summary.durationMinutes,
      intervalMinutes: config.slotIntervalMinutes || 30,
    });
  }, [summary, newDate, upcomingDates, schedule.days, config.slotIntervalMinutes]);

  const availableSlots = useMemo(() => {
    if (liveSlots && liveSlots.key === slotQueryKey) {
      return liveSlots.slots;
    }
    return fallbackSlots;
  }, [liveSlots, slotQueryKey, fallbackSlots]);

  const effectiveNewTime = availableSlots.includes(newTime)
    ? newTime
    : availableSlots[0] ?? '';

  const formattedDateLabel = (dateStr: string) => {
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

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLookupLoading(true);

    try {
      const res = await fetch('/api/citas/gestionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'lookup',
          bookingCode: bookingCode.trim().toUpperCase(),
          email: email.trim().toLowerCase(),
        }),
      });

      const payload = (await res.json()) as {
        summary?: PublicBookingSummary;
        error?: string;
      };

      if (!res.ok || !payload.summary) {
        setErrorMsg(
          payload.error ?? 'No encontramos ninguna reserva con esos datos.'
        );
        return;
      }

      setSummary(payload.summary);
      setNewBarberId(payload.summary.barberId);
      setNewDate(payload.summary.date);
      setRescheduleOpen(false);
      setConfirmCancelOpen(false);
    } catch {
      setErrorMsg('No fue posible conectar con el servidor. Intenta de nuevo.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!summary) return;
    setErrorMsg('');
    setSuccessMsg('');
    setActionLoading(true);

    try {
      const res = await fetch('/api/citas/gestionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'cancel',
          manageToken: summary.manageToken,
        }),
      });

      const payload = (await res.json()) as {
        summary?: PublicBookingSummary;
        message?: string;
        error?: string;
      };

      if (!res.ok || !payload.summary) {
        setErrorMsg(payload.error ?? 'No fue posible cancelar la cita.');
        return;
      }

      setSummary(payload.summary);
      setConfirmCancelOpen(false);
      setRescheduleOpen(false);
      setSuccessMsg(
        payload.message ?? 'Tu cita fue cancelada y el horario quedó libre.'
      );
    } catch {
      setErrorMsg('Error de conexión al cancelar la cita.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReschedule = async () => {
    if (!summary || !newDate || !effectiveNewTime) {
      setErrorMsg('Selecciona una fecha y hora disponibles para reprogramar.');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setActionLoading(true);

    try {
      const res = await fetch('/api/citas/gestionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'reschedule',
          manageToken: summary.manageToken,
          date: newDate,
          startTime: effectiveNewTime,
          barberId: newBarberId,
        }),
      });

      const payload = (await res.json()) as {
        summary?: PublicBookingSummary;
        message?: string;
        error?: string;
        code?: string;
      };

      if (!res.ok || !payload.summary) {
        setErrorMsg(payload.error ?? 'No fue posible reprogramar la cita.');
        if (res.status === 409) {
          setRefreshNonce((n) => n + 1);
        }
        return;
      }

      setSummary(payload.summary);
      setRescheduleOpen(false);
      setSuccessMsg(
        payload.message ?? 'Tu cita fue reprogramada correctamente.'
      );
    } catch {
      setErrorMsg('Error de conexión al reprogramar la cita.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.bookingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignorar si el navegador bloquea el portapapeles
    }
  };

  const handleSearchAnother = () => {
    setSummary(null);
    setConfirmCancelOpen(false);
    setRescheduleOpen(false);
    setErrorMsg('');
    setSuccessMsg('');
    onClearInitialSummary?.();
  };

  if (!summary) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-stone-800 bg-stone-900 p-6 sm:p-8">
        <p className="text-xs font-medium text-amber-500">
          Autogestión de reservas
        </p>
        <h1 className="mt-1 font-[var(--font-playfair)] text-2xl font-semibold text-white sm:text-3xl">
          Consulta, reprograma o cancela tu cita
        </h1>
        <p className="mt-2 text-sm text-stone-400">
          Ingresa el código de confirmación que recibiste al agendar y el correo
          electrónico registrado.
        </p>

        <form onSubmit={handleLookup} className="mt-6 space-y-5" noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="manage-code"
                className="block text-xs font-medium text-stone-300"
              >
                Código de reserva
              </label>
              <input
                id="manage-code"
                type="text"
                required
                placeholder="Ej. BE-7K3M9Q"
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value.toUpperCase())}
                className="mt-2 min-h-[46px] w-full rounded-xl border border-stone-700 bg-stone-950 px-4 py-3 font-mono text-sm uppercase tracking-wider text-white placeholder:normal-case placeholder:tracking-normal placeholder:text-stone-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="manage-email"
                className="block text-xs font-medium text-stone-300"
              >
                Correo electrónico
              </label>
              <input
                id="manage-email"
                type="email"
                required
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 min-h-[46px] w-full rounded-xl border border-stone-700 bg-stone-950 px-4 py-3 text-sm text-white placeholder:text-stone-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-xs text-red-200"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                aria-hidden="true"
              />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={lookupLoading}
              className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {lookupLoading ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  <span>Buscando reserva...</span>
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span>Buscar reserva</span>
                </>
              )}
            </button>

            {onSwitchToBook && (
              <button
                type="button"
                onClick={onSwitchToBook}
                className="inline-flex min-h-[46px] items-center rounded-xl border border-stone-700 px-5 py-3 text-xs font-medium text-stone-300 transition-colors hover:border-stone-500 hover:text-white"
              >
                Agendar nueva cita
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  const isCancelled = summary.status === AppointmentStatus.CANCELLED;
  const isCompleted = summary.status === AppointmentStatus.COMPLETED;

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-stone-800 bg-stone-900 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium">
            {isCancelled ? (
              <>
                <XCircle className="h-4 w-4 text-red-400" aria-hidden="true" />
                <span className="text-red-400">
                  Estado: {APPOINTMENT_STATUS_LABELS[summary.status]}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2
                  className="h-4 w-4 text-emerald-400"
                  aria-hidden="true"
                />
                <span className="text-emerald-400">
                  Estado: {APPOINTMENT_STATUS_LABELS[summary.status]}
                </span>
              </>
            )}
          </div>

          <h1 className="mt-1.5 font-[var(--font-playfair)] text-2xl font-semibold text-white sm:text-3xl">
            Detalle de tu reserva
          </h1>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-stone-700 bg-stone-950 px-3.5 py-2">
          <span className="text-xs text-stone-400">Código</span>
          <span className="font-mono text-sm font-bold tracking-wider text-amber-400 tabular-nums">
            {summary.bookingCode}
          </span>
          <button
            type="button"
            onClick={handleCopyCode}
            aria-label="Copiar código de reserva"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-800 hover:text-white"
          >
            {copiedCode ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {successMsg && (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-4 text-xs text-emerald-200"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
            aria-hidden="true"
          />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-xs text-red-200"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
            aria-hidden="true"
          />
          <span>{errorMsg}</span>
        </div>
      )}

      <dl className="mt-6 grid gap-4 rounded-xl border border-stone-800 bg-stone-950 p-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-stone-500">Servicio</dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
            <Scissors className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            <span>{summary.serviceName}</span>
          </dd>
        </div>

        <div>
          <dt className="text-xs text-stone-500">Valor y duración</dt>
          <dd className="mt-1 font-mono text-sm font-semibold text-white tabular-nums">
            {formatCurrencyCOP(summary.priceCop)} · {summary.durationMinutes}{' '}
            min
          </dd>
        </div>

        <div>
          <dt className="text-xs text-stone-500">Barbero asignado</dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
            <User className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            <span>{summary.barberName}</span>
          </dd>
        </div>

        <div>
          <dt className="text-xs text-stone-500">Fecha y horario</dt>
          <dd className="mt-1 text-sm font-medium capitalize text-stone-200">
            {formattedDateLabel(summary.date)} ·{' '}
            <span className="font-mono tabular-nums">
              {formatTime12h(summary.startTime)} –{' '}
              {formatTime12h(summary.endTime)}
            </span>
          </dd>
        </div>

        <div className="sm:col-span-2">
          <dt className="text-xs text-stone-500">Cliente</dt>
          <dd className="mt-1 text-sm text-stone-300">
            {summary.clientName} · {summary.clientPhone} · {summary.clientEmail}
          </dd>
        </div>

        {summary.notes && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-stone-500">Notas registradas</dt>
            <dd className="mt-1 text-sm text-stone-300">{summary.notes}</dd>
          </div>
        )}
      </dl>

      {summary.canModify && (
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => {
              setRescheduleOpen((prev) => !prev);
              setConfirmCancelOpen(false);
              setErrorMsg('');
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-60"
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            <span>
              {rescheduleOpen ? 'Ocultar reprogramación' : 'Reprogramar horario'}
            </span>
          </button>

          <button
            type="button"
            disabled={actionLoading}
            onClick={() => {
              setConfirmCancelOpen((prev) => !prev);
              setRescheduleOpen(false);
              setErrorMsg('');
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-red-900/70 bg-red-950/30 px-5 py-2.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-950/60 disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <span>Cancelar cita</span>
          </button>
        </div>
      )}

      {!summary.canModify && !isCancelled && !isCompleted && (
        <p className="mt-5 text-xs text-stone-400">
          Esta reserva ya no puede modificarse en línea porque el horario ya
          inició o cambió de estado.
        </p>
      )}

      {/* Confirmación inline de cancelación */}
      {confirmCancelOpen && summary.canModify && (
        <div className="mt-5 rounded-xl border border-red-900/60 bg-stone-950 p-5">
          <p className="text-sm font-semibold text-white">
            ¿Confirmas que deseas cancelar esta cita?
          </p>
          <p className="mt-1 text-xs text-stone-400">
            El horario quedará liberado de inmediato para otros clientes.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={actionLoading}
              onClick={handleCancel}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
            >
              {actionLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Cancelando...</span>
                </>
              ) : (
                <span>Sí, cancelar cita</span>
              )}
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => setConfirmCancelOpen(false)}
              className="min-h-[44px] rounded-lg border border-stone-700 px-4 py-2 text-xs font-medium text-stone-300 transition-colors hover:border-stone-500 hover:text-white"
            >
              Mantener reserva
            </button>
          </div>
        </div>
      )}

      {/* Reprogramación inline */}
      {rescheduleOpen && summary.canModify && (
        <div className="mt-6 rounded-xl border border-stone-800 bg-stone-950 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">
              Elige nueva fecha y horario
            </h2>

            <select
              aria-label="Barbero para reprogramación"
              value={newBarberId}
              onChange={(e) => {
                setNewBarberId(e.target.value);
                setNewTime('');
              }}
              className="min-h-[40px] rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="any">Primer barbero disponible</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de fecha */}
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={datePageIndex === 0}
              onClick={() => setDatePageIndex((p) => Math.max(0, p - 1))}
              aria-label="Días anteriores"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-700 bg-stone-900 text-stone-300 hover:border-stone-500 disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="grid flex-1 grid-cols-4 gap-2 sm:grid-cols-7">
              {visibleDates.map((d) => {
                const isSelected = d.date === newDate;
                return (
                  <button
                    key={d.date}
                    type="button"
                    disabled={!d.isOpen}
                    onClick={() => {
                      setNewDate(d.date);
                      setNewTime('');
                    }}
                    className={`flex min-h-[60px] flex-col items-center justify-center rounded-xl border px-2 py-2 transition-colors ${
                      !d.isOpen
                        ? 'cursor-not-allowed border-stone-800/80 bg-stone-900/40 text-stone-600'
                        : isSelected
                          ? 'border-amber-500 bg-amber-600 text-white'
                          : 'border-stone-800 bg-stone-900 text-stone-200 hover:border-stone-600'
                    }`}
                  >
                    <span className="text-[11px] uppercase opacity-80">
                      {d.dayShort}
                    </span>
                    <span className="mt-0.5 font-mono text-sm font-bold tabular-nums">
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
                setDatePageIndex((p) => Math.min(maxDatePage, p + 1))
              }
              aria-label="Siguientes días"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-700 bg-stone-900 text-stone-300 hover:border-stone-500 disabled:opacity-35"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Horas disponibles */}
          <div className="mt-5 border-t border-stone-800 pt-4">
            <div className="flex items-center justify-between text-xs text-stone-400">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="capitalize">{formattedDateLabel(newDate)}</span>
              </span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {summary.durationMinutes} min
              </span>
            </div>

            {isSlotsLoading ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-stone-400">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                <span>Consultando horarios disponibles...</span>
              </div>
            ) : availableSlots.length === 0 ? (
              <p className="mt-4 rounded-xl border border-stone-800 bg-stone-900/60 px-4 py-3 text-xs text-stone-400">
                No quedan horarios disponibles para esta fecha. Prueba otro día.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {availableSlots.map((slot) => {
                  const chosen = slot === effectiveNewTime;
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setNewTime(slot)}
                      className={`min-h-[44px] rounded-xl border px-2 py-2 font-mono text-xs font-semibold tabular-nums transition-colors ${
                        chosen
                          ? 'border-amber-500 bg-amber-600 text-white'
                          : 'border-stone-800 bg-stone-900 text-stone-200 hover:border-stone-600'
                      }`}
                    >
                      {formatTime12h(slot)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={actionLoading || !effectiveNewTime}
                onClick={handleReschedule}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Guardando cambio...</span>
                  </>
                ) : (
                  <span>Confirmar nuevo horario</span>
                )}
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setRescheduleOpen(false)}
                className="min-h-[44px] rounded-xl border border-stone-700 px-4 py-2.5 text-xs font-medium text-stone-300 transition-colors hover:border-stone-500 hover:text-white"
              >
                Cancelar edición
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-stone-800 pt-5">
        <button
          type="button"
          onClick={handleSearchAnother}
          className="min-h-[44px] rounded-xl border border-stone-700 px-4 py-2.5 text-xs font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white"
        >
          Consultar otra reserva
        </button>

        {onSwitchToBook && (
          <button
            type="button"
            onClick={onSwitchToBook}
            className="min-h-[44px] rounded-xl border border-stone-700 px-4 py-2.5 text-xs font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white"
          >
            Agendar una nueva cita
          </button>
        )}
      </div>
    </div>
  );
}
