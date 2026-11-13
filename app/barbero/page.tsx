import { getServerSession } from '@/lib/auth/session';
import {
  APPOINTMENT_STATUS_LABELS,
  DAYS_OF_WEEK_ES,
} from '@/lib/constants/config';
import {
  getServerIdToken,
  serverGetDoc,
  serverQueryCollection,
} from '@/lib/firestore-server';
import {
  formatCurrencyCOP,
  formatTime12h,
  getBogotaDateString,
} from '@/lib/utils/timezone';
import { AppointmentStatus, UserRole, type DaySchedule } from '@/types';

export const dynamic = 'force-dynamic';

export default async function BarberoPage() {
  const [session, idToken] = await Promise.all([
    getServerSession(),
    getServerIdToken(),
  ]);
  const todayBogota = getBogotaDateString(new Date());

  const targetBarberId = session?.barberId ?? 'jose';
  const isBarberUser = session?.role === UserRole.BARBER && Boolean(session?.uid);

  const [barberSnap, appointmentsDocs, barberScheduleSnap, generalScheduleSnap] =
    await Promise.all([
      serverGetDoc('barberos', targetBarberId, idToken),
      serverQueryCollection(
        'citas',
        {
          filters: isBarberUser
            ? [
                { field: 'barberUid', op: '==', value: session!.uid },
                { field: 'date', op: '==', value: todayBogota },
              ]
            : [
                { field: 'barberId', op: '==', value: targetBarberId },
                { field: 'date', op: '==', value: todayBogota },
              ],
        },
        idToken
      ),
      serverGetDoc('horarios', targetBarberId, idToken).catch(() => ({
        id: targetBarberId,
        exists: false,
        data: undefined,
      })),
      serverGetDoc('horarios', 'general', idToken),
    ]);

  const barberData = barberSnap.data;
  const barberName = String(
    barberData?.name ?? session?.displayName ?? 'Barbero'
  );

  const todayAppointments = appointmentsDocs
    .map((doc) => {
      const d = doc.data ?? {};
      return {
        id: doc.id,
        clientName: String(d.clientName ?? ''),
        clientPhone: String(d.clientPhone ?? ''),
        serviceName: String(d.serviceName ?? ''),
        startTime: String(d.startTime ?? ''),
        endTime: String(d.endTime ?? ''),
        priceCop: Number(d.priceCop ?? 0),
        status: String(
          d.status ?? AppointmentStatus.CONFIRMED
        ) as AppointmentStatus,
      };
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const scheduleSource = barberScheduleSnap.exists
    ? barberScheduleSnap.data
    : generalScheduleSnap.data;
  const days = Array.isArray(scheduleSource?.days)
    ? (scheduleSource.days as DaySchedule[])
    : [];

  return (
    <div className="space-y-8">
      <section id="agenda">
        <h1 className="font-[var(--font-playfair)] text-3xl font-semibold text-stone-900 [text-wrap:balance]">
          Agenda de {barberName}
        </h1>
        <p className="mt-1.5 text-sm text-stone-600">
          Hoy ({todayBogota}) · Zona horaria America/Bogota.
        </p>

        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-stone-900">
              Citas asignadas para hoy
            </h2>
            <span className="font-mono text-xs text-stone-600 tabular-nums">
              {todayAppointments.length} citas
            </span>
          </div>

          {todayAppointments.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">
              No tienes citas programadas para hoy por el momento.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs font-medium text-stone-500">
                    <th className="py-2.5 pr-4">Horario</th>
                    <th className="py-2.5 pr-4">Cliente</th>
                    <th className="py-2.5 pr-4">Teléfono</th>
                    <th className="py-2.5 pr-4">Servicio</th>
                    <th className="py-2.5 pr-4">Estado</th>
                    <th className="py-2.5 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {todayAppointments.map((appt) => (
                    <tr key={appt.id} className="h-11 hover:bg-stone-50">
                      <td className="py-2 pr-4 font-mono text-xs text-stone-800 tabular-nums">
                        {formatTime12h(appt.startTime)} –{' '}
                        {formatTime12h(appt.endTime)}
                      </td>
                      <td className="py-2 pr-4 font-medium text-stone-900">
                        {appt.clientName}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-stone-600 tabular-nums">
                        {appt.clientPhone}
                      </td>
                      <td className="py-2 pr-4 text-stone-600">
                        {appt.serviceName}
                      </td>
                      <td className="py-2 pr-4 text-xs text-stone-700">
                        {APPOINTMENT_STATUS_LABELS[appt.status] ?? appt.status}
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
        </div>
      </section>

      <section
        id="horario-personal"
        className="rounded-xl border border-stone-200 bg-white p-6"
      >
        <h2 className="text-base font-semibold text-stone-900">
          Horario vigente de atención
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          En la Etapa 7 podrás ajustar desde aquí tus horas de inicio/salida
          por día y crear bloqueos personales.
        </p>

        <dl className="mt-4 divide-y divide-stone-100">
          {[1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
            const label =
              DAYS_OF_WEEK_ES.find((d) => d.value === dayNum)?.label ?? '';
            const day = days.find((d) => d.dayOfWeek === dayNum);
            return (
              <div
                key={dayNum}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <dt className="font-medium text-stone-800">{label}</dt>
                <dd className="font-mono text-xs text-stone-600 tabular-nums">
                  {day?.isOpen
                    ? `${formatTime12h(day.openTime)} – ${formatTime12h(day.closeTime)}`
                    : 'Cerrado'}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
    </div>
  );
}
