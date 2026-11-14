'use client';

import { useState } from 'react';
import { Filter, Loader2, RefreshCw } from 'lucide-react';
import { APPOINTMENT_STATUS_LABELS } from '@/lib/constants/config';
import {
  parseJsonResponseSafe,
  translateErrorMessageEs,
} from '@/lib/utils/error-es';
import { formatCurrencyCOP, formatTime12h } from '@/lib/utils/timezone';
import type { AdminBarberRecord, AdminReportSummary } from '@/services/admin';
import { AppointmentStatus, type Appointment } from '@/types';

interface DashboardReportsClientProps {
  initialAppointments: Appointment[];
  initialSummary: AdminReportSummary;
  barbers: AdminBarberRecord[];
  todayBogota: string;
  totalActiveBarbers: number;
  totalActiveServices: number;
  totalClients: number;
}

export function DashboardReportsClient({
  initialAppointments,
  initialSummary,
  barbers,
  todayBogota,
  totalActiveBarbers,
  totalActiveServices,
  totalClients,
}: DashboardReportsClientProps) {
  const [appointments, setAppointments] =
    useState<Appointment[]>(initialAppointments);
  const [summary, setSummary] = useState<AdminReportSummary>(initialSummary);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [barberFilter, setBarberFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>('');

  const applyFilters = async (overrides?: {
    dateFrom?: string;
    dateTo?: string;
    barberId?: string;
    status?: string;
  }) => {
    setLoading(true);
    setFeedback('');
    try {
      const params = new URLSearchParams();
      const df = overrides?.dateFrom ?? dateFrom;
      const dt = overrides?.dateTo ?? dateTo;
      const bId = overrides?.barberId ?? barberFilter;
      const st = overrides?.status ?? statusFilter;

      if (df) params.set('dateFrom', df);
      if (dt) params.set('dateTo', dt);
      if (bId && bId !== 'all') params.set('barberId', bId);
      if (st && st !== 'all') params.set('status', st);

      const response = await fetch(`/api/admin/citas?${params.toString()}`, {
        credentials: 'include',
      });
      const data =
        (await parseJsonResponseSafe<{
          appointments?: Appointment[];
          summary?: AdminReportSummary;
          error?: string;
        }>(response)) ?? {};

      if (!response.ok || !data.appointments || !data.summary) {
        throw new Error(
          translateErrorMessageEs(data.error, 'Error al cargar el reporte.')
        );
      }

      setAppointments(data.appointments);
      setSummary(data.summary);
    } catch (err) {
      setFeedback(
        translateErrorMessageEs(err, 'No fue posible filtrar las citas.')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (
    appointmentId: string,
    newStatus: AppointmentStatus
  ) => {
    setUpdatingId(appointmentId);
    setFeedback('');
    try {
      const response = await fetch('/api/admin/citas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appointmentId, status: newStatus }),
      });
      const data =
        (await parseJsonResponseSafe<{ error?: string }>(response)) ?? {};
      if (!response.ok) {
        throw new Error(
          translateErrorMessageEs(data.error, 'No se pudo actualizar la cita.')
        );
      }
      await applyFilters();
    } catch (err) {
      setFeedback(
        translateErrorMessageEs(err, 'Error al actualizar el estado.')
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleResetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setBarberFilter('all');
    setStatusFilter('all');
    applyFilters({ dateFrom: '', dateTo: '', barberId: 'all', status: 'all' });
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-[var(--font-playfair)] text-3xl font-semibold text-stone-900 [text-wrap:balance]">
              Resumen operativo y reportes
            </h1>
            <p className="mt-1.5 text-sm text-stone-600">
              Hoy en Colombia: <span className="font-mono tabular-nums">{todayBogota}</span>{' '}
              · {totalActiveBarbers} barberos activos · {totalActiveServices} servicios ·{' '}
              {totalClients} clientes registrados
            </p>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => applyFilters()}
            className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Actualizar datos</span>
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500">Citas en rango</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-stone-900 tabular-nums">
              {summary.totalAppointments}
            </p>
            <p className="mt-1 text-xs text-stone-500 tabular-nums">
              {summary.confirmedCount} activas · {summary.cancelledOrNoShowCount} canceladas
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500">Citas finalizadas</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-stone-900 tabular-nums">
              {summary.completedCount}
            </p>
            <p className="mt-1 text-xs text-stone-500">Atenciones completadas</p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500">Ingresos cobrados</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-stone-900 tabular-nums">
              {formatCurrencyCOP(summary.completedRevenueCop)}
            </p>
            <p className="mt-1 text-xs text-stone-500">Servicios finalizados</p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500">Ingresos proyectados</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-amber-800 tabular-nums">
              {formatCurrencyCOP(summary.projectedRevenueCop)}
            </p>
            <p className="mt-1 text-xs text-stone-500">Confirmadas + finalizadas</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <Filter className="h-4 w-4 text-amber-700" aria-hidden="true" />
          <h2>Filtros de reporte y agenda</h2>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label
              htmlFor="rep-from"
              className="block text-xs font-medium text-stone-600"
            >
              Desde
            </label>
            <input
              id="rep-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="rep-to"
              className="block text-xs font-medium text-stone-600"
            >
              Hasta
            </label>
            <input
              id="rep-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="rep-barber"
              className="block text-xs font-medium text-stone-600"
            >
              Barbero
            </label>
            <select
              id="rep-barber"
              value={barberFilter}
              onChange={(e) => setBarberFilter(e.target.value)}
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
              htmlFor="rep-status"
              className="block text-xs font-medium text-stone-600"
            >
              Estado
            </label>
            <select
              id="rep-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
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

          <div className="flex items-end gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => applyFilters()}
              className="min-h-[40px] flex-1 whitespace-nowrap rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
            >
              Aplicar
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleResetFilters}
              className="min-h-[40px] whitespace-nowrap rounded-lg border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100"
            >
              Limpiar
            </button>
          </div>
        </div>

        {feedback && (
          <p className="mt-3 text-xs font-medium text-red-600">{feedback}</p>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-base font-semibold text-stone-900">
            Citas e ingresos por barbero
          </h2>
          {summary.byBarber.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">
              Aún no hay citas registradas en el rango seleccionado.
            </p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs font-medium text-stone-500">
                  <th className="py-2 pr-3">Barbero</th>
                  <th className="py-2 pr-3 text-right">Citas</th>
                  <th className="py-2 pr-3 text-right">Finalizadas</th>
                  <th className="py-2 text-right">Ingresos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {summary.byBarber.map((item) => (
                  <tr key={item.barberId} className="h-10">
                    <td className="py-2 pr-3 font-medium text-stone-900">
                      {item.barberName}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
                      {item.total}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
                      {item.completed}
                    </td>
                    <td className="py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {formatCurrencyCOP(item.revenueCop)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-base font-semibold text-stone-900">
            Servicios más solicitados
          </h2>
          {summary.byService.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">
              Sin movimiento de servicios en el rango seleccionado.
            </p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs font-medium text-stone-500">
                  <th className="py-2 pr-3">Servicio</th>
                  <th className="py-2 pr-3 text-right">Cantidad</th>
                  <th className="py-2 text-right">Total estimado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {summary.byService.map((item) => (
                  <tr key={item.serviceId} className="h-10">
                    <td className="py-2 pr-3 font-medium text-stone-900">
                      {item.serviceName}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
                      {item.total}
                    </td>
                    <td className="py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {formatCurrencyCOP(item.revenueCop)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-stone-900">
            Listado de citas ({appointments.length})
          </h2>
        </div>

        {appointments.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500">
            No se encontraron citas con los filtros actuales. Cuando los clientes
            reserven en /reservar (Etapa 6), aparecerán aquí en tiempo real.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs font-medium text-stone-500">
                  <th className="py-2.5 pr-4">Fecha</th>
                  <th className="py-2.5 pr-4">Hora</th>
                  <th className="py-2.5 pr-4">Cliente</th>
                  <th className="py-2.5 pr-4">Servicio</th>
                  <th className="py-2.5 pr-4">Barbero</th>
                  <th className="py-2.5 pr-4">Estado</th>
                  <th className="py-2.5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {appointments.map((appt) => (
                  <tr key={appt.id} className="h-12 hover:bg-stone-50">
                    <td className="py-2 pr-4 font-mono text-xs text-stone-700 tabular-nums">
                      {appt.date}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-stone-800 tabular-nums">
                      {formatTime12h(appt.startTime)}
                    </td>
                    <td className="py-2 pr-4">
                      <p className="font-medium text-stone-900">
                        {appt.clientName}
                      </p>
                      <p className="font-mono text-xs text-stone-500 tabular-nums">
                        {appt.clientPhone}
                      </p>
                    </td>
                    <td className="py-2 pr-4 text-stone-700">
                      {appt.serviceName}
                    </td>
                    <td className="py-2 pr-4 text-stone-700">
                      {appt.barberName}
                    </td>
                    <td className="py-2 pr-4">
                      <select
                        aria-label={`Estado de cita ${appt.clientName}`}
                        disabled={updatingId === appt.id}
                        value={appt.status}
                        onChange={(e) =>
                          handleStatusChange(
                            appt.id,
                            e.target.value as AppointmentStatus
                          )
                        }
                        className="min-h-[34px] rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 focus:border-amber-700 focus:outline-none disabled:opacity-50"
                      >
                        {Object.values(AppointmentStatus).map((st) => (
                          <option key={st} value={st}>
                            {APPOINTMENT_STATUS_LABELS[st]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 text-right font-mono text-xs font-semibold text-stone-900 tabular-nums">
                      {formatCurrencyCOP(appt.priceCop)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
