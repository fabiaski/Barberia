'use client';

import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarOff,
  CheckCircle2,
  Clock,
  Phone,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  APPOINTMENT_STATUS_LABELS,
  DAYS_OF_WEEK_ES,
} from '@/lib/constants/config';
import { formatCurrencyCOP, formatTime12h } from '@/lib/utils/timezone';
import type { BarberAgendaRange, BarberWorkspaceData } from '@/services/barbero';
import { AppointmentStatus, type DaySchedule } from '@/types';

interface BarberWorkspaceClientProps {
  initialData: BarberWorkspaceData;
  isAdminPreview: boolean;
}

type StatusFilter = 'all' | 'active' | 'completed' | 'closed';

const DAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const STATUS_DOT_STYLES: Record<AppointmentStatus, string> = {
  [AppointmentStatus.CONFIRMED]: 'bg-amber-600',
  [AppointmentStatus.IN_PROGRESS]: 'bg-sky-600',
  [AppointmentStatus.COMPLETED]: 'bg-emerald-600',
  [AppointmentStatus.CANCELLED]: 'bg-stone-400',
  [AppointmentStatus.NO_SHOW]: 'bg-rose-600',
};

const RANGE_OPTIONS: Array<{ value: BarberAgendaRange; label: string }> = [
  { value: 'day', label: 'Hoy / Día' },
  { value: 'week', label: 'Semana (7 días)' },
  { value: 'upcoming', label: 'Próximos 30 días' },
];

export function BarberWorkspaceClient({
  initialData,
  isAdminPreview,
}: BarberWorkspaceClientProps) {
  const [workspace, setWorkspace] = useState<BarberWorkspaceData>(initialData);
  const [scheduleDays, setScheduleDays] = useState<DaySchedule[]>(
    initialData.scheduleDays
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [loadingAgenda, setLoadingAgenda] = useState(false);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(
    null
  );
  const [confirmAction, setConfirmAction] = useState<{
    appointmentId: string;
    status: AppointmentStatus;
  } | null>(null);

  const [savingSchedule, setSavingSchedule] = useState(false);
  const [creatingBlock, setCreatingBlock] = useState(false);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);
  const [confirmDeleteBlockId, setConfirmDeleteBlockId] = useState<string | null>(
    null
  );

  // Formulario de bloqueo personal
  const [blockDate, setBlockDate] = useState(initialData.date);
  const [blockAllDay, setBlockAllDay] = useState(false);
  const [blockStartTime, setBlockStartTime] = useState('12:00');
  const [blockEndTime, setBlockEndTime] = useState('13:00');
  const [blockReason, setBlockReason] = useState('');

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const fetchWorkspace = async (nextParams?: {
    barberId?: string;
    date?: string;
    range?: BarberAgendaRange;
    syncSchedule?: boolean;
  }) => {
    const targetBarberId = nextParams?.barberId ?? workspace.barber.id;
    const targetDate = nextParams?.date ?? workspace.date;
    const targetRange = nextParams?.range ?? workspace.range;

    setLoadingAgenda(true);
    setConfirmAction(null);
    try {
      const qs = new URLSearchParams({
        date: targetDate,
        range: targetRange,
        ...(isAdminPreview ? { barberId: targetBarberId } : {}),
      });
      const res = await fetch(`/api/barbero/agenda?${qs.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const payload = (await res.json()) as BarberWorkspaceData & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || 'No se pudo cargar la agenda.');
      }
      setWorkspace(payload);
      if (nextParams?.syncSchedule) {
        setScheduleDays(payload.scheduleDays);
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'No fue posible actualizar la agenda.',
      });
    } finally {
      setLoadingAgenda(false);
    }
  };

  const handleAppointmentStatus = async (
    appointmentId: string,
    status: AppointmentStatus
  ) => {
    setUpdatingAppointmentId(appointmentId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/barbero/citas/${appointmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(
          payload.error || 'No se pudo actualizar el estado de la cita.'
        );
      }
      setConfirmAction(null);
      setFeedback({
        type: 'success',
        text: payload.message || 'Estado actualizado.',
      });
      await fetchWorkspace();
    } catch (error) {
      setFeedback({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Error al actualizar la cita.',
      });
    } finally {
      setUpdatingAppointmentId(null);
    }
  };

  const handleScheduleDayChange = (
    dayOfWeek: number,
    patch: Partial<DaySchedule>
  ) => {
    setScheduleDays((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
    );
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/barbero/horario', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId: isAdminPreview ? workspace.barber.id : undefined,
          days: scheduleDays,
        }),
      });
      const payload = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'No se pudo guardar el horario.');
      }
      setFeedback({
        type: 'success',
        text: payload.message || 'Horario guardado correctamente.',
      });
      await fetchWorkspace({ syncSchedule: true });
    } catch (error) {
      setFeedback({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'No fue posible guardar tu horario.',
      });
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleResetToGeneralSchedule = () => {
    setScheduleDays(workspace.generalDays);
    setFeedback({
      type: 'success',
      text: 'Se cargó el horario general del local en el editor. Presiona "Guardar mi horario" para aplicarlo.',
    });
  };

  const handleCreateBlock = async (e: FormEvent) => {
    e.preventDefault();
    setCreatingBlock(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/barbero/bloqueos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId: isAdminPreview ? workspace.barber.id : undefined,
          date: blockDate,
          allDay: blockAllDay,
          startTime: blockAllDay ? '' : blockStartTime,
          endTime: blockAllDay ? '' : blockEndTime,
          reason: blockReason,
        }),
      });
      const payload = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'No se pudo registrar el bloqueo.');
      }
      setBlockReason('');
      setFeedback({
        type: 'success',
        text: payload.message || 'Bloqueo personal agregado.',
      });
      await fetchWorkspace();
    } catch (error) {
      setFeedback({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Error al registrar el bloqueo personal.',
      });
    } finally {
      setCreatingBlock(false);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    setDeletingBlockId(blockId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/barbero/bloqueos/${blockId}`, {
        method: 'DELETE',
      });
      const payload = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'No se pudo eliminar el bloqueo.');
      }
      setConfirmDeleteBlockId(null);
      setFeedback({
        type: 'success',
        text: payload.message || 'Bloqueo eliminado.',
      });
      await fetchWorkspace();
    } catch (error) {
      setFeedback({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Error al eliminar el bloqueo.',
      });
    } finally {
      setDeletingBlockId(null);
    }
  };

  const filteredAppointments = workspace.appointments.filter((appt) => {
    if (statusFilter === 'active') {
      return (
        appt.status === AppointmentStatus.CONFIRMED ||
        appt.status === AppointmentStatus.IN_PROGRESS
      );
    }
    if (statusFilter === 'completed') {
      return appt.status === AppointmentStatus.COMPLETED;
    }
    if (statusFilter === 'closed') {
      return (
        appt.status === AppointmentStatus.CANCELLED ||
        appt.status === AppointmentStatus.NO_SHOW
      );
    }
    return true;
  });

  const isTerminal = (status: AppointmentStatus) =>
    status === AppointmentStatus.COMPLETED ||
    status === AppointmentStatus.CANCELLED ||
    status === AppointmentStatus.NO_SHOW;

  return (
    <div className="space-y-8">
      {/* Encabezado principal y selector de barbero para admin */}
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
            Zona de atención · America/Bogota
          </p>
          <h1 className="mt-1 font-[var(--font-playfair)] text-3xl font-semibold text-stone-900 [text-wrap:balance]">
            Agenda de {workspace.barber.name}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {workspace.barber.specialty} ·{' '}
            {workspace.range === 'day'
              ? `Día ${workspace.date}`
              : `Del ${workspace.date} al ${workspace.endDate}`}
          </p>
        </div>

        {isAdminPreview && workspace.availableBarbers.length > 0 && (
          <div className="w-full sm:w-64">
            <label
              htmlFor="admin-barber-switcher"
              className="block text-xs font-medium text-stone-600"
            >
              Inspeccionar agenda de
            </label>
            <select
              id="admin-barber-switcher"
              value={workspace.barber.id}
              onChange={(e) =>
                fetchWorkspace({
                  barberId: e.target.value,
                  syncSchedule: true,
                })
              }
              className="mt-1 min-h-[42px] w-full rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-900 focus:border-amber-700 focus:outline-none"
            >
              {workspace.availableBarbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.active ? '' : '(Inactivo)'}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Mensaje de confirmación / error */}
      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span className="flex-1">{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-medium underline underline-offset-2"
          >
            Ocultar
          </button>
        </div>
      )}

      {/* Métricas rápidas */}
      <section aria-label="Resumen de citas" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-xs font-medium text-stone-500">Citas en vista</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-stone-900 tabular-nums">
            {workspace.summary.total}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-xs font-medium text-stone-500">
            Pendientes / En curso
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {workspace.summary.pendingCount}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-xs font-medium text-stone-500">Finalizadas</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {workspace.summary.completedCount}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-xs font-medium text-stone-500">
            Ingresos finalizados
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold text-stone-900 tabular-nums">
            {formatCurrencyCOP(workspace.summary.completedRevenueCop)}
          </p>
        </div>
      </section>

      {/* Sección 1: Agenda interactiva */}
      <section
        id="agenda"
        className="rounded-xl border border-stone-200 bg-white p-5 sm:p-6"
      >
        <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
              <Calendar className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <span>Agenda de citas</span>
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Actualiza el estado conforme atiendes a cada cliente. Cancelar o
              marcar inasistencia libera el horario automáticamente.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {RANGE_OPTIONS.map((opt) => {
              const active = workspace.range === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={loadingAgenda}
                  onClick={() => fetchWorkspace({ range: opt.value })}
                  className={`min-h-[40px] rounded-lg border px-3.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}

            <input
              type="date"
              aria-label="Fecha de consulta"
              value={workspace.date}
              disabled={loadingAgenda || workspace.range === 'upcoming'}
              onChange={(e) => {
                if (e.target.value) {
                  fetchWorkspace({ date: e.target.value });
                }
              }}
              className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 font-mono text-xs text-stone-800 focus:border-amber-700 focus:outline-none disabled:opacity-50"
            />

            <button
              type="button"
              disabled={loadingAgenda}
              onClick={() => fetchWorkspace()}
              aria-label="Actualizar agenda"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingAgenda ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Actualizar</span>
            </button>
          </div>
        </div>

        {/* Filtro rápido por estado */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'all', label: `Todas (${workspace.appointments.length})` },
              {
                id: 'active',
                label: `Activas (${workspace.summary.pendingCount})`,
              },
              {
                id: 'completed',
                label: `Finalizadas (${workspace.summary.completedCount})`,
              },
              {
                id: 'closed',
                label: `Canceladas / No asistió (${workspace.summary.cancelledCount})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[36px] rounded-md px-3 text-xs font-medium transition-colors ${
                statusFilter === tab.id
                  ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-300'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filteredAppointments.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-stone-200 bg-stone-50/60 p-8 text-center">
            <p className="text-sm font-medium text-stone-700">
              No hay citas en este filtro para el período seleccionado.
            </p>
            <p className="mt-1 text-xs text-stone-500">
              Cambia el rango de fechas o selecciona &ldquo;Todas&rdquo; para ver
              más reservas.
            </p>
          </div>
        ) : (
          <>
            {/* Vista móvil por tarjetas */}
            <div className="mt-5 space-y-3 md:hidden">
              {filteredAppointments.map((appt) => {
                const busy = updatingAppointmentId === appt.id;
                const locked = isTerminal(appt.status);
                const pendingConfirm =
                  confirmAction?.appointmentId === appt.id ? confirmAction : null;

                return (
                  <article
                    key={appt.id}
                    className="rounded-xl border border-stone-200 bg-stone-50/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs font-semibold text-stone-900 tabular-nums">
                          {workspace.range !== 'day' ? `${appt.date} · ` : ''}
                          {formatTime12h(appt.startTime)} –{' '}
                          {formatTime12h(appt.endTime)}
                        </p>
                        <h3 className="mt-1 text-base font-semibold text-stone-900">
                          {appt.clientName}
                        </h3>
                        <p className="text-xs text-stone-600">
                          {appt.serviceName} ·{' '}
                          <span className="font-mono font-semibold text-stone-900 tabular-nums">
                            {formatCurrencyCOP(appt.priceCop)}
                          </span>
                        </p>
                      </div>

                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-800">
                        <span
                          className={`h-2 w-2 rounded-sm ${
                            STATUS_DOT_STYLES[appt.status] ?? 'bg-stone-400'
                          }`}
                          aria-hidden="true"
                        />
                        {APPOINTMENT_STATUS_LABELS[appt.status] ?? appt.status}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600">
                      <a
                        href={`tel:${appt.clientPhone}`}
                        className="inline-flex items-center gap-1 font-mono hover:text-stone-900"
                      >
                        <Phone className="h-3 w-3" aria-hidden="true" />
                        {appt.clientPhone}
                      </a>
                      {appt.bookingCode && (
                        <span className="font-mono text-stone-500">
                          Cód: {appt.bookingCode}
                        </span>
                      )}
                    </div>

                    {appt.notes && (
                      <p className="mt-2 rounded-md bg-white px-2.5 py-1.5 text-xs text-stone-600">
                        Nota: {appt.notes}
                      </p>
                    )}

                    {!locked && (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-200 pt-3">
                        {appt.status === AppointmentStatus.CONFIRMED && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              handleAppointmentStatus(
                                appt.id,
                                AppointmentStatus.IN_PROGRESS
                              )
                            }
                            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                          >
                            <Play className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Iniciar</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleAppointmentStatus(
                              appt.id,
                              AppointmentStatus.COMPLETED
                            )
                          }
                          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Finalizar</span>
                        </button>

                        {pendingConfirm ? (
                          <div className="flex w-full items-center gap-2 pt-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleAppointmentStatus(
                                  appt.id,
                                  pendingConfirm.status
                                )
                              }
                              className="min-h-[42px] flex-1 rounded-lg bg-rose-700 px-3 text-xs font-semibold text-white hover:bg-rose-800"
                            >
                              Confirmar{' '}
                              {APPOINTMENT_STATUS_LABELS[pendingConfirm.status]}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setConfirmAction(null)}
                              className="min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium text-stone-700"
                            >
                              Volver
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setConfirmAction({
                                  appointmentId: appt.id,
                                  status: AppointmentStatus.NO_SHOW,
                                })
                              }
                              className="min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium text-stone-700 hover:bg-stone-100"
                            >
                              No asistió
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setConfirmAction({
                                  appointmentId: appt.id,
                                  status: AppointmentStatus.CANCELLED,
                                })
                              }
                              className="min-h-[44px] rounded-lg border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700 hover:bg-rose-50"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {/* Vista escritorio en tabla */}
            <div className="mt-5 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs font-medium text-stone-500">
                    <th className="py-2.5 pr-4">Fecha y hora</th>
                    <th className="py-2.5 pr-4">Cliente</th>
                    <th className="py-2.5 pr-4">Servicio</th>
                    <th className="py-2.5 pr-4">Estado</th>
                    <th className="py-2.5 pr-4 text-right">Valor</th>
                    <th className="py-2.5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredAppointments.map((appt) => {
                    const busy = updatingAppointmentId === appt.id;
                    const locked = isTerminal(appt.status);
                    const pendingConfirm =
                      confirmAction?.appointmentId === appt.id
                        ? confirmAction
                        : null;

                    return (
                      <tr key={appt.id} className="align-top hover:bg-stone-50/70">
                        <td className="py-3 pr-4 font-mono text-xs text-stone-800 tabular-nums">
                          {workspace.range !== 'day' && (
                            <div className="font-semibold text-stone-900">
                              {appt.date}
                            </div>
                          )}
                          <div>
                            {formatTime12h(appt.startTime)} –{' '}
                            {formatTime12h(appt.endTime)}
                          </div>
                          {appt.bookingCode && (
                            <div className="mt-0.5 text-[11px] text-stone-400">
                              #{appt.bookingCode}
                            </div>
                          )}
                        </td>

                        <td className="py-3 pr-4">
                          <div className="font-medium text-stone-900">
                            {appt.clientName}
                          </div>
                          <div className="mt-0.5 font-mono text-xs text-stone-500 tabular-nums">
                            {appt.clientPhone}
                          </div>
                          {appt.notes && (
                            <p className="mt-1 max-w-xs text-xs text-stone-500">
                              {appt.notes}
                            </p>
                          )}
                        </td>

                        <td className="py-3 pr-4 text-stone-700">
                          <div>{appt.serviceName}</div>
                          <div className="font-mono text-xs text-stone-400 tabular-nums">
                            {appt.durationMinutes} min
                          </div>
                        </td>

                        <td className="py-3 pr-4">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-800">
                            <span
                              className={`h-2 w-2 rounded-sm ${
                                STATUS_DOT_STYLES[appt.status] ?? 'bg-stone-400'
                              }`}
                              aria-hidden="true"
                            />
                            {APPOINTMENT_STATUS_LABELS[appt.status] ?? appt.status}
                          </span>
                        </td>

                        <td className="py-3 pr-4 text-right font-mono text-xs font-semibold text-stone-900 tabular-nums">
                          {formatCurrencyCOP(appt.priceCop)}
                        </td>

                        <td className="py-3 text-right">
                          {locked ? (
                            <span className="text-xs text-stone-400">
                              Cerrada
                            </span>
                          ) : pendingConfirm ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  handleAppointmentStatus(
                                    appt.id,
                                    pendingConfirm.status
                                  )
                                }
                                className="min-h-[34px] rounded-md bg-rose-700 px-2.5 text-xs font-semibold text-white hover:bg-rose-800"
                              >
                                Confirmar{' '}
                                {pendingConfirm.status ===
                                AppointmentStatus.NO_SHOW
                                  ? 'No asistió'
                                  : 'cancelación'}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmAction(null)}
                                className="min-h-[34px] rounded-md border border-stone-300 bg-white px-2.5 text-xs text-stone-700 hover:bg-stone-50"
                              >
                                Volver
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              {appt.status === AppointmentStatus.CONFIRMED && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    handleAppointmentStatus(
                                      appt.id,
                                      AppointmentStatus.IN_PROGRESS
                                    )
                                  }
                                  className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                                >
                                  <Play className="h-3 w-3" aria-hidden="true" />
                                  <span>Iniciar</span>
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  handleAppointmentStatus(
                                    appt.id,
                                    AppointmentStatus.COMPLETED
                                  )
                                }
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-md bg-emerald-700 px-2.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                              >
                                <UserCheck
                                  className="h-3 w-3"
                                  aria-hidden="true"
                                />
                                <span>Finalizar</span>
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setConfirmAction({
                                    appointmentId: appt.id,
                                    status: AppointmentStatus.NO_SHOW,
                                  })
                                }
                                className="min-h-[34px] rounded-md border border-stone-300 bg-white px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                              >
                                No asistió
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setConfirmAction({
                                    appointmentId: appt.id,
                                    status: AppointmentStatus.CANCELLED,
                                  })
                                }
                                title="Cancelar cita"
                                className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              >
                                <XCircle
                                  className="h-3 w-3"
                                  aria-hidden="true"
                                />
                                <span>Cancelar</span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Sección 2: Horario semanal personal */}
      <section
        id="horario-personal"
        className="rounded-xl border border-stone-200 bg-white p-5 sm:p-6"
      >
        <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
              <Clock className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <span>Mi horario semanal de atención</span>
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Origen actual:{' '}
              <strong className="font-semibold text-stone-800">
                {workspace.hasCustomSchedule
                  ? 'Horario personalizado guardado'
                  : 'Horario general de la barbería (predeterminado)'}
              </strong>
              . Define tus horas de inicio, salida y descanso opcional por día.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={savingSchedule}
              onClick={handleResetToGeneralSchedule}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Copiar horario general</span>
            </button>

            <button
              type="button"
              disabled={savingSchedule}
              onClick={handleSaveSchedule}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-stone-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {savingSchedule ? 'Guardando...' : 'Guardar mi horario'}
              </span>
            </button>
          </div>
        </div>

        <div className="mt-5 divide-y divide-stone-100">
          {DAY_DISPLAY_ORDER.map((dayNum) => {
            const label =
              DAYS_OF_WEEK_ES.find((d) => d.value === dayNum)?.label ?? '';
            const day = scheduleDays.find((d) => d.dayOfWeek === dayNum) ?? {
              dayOfWeek: dayNum,
              isOpen: false,
              openTime: '08:00',
              closeTime: '20:00',
            };

            return (
              <div
                key={dayNum}
                className="grid gap-3 py-3.5 sm:grid-cols-[140px_130px_1fr] sm:items-center"
              >
                <div className="font-medium text-stone-900">{label}</div>

                <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 text-xs font-medium text-stone-700">
                  <input
                    type="checkbox"
                    checked={day.isOpen}
                    onChange={(e) =>
                      handleScheduleDayChange(dayNum, {
                        isOpen: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-700"
                  />
                  <span>{day.isOpen ? 'Disponible' : 'Día libre'}</span>
                </label>

                {day.isOpen ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="block text-[11px] text-stone-500">
                        Inicio
                      </label>
                      <input
                        type="time"
                        value={day.openTime}
                        onChange={(e) =>
                          handleScheduleDayChange(dayNum, {
                            openTime: e.target.value,
                          })
                        }
                        className="mt-0.5 min-h-[38px] w-full rounded-lg border border-stone-300 bg-white px-2.5 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-stone-500">
                        Salida
                      </label>
                      <input
                        type="time"
                        value={day.closeTime}
                        onChange={(e) =>
                          handleScheduleDayChange(dayNum, {
                            closeTime: e.target.value,
                          })
                        }
                        className="mt-0.5 min-h-[38px] w-full rounded-lg border border-stone-300 bg-white px-2.5 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-stone-500">
                        Pausa desde (opc.)
                      </label>
                      <input
                        type="time"
                        value={day.breakStart ?? ''}
                        onChange={(e) =>
                          handleScheduleDayChange(dayNum, {
                            breakStart: e.target.value || undefined,
                          })
                        }
                        className="mt-0.5 min-h-[38px] w-full rounded-lg border border-stone-300 bg-white px-2.5 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-stone-500">
                        Pausa hasta (opc.)
                      </label>
                      <input
                        type="time"
                        value={day.breakEnd ?? ''}
                        onChange={(e) =>
                          handleScheduleDayChange(dayNum, {
                            breakEnd: e.target.value || undefined,
                          })
                        }
                        className="mt-0.5 min-h-[38px] w-full rounded-lg border border-stone-300 bg-white px-2.5 font-mono text-xs text-stone-900 focus:border-amber-700 focus:outline-none"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">
                    No aparecerán turnos disponibles este día.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Sección 3: Bloqueos personales */}
      <section
        id="bloqueos-personales"
        className="rounded-xl border border-stone-200 bg-white p-5 sm:p-6"
      >
        <div className="border-b border-stone-200 pb-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
            <CalendarOff className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <span>Mis bloqueos personales</span>
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            Bloquea un día completo o un rango de horas específico (almuerzo,
            diligencias, permisos) para que el calendario público no ofrezca esos
            turnos.
          </p>
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          {/* Formulario de creación */}
          <form
            onSubmit={handleCreateBlock}
            className="space-y-4 rounded-xl border border-stone-200 bg-stone-50/50 p-4 sm:p-5"
          >
            <h3 className="text-sm font-semibold text-stone-900">
              Agregar nuevo bloqueo
            </h3>

            <div>
              <label
                htmlFor="block-date"
                className="block text-xs font-medium text-stone-700"
              >
                Fecha
              </label>
              <input
                id="block-date"
                type="date"
                required
                value={blockDate}
                onChange={(e) => setBlockDate(e.target.value)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-stone-300 bg-white px-3 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm font-medium text-stone-800">
              <input
                type="checkbox"
                checked={blockAllDay}
                onChange={(e) => setBlockAllDay(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-700"
              />
              <span>Bloquear todo el día</span>
            </label>

            {!blockAllDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="block-start"
                    className="block text-xs font-medium text-stone-700"
                  >
                    Hora inicio
                  </label>
                  <input
                    id="block-start"
                    type="time"
                    required
                    value={blockStartTime}
                    onChange={(e) => setBlockStartTime(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-stone-300 bg-white px-3 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="block-end"
                    className="block text-xs font-medium text-stone-700"
                  >
                    Hora fin
                  </label>
                  <input
                    id="block-end"
                    type="time"
                    required
                    value={blockEndTime}
                    onChange={(e) => setBlockEndTime(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-stone-300 bg-white px-3 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="block-reason"
                className="block text-xs font-medium text-stone-700"
              >
                Motivo del bloqueo
              </label>
              <input
                id="block-reason"
                type="text"
                required
                minLength={2}
                maxLength={240}
                placeholder="Ej. Almuerzo, cita médica o permiso personal"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={creatingBlock}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>
                {creatingBlock ? 'Guardando bloqueo...' : 'Agregar bloqueo'}
              </span>
            </button>
          </form>

          {/* Listado de bloqueos vigentes */}
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              Bloqueos vigentes ({workspace.blocks.length})
            </h3>
            {workspace.blocks.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-stone-200 p-6 text-center text-xs text-stone-500">
                No tienes bloqueos próximos registrados.
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-stone-200 rounded-xl border border-stone-200">
                {workspace.blocks.map((block) => {
                  const isGlobal = block.barberId === 'all';
                  const confirmingDelete = confirmDeleteBlockId === block.id;
                  const deleting = deletingBlockId === block.id;

                  return (
                    <li
                      key={block.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-stone-900 tabular-nums">
                            {block.date}
                          </span>
                          <span className="font-mono text-xs text-stone-600 tabular-nums">
                            {block.allDay
                              ? 'Todo el día'
                              : `${formatTime12h(block.startTime ?? '')} – ${formatTime12h(
                                  block.endTime ?? ''
                                )}`}
                          </span>
                          {isGlobal && (
                            <span className="text-[11px] font-medium text-amber-800">
                              · Cierre general del local
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-stone-700">
                          {block.reason}
                        </p>
                      </div>

                      {!isGlobal && (
                        <div className="shrink-0">
                          {confirmingDelete ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={deleting}
                                onClick={() => handleDeleteBlock(block.id)}
                                className="min-h-[36px] rounded-md bg-rose-700 px-3 text-xs font-semibold text-white hover:bg-rose-800"
                              >
                                {deleting ? 'Eliminando...' : 'Confirmar'}
                              </button>
                              <button
                                type="button"
                                disabled={deleting}
                                onClick={() => setConfirmDeleteBlockId(null)}
                                className="min-h-[36px] rounded-md border border-stone-300 bg-white px-3 text-xs text-stone-700"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteBlockId(block.id)}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium text-stone-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Eliminar</span>
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
