'use client';

import { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  User,
} from 'lucide-react';
import { APPOINTMENT_STATUS_LABELS } from '@/lib/constants/config';
import {
  buildMonthlyCalendarGrid,
  CALENDAR_WEEKDAYS_ES,
  formatFullDateEs,
  getBogotaYearMonth,
  getShortStatusLabelEs,
  groupAppointmentsByDate,
  shiftYearMonth,
  summarizeMonthAppointments,
} from '@/lib/utils/admin-calendar';
import {
  parseJsonResponseSafe,
  translateErrorMessageEs,
} from '@/lib/utils/error-es';
import { formatCurrencyCOP, formatTime12h } from '@/lib/utils/timezone';
import type { AdminBarberRecord } from '@/services/admin';
import { AppointmentStatus, type Appointment } from '@/types';

interface AdminMonthlyCalendarProps {
  initialAppointments: Appointment[];
  barbers: AdminBarberRecord[];
  todayBogota: string;
  embedded?: boolean;
  onAppointmentUpdated?: () => Promise<void> | void;
}

interface EmailNotificationFeedback {
  sent?: boolean;
  clientSent?: boolean;
  adminSent?: boolean;
  barberSent?: boolean;
}

function getPreviewClasses(status: AppointmentStatus, isFocused: boolean): string {
  const focusRing = isFocused ? 'ring-1 ring-amber-700' : '';
  switch (status) {
    case AppointmentStatus.CONFIRMED:
      return `border-amber-200 bg-amber-50/70 text-stone-900 hover:bg-amber-50 ${focusRing}`;
    case AppointmentStatus.IN_PROGRESS:
      return `border-sky-200 bg-sky-50/70 text-sky-950 hover:bg-sky-50 ${focusRing}`;
    case AppointmentStatus.COMPLETED:
      return `border-emerald-200 bg-emerald-50/70 text-emerald-950 hover:bg-emerald-50 ${focusRing}`;
    case AppointmentStatus.CANCELLED:
    case AppointmentStatus.NO_SHOW:
      return `border-stone-200 bg-stone-50 text-stone-500 line-through hover:bg-stone-100 ${focusRing}`;
    default:
      return `border-stone-200 bg-white text-stone-800 hover:bg-stone-50 ${focusRing}`;
  }
}

function getStatusTextClass(status: AppointmentStatus): string {
  switch (status) {
    case AppointmentStatus.CONFIRMED:
      return 'text-amber-800';
    case AppointmentStatus.IN_PROGRESS:
      return 'text-sky-800';
    case AppointmentStatus.COMPLETED:
      return 'text-emerald-800';
    case AppointmentStatus.CANCELLED:
      return 'text-red-700';
    case AppointmentStatus.NO_SHOW:
      return 'text-stone-500';
    default:
      return 'text-stone-700';
  }
}

function formatEmailNoticeSuffix(
  status: AppointmentStatus,
  emailNotification?: EmailNotificationFeedback
): string {
  if (!emailNotification) return '';
  const targets: string[] = [];
  if (emailNotification.clientSent) targets.push('cliente');
  if (emailNotification.adminSent) targets.push('administrador');
  if (emailNotification.barberSent) targets.push('barbero');
  if (targets.length === 0) return '';

  const label =
    status === AppointmentStatus.CANCELLED
      ? 'aviso de cancelación'
      : 'confirmación';
  return ` Se envió ${label} por correo a: ${targets.join(', ')}.`;
}

export function AdminMonthlyCalendar({
  initialAppointments,
  barbers,
  todayBogota,
  embedded = false,
  onAppointmentUpdated,
}: AdminMonthlyCalendarProps) {
  const initialYearMonth = getBogotaYearMonth(todayBogota);
  const [yearMonth, setYearMonth] = useState<string>(initialYearMonth);
  const [selectedDate, setSelectedDate] = useState<string>(todayBogota);
  const [focusedAppointmentId, setFocusedAppointmentId] = useState<string | null>(
    null
  );
  const [appointments, setAppointments] =
    useState<Appointment[]>(initialAppointments);
  const [barberFilter, setBarberFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [statusNotice, setStatusNotice] = useState<string>('');

  const grid = useMemo(
    () => buildMonthlyCalendarGrid(yearMonth, todayBogota),
    [yearMonth, todayBogota]
  );

  const fetchMonthAppointments = async (params?: {
    targetYearMonth?: string;
    barberId?: string;
    status?: string;
  }) => {
    const targetYm = params?.targetYearMonth ?? yearMonth;
    const targetGrid = buildMonthlyCalendarGrid(targetYm, todayBogota);
    const bId = params?.barberId ?? barberFilter;
    const st = params?.status ?? statusFilter;

    setLoading(true);
    setErrorMessage('');
    try {
      const searchParams = new URLSearchParams();
      searchParams.set('dateFrom', targetGrid.gridStartDate);
      searchParams.set('dateTo', targetGrid.gridEndDate);
      if (bId && bId !== 'all') searchParams.set('barberId', bId);
      if (st && st !== 'all') searchParams.set('status', st);

      const response = await fetch(
        `/api/admin/citas?${searchParams.toString()}`,
        {
          credentials: 'include',
        }
      );
      const data =
        (await parseJsonResponseSafe<{
          appointments?: Appointment[];
          error?: string;
        }>(response)) ?? {};

      if (!response.ok || !Array.isArray(data.appointments)) {
        throw new Error(
          translateErrorMessageEs(
            data.error,
            'No fue posible cargar las citas del mes.'
          )
        );
      }

      setAppointments(data.appointments);
    } catch (err) {
      setErrorMessage(
        translateErrorMessageEs(
          err,
          'No fue posible cargar el calendario mensual.'
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const filteredAppointments = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return appointments.filter((appt) => {
      if (barberFilter !== 'all' && appt.barberId !== barberFilter) return false;
      if (statusFilter !== 'all' && appt.status !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return (
        appt.clientName.toLowerCase().includes(normalizedSearch) ||
        appt.clientPhone.toLowerCase().includes(normalizedSearch) ||
        appt.clientEmail.toLowerCase().includes(normalizedSearch) ||
        appt.serviceName.toLowerCase().includes(normalizedSearch) ||
        appt.barberName.toLowerCase().includes(normalizedSearch) ||
        (appt.bookingCode ?? '').toLowerCase().includes(normalizedSearch)
      );
    });
  }, [appointments, barberFilter, statusFilter, searchQuery]);

  const appointmentsByDate = useMemo(
    () => groupAppointmentsByDate(filteredAppointments),
    [filteredAppointments]
  );

  const monthSummary = useMemo(
    () => summarizeMonthAppointments(filteredAppointments, grid.yearMonth),
    [filteredAppointments, grid.yearMonth]
  );

  const selectedDayAppointments = useMemo(
    () => appointmentsByDate[selectedDate] ?? [],
    [appointmentsByDate, selectedDate]
  );

  const selectedDayActiveRevenue = useMemo(
    () =>
      selectedDayAppointments.reduce((acc, appt) => {
        if (
          appt.status === AppointmentStatus.CONFIRMED ||
          appt.status === AppointmentStatus.IN_PROGRESS ||
          appt.status === AppointmentStatus.COMPLETED
        ) {
          return acc + appt.priceCop;
        }
        return acc;
      }, 0),
    [selectedDayAppointments]
  );

  const handleNavigateMonth = (delta: number) => {
    const nextYm = shiftYearMonth(yearMonth, delta);
    const nextMonthDefaultDate =
      nextYm === initialYearMonth ? todayBogota : `${nextYm}-01`;
    setYearMonth(nextYm);
    setSelectedDate(nextMonthDefaultDate);
    setFocusedAppointmentId(null);
    void fetchMonthAppointments({ targetYearMonth: nextYm });
  };

  const handleJumpToday = () => {
    setYearMonth(initialYearMonth);
    setSelectedDate(todayBogota);
    setFocusedAppointmentId(null);
    void fetchMonthAppointments({ targetYearMonth: initialYearMonth });
  };

  const handleBarberChange = (nextBarber: string) => {
    setBarberFilter(nextBarber);
    void fetchMonthAppointments({ barberId: nextBarber });
  };

  const handleStatusFilterChange = (nextStatus: string) => {
    setStatusFilter(nextStatus);
    void fetchMonthAppointments({ status: nextStatus });
  };

  const handleResetFilters = () => {
    setBarberFilter('all');
    setStatusFilter('all');
    setSearchQuery('');
    void fetchMonthAppointments({ barberId: 'all', status: 'all' });
  };

  const handleStatusChange = async (
    appointmentId: string,
    newStatus: AppointmentStatus
  ) => {
    setUpdatingId(appointmentId);
    setErrorMessage('');
    setStatusNotice('');
    try {
      const response = await fetch('/api/admin/citas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appointmentId, status: newStatus }),
      });
      const data =
        (await parseJsonResponseSafe<{
          message?: string;
          error?: string;
          emailNotification?: EmailNotificationFeedback;
        }>(response)) ?? {};

      if (!response.ok) {
        throw new Error(
          translateErrorMessageEs(data.error, 'No se pudo actualizar la cita.')
        );
      }

      setAppointments((prev) =>
        prev.map((item) =>
          item.id === appointmentId ? { ...item, status: newStatus } : item
        )
      );
      await fetchMonthAppointments();
      await onAppointmentUpdated?.();

      const emailSuffix = formatEmailNoticeSuffix(
        newStatus,
        data.emailNotification
      );
      setStatusNotice(
        `${data.message || 'Estado de la cita actualizado correctamente.'}${emailSuffix}`
      );
    } catch (err) {
      setErrorMessage(
        translateErrorMessageEs(err, 'Error al actualizar el estado de la cita.')
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const hasActiveFilters =
    barberFilter !== 'all' ||
    statusFilter !== 'all' ||
    searchQuery.trim().length > 0;

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-[var(--font-playfair)] text-3xl font-semibold text-stone-900 [text-wrap:balance]">
              Calendario mensual de citas
            </h1>
            <p className="mt-1.5 text-sm text-stone-600">
              Agenda global de Barbería Estudio · Hoy:{' '}
              <span className="font-mono tabular-nums">{todayBogota}</span>
            </p>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => fetchMonthAppointments()}
            className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Actualizar agenda</span>
          </button>
        </div>
      )}

      {/* Resumen mensual de 4 métricas */}
      <div className="grid grid-cols-1 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-stone-500">
            Citas en {grid.titleEs}
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-stone-900 tabular-nums">
            {monthSummary.total}
          </p>
          <p className="mt-0.5 text-xs text-stone-500 tabular-nums">
            Vista según filtros aplicados
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-stone-500">Activas</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-amber-800 tabular-nums">
            {monthSummary.active}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            Confirmadas y en curso
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-stone-500">Finalizadas</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-emerald-800 tabular-nums">
            {monthSummary.completed}
          </p>
          <p className="mt-0.5 text-xs text-stone-500 tabular-nums">
            {monthSummary.cancelledOrNoShow} canceladas o ausencias
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-stone-500">
            Ingresos proyectados del mes
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold text-stone-900 tabular-nums">
            {formatCurrencyCOP(monthSummary.projectedRevenueCop)}
          </p>
          <p className="mt-0.5 text-xs text-stone-500 tabular-nums">
            Cobrados: {formatCurrencyCOP(monthSummary.completedRevenueCop)}
          </p>
        </div>
      </div>

      {/* Controles de mes y filtros */}
      <div className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleNavigateMonth(-1)}
              aria-label="Mes anterior"
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 transition-colors hover:bg-stone-100"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleJumpToday}
              className="inline-flex min-h-[40px] items-center whitespace-nowrap shrink-0 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-100"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => handleNavigateMonth(1)}
              aria-label="Mes siguiente"
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 transition-colors hover:bg-stone-100"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>

            <h2 className="ml-2 font-[var(--font-playfair)] text-xl font-semibold text-stone-900 sm:text-2xl">
              {grid.titleEs}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600">
            <span className="font-medium text-amber-800">Confirmada</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-sky-800">En curso</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-emerald-800">Finalizada</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-stone-500 line-through">
              Cancelada
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label
              htmlFor="cal-barber"
              className="block text-xs font-medium text-stone-600"
            >
              Barbero
            </label>
            <select
              id="cal-barber"
              value={barberFilter}
              onChange={(e) => handleBarberChange(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            >
              <option value="all">Todos los barberos</option>
              {barbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="cal-status"
              className="block text-xs font-medium text-stone-600"
            >
              Estado
            </label>
            <select
              id="cal-status"
              value={statusFilter}
              onChange={(e) => handleStatusFilterChange(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            >
              <option value="all">Todos los estados</option>
              {Object.values(AppointmentStatus).map((st) => (
                <option key={st} value={st}>
                  {APPOINTMENT_STATUS_LABELS[st]}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <label
              htmlFor="cal-search"
              className="block text-xs font-medium text-stone-600"
            >
              Buscar cliente o código
            </label>
            <div className="relative mt-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400"
                aria-hidden="true"
              />
              <input
                id="cal-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nombre, teléfono o BE-..."
                className="min-h-[40px] w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => fetchMonthAppointments()}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Actualizar</span>
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                disabled={loading}
                onClick={handleResetFilters}
                className="min-h-[40px] whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => fetchMonthAppointments()}
              className="font-semibold underline hover:text-red-900"
            >
              Reintentar
            </button>
          </div>
        )}
        {statusNotice && (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            {statusNotice}
          </p>
        )}
      </div>

      {/* Grilla mensual + Inspector del día seleccionado */}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section
          aria-label={`Grilla mensual de ${grid.titleEs}`}
          className="overflow-hidden rounded-xl border border-stone-200 bg-white"
        >
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-7 border-b border-stone-200 bg-stone-50">
                {CALENDAR_WEEKDAYS_ES.map((day) => (
                  <div
                    key={day}
                    className="px-2.5 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-stone-500"
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 divide-x divide-y divide-stone-200">
                {grid.cells.map((cell) => {
                  const dayAppts = appointmentsByDate[cell.date] ?? [];
                  const isSelected = selectedDate === cell.date;
                  const visibleAppts = dayAppts.slice(0, 3);
                  const hiddenCount = dayAppts.length - visibleAppts.length;

                  return (
                    <div
                      key={cell.date}
                      role="button"
                      tabIndex={0}
                      aria-label={`${cell.date}, ${dayAppts.length} citas`}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedDate(cell.date);
                        setFocusedAppointmentId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedDate(cell.date);
                          setFocusedAppointmentId(null);
                        }
                      }}
                      className={`min-h-[120px] cursor-pointer p-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-amber-700 ${
                        isSelected
                          ? 'bg-amber-50/40 ring-1 ring-inset ring-amber-700'
                          : cell.inCurrentMonth
                            ? 'bg-white hover:bg-stone-50'
                            : 'bg-stone-50/70 text-stone-400 hover:bg-stone-100/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-mono text-xs font-semibold tabular-nums ${
                              cell.isToday
                                ? 'text-amber-800 underline decoration-2 underline-offset-4'
                                : cell.inCurrentMonth
                                  ? 'text-stone-900'
                                  : 'text-stone-400'
                            }`}
                          >
                            {cell.dayNumber}
                          </span>
                          {cell.isToday && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                              Hoy
                            </span>
                          )}
                        </div>

                        {dayAppts.length > 0 && (
                          <span className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
                            {dayAppts.length}
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 space-y-1">
                        {visibleAppts.map((appt) => (
                          <button
                            key={appt.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDate(cell.date);
                              setFocusedAppointmentId(appt.id);
                            }}
                            className={`block w-full truncate rounded border px-1.5 py-1 text-left text-[11px] leading-tight transition-colors ${getPreviewClasses(
                              appt.status,
                              focusedAppointmentId === appt.id
                            )}`}
                            title={`${appt.startTime} · ${appt.clientName} · ${appt.serviceName} (${getShortStatusLabelEs(appt.status)})`}
                          >
                            <span className="font-mono font-semibold tabular-nums">
                              {appt.startTime}
                            </span>{' '}
                            <span className="text-stone-400" aria-hidden="true">
                              ·
                            </span>{' '}
                            <span className="font-medium">{appt.clientName}</span>
                          </button>
                        ))}

                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDate(cell.date);
                              setFocusedAppointmentId(null);
                            }}
                            className="w-full px-1 py-0.5 text-left font-mono text-[11px] font-semibold text-amber-800 hover:underline tabular-nums"
                          >
                            +{hiddenCount} más
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {monthSummary.total === 0 && !loading && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-5 py-4 text-xs text-stone-600">
              <span>
                No hay citas programadas en {grid.titleEs}
                {hasActiveFilters ? ' con los filtros actuales.' : '.'}
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="font-semibold text-amber-800 hover:underline"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
        </section>

        {/* Inspector lateral de agenda del día */}
        <aside
          aria-label="Detalle del día seleccionado"
          className="rounded-xl border border-stone-200 bg-white p-5"
        >
          <div className="border-b border-stone-200 pb-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Agenda del día</span>
            </div>
            <h3 className="mt-1 font-[var(--font-playfair)] text-lg font-semibold capitalize text-stone-900">
              {formatFullDateEs(selectedDate)}
            </h3>
            <p className="mt-1 font-mono text-xs text-stone-500 tabular-nums">
              {selectedDate} · {selectedDayAppointments.length}{' '}
              {selectedDayAppointments.length === 1 ? 'cita' : 'citas'} ·{' '}
              {formatCurrencyCOP(selectedDayActiveRevenue)}
            </p>
          </div>

          {selectedDayAppointments.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-stone-700">
                Sin citas para este día
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Selecciona otra fecha en el calendario mensual o ajusta los
                filtros de barbero y estado.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-200">
              {selectedDayAppointments.map((appt) => {
                const isFocused = focusedAppointmentId === appt.id;
                return (
                  <li
                    key={appt.id}
                    className={`py-4 transition-colors ${
                      isFocused ? '-mx-2 rounded-lg bg-amber-50/40 px-2' : ''
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-mono text-xs font-semibold text-stone-900 tabular-nums">
                        {formatTime12h(appt.startTime)} –{' '}
                        {formatTime12h(appt.endTime)}
                      </p>
                      <p className="font-mono text-xs font-semibold text-stone-900 tabular-nums">
                        {formatCurrencyCOP(appt.priceCop)}
                      </p>
                    </div>

                    <div className="mt-1.5 flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-stone-900">
                        {appt.clientName}
                      </p>
                      {appt.bookingCode && (
                        <span className="font-mono text-[11px] font-medium text-stone-500 tabular-nums">
                          {appt.bookingCode}
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-xs text-stone-700">
                      {appt.serviceName}{' '}
                      <span className="text-stone-400" aria-hidden="true">
                        ·
                      </span>{' '}
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3 text-stone-400" aria-hidden="true" />
                        {appt.barberName}
                      </span>
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                      {appt.clientPhone && (
                        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                          <Phone className="h-3 w-3" aria-hidden="true" />
                          {appt.clientPhone}
                        </span>
                      )}
                      {appt.clientEmail && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{appt.clientEmail}</span>
                        </span>
                      )}
                    </div>

                    {appt.notes && (
                      <p className="mt-1.5 text-xs italic text-stone-600">
                        Nota: {appt.notes}
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span
                        className={`text-xs font-semibold ${getStatusTextClass(
                          appt.status
                        )}`}
                      >
                        {APPOINTMENT_STATUS_LABELS[appt.status]}
                      </span>

                      <select
                        aria-label={`Cambiar estado de ${appt.clientName} a las ${appt.startTime}`}
                        disabled={updatingId === appt.id}
                        value={appt.status}
                        onChange={(e) =>
                          handleStatusChange(
                            appt.id,
                            e.target.value as AppointmentStatus
                          )
                        }
                        className="min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 focus:border-amber-700 focus:outline-none disabled:opacity-50"
                      >
                        {Object.values(AppointmentStatus).map((st) => (
                          <option key={st} value={st}>
                            {APPOINTMENT_STATUS_LABELS[st]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
