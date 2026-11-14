import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import type { SessionUser } from '@/lib/auth/session';
import {
  serverGetDoc,
  serverQueryCollection,
} from '@/lib/firestore-server';
import { getBogotaDateString } from '@/lib/utils/timezone';
import {
  AppointmentStatus,
  UserRole,
  type Appointment,
  type Barber,
  type DaySchedule,
  type ScheduleBlock,
} from '@/types';

const DEFAULT_DAYS: DaySchedule[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  isOpen: true,
  openTime: '08:00',
  closeTime: '20:00',
}));

export type BarberAgendaRange = 'day' | 'week' | 'upcoming';

export interface BarberWorkspaceSummary {
  total: number;
  pendingCount: number;
  completedCount: number;
  cancelledCount: number;
  completedRevenueCop: number;
}

export interface BarberWorkspaceData {
  barber: Barber;
  availableBarbers: Array<{ id: string; name: string; active: boolean }>;
  date: string;
  range: BarberAgendaRange;
  endDate: string;
  appointments: Appointment[];
  summary: BarberWorkspaceSummary;
  scheduleDays: DaySchedule[];
  generalDays: DaySchedule[];
  hasCustomSchedule: boolean;
  blocks: ScheduleBlock[];
}

function serializeTimestamp(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

function addDaysToDateStr(dateStr: string, daysToAdd: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + daysToAdd, 17, 0, 0));
  return getBogotaDateString(dt);
}

export async function resolveBarberForSession(
  session: SessionUser,
  requestedBarberId?: string,
  idToken?: string
): Promise<{
  barber: Barber;
  availableBarbers: Array<{ id: string; name: string; active: boolean }>;
}> {
  if (session.role === UserRole.BARBER) {
    let barberId = session.barberId;
    if (!barberId) {
      const byUidDocs = await serverQueryCollection(
        'barberos',
        { filters: [{ field: 'userId', op: '==', value: session.uid }], limit: 1 },
        idToken
      ).catch(() => []);
      barberId = byUidDocs[0]?.id;
    }

    if (barberId) {
      const snap = await serverGetDoc('barberos', barberId, idToken).catch(() => ({
        id: barberId,
        exists: false,
        data: undefined,
      }));
      if (snap.exists && snap.data) {
        const d = snap.data;
        const barber: Barber = {
          id: snap.id,
          userId: String(d.userId ?? session.uid),
          name: String(d.name ?? session.displayName),
          specialty: String(d.specialty ?? 'Barbero profesional'),
          bio: d.bio ? String(d.bio) : undefined,
          photoUrl: d.photoUrl ? String(d.photoUrl) : undefined,
          active: Boolean(d.active ?? true),
          createdAt: serializeTimestamp(d.createdAt),
          updatedAt: serializeTimestamp(d.updatedAt),
        };
        return {
          barber,
          availableBarbers: [
            { id: barber.id, name: barber.name, active: barber.active },
          ],
        };
      }
    }

    const fallback: Barber = {
      id: barberId || 'jose',
      userId: session.uid,
      name: session.displayName,
      specialty: 'Barbero del equipo',
      active: session.active,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return {
      barber: fallback,
      availableBarbers: [
        { id: fallback.id, name: fallback.name, active: fallback.active },
      ],
    };
  }

  // Admin: puede inspeccionar cualquier barbero
  const allBarbersDocs = await serverQueryCollection('barberos', {}, idToken).catch(
    () => []
  );

  const parsedBarbers: Barber[] = allBarbersDocs.map((doc) => {
    const d = doc.data ?? {};
    return {
      id: doc.id,
      userId: String(d.userId ?? ''),
      name: String(d.name ?? doc.id),
      specialty: String(d.specialty ?? ''),
      bio: d.bio ? String(d.bio) : undefined,
      photoUrl: d.photoUrl ? String(d.photoUrl) : undefined,
      active: Boolean(d.active ?? true),
      createdAt: serializeTimestamp(d.createdAt),
      updatedAt: serializeTimestamp(d.updatedAt),
    };
  });

  const selected =
    parsedBarbers.find((b) => b.id === requestedBarberId) ??
    parsedBarbers.find((b) => b.id === session.barberId) ??
    parsedBarbers.find((b) => b.active) ??
    parsedBarbers[0] ?? {
      id: 'jose',
      userId: 'barber_jose',
      name: 'José',
      specialty: 'Corte clásico y barba',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

  return {
    barber: selected,
    availableBarbers: parsedBarbers.map((b) => ({
      id: b.id,
      name: b.name,
      active: b.active,
    })),
  };
}

export async function getBarberWorkspaceData(params: {
  session: SessionUser;
  requestedBarberId?: string;
  date?: string;
  range?: BarberAgendaRange;
  idToken?: string;
}): Promise<BarberWorkspaceData> {
  const {
    session,
    requestedBarberId,
    date: rawDate,
    range = 'day',
    idToken,
  } = params;

  const todayBogota = getBogotaDateString(new Date());
  const date =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayBogota;

  const startDate = range === 'upcoming' ? todayBogota : date;
  const endDate =
    range === 'day'
      ? date
      : range === 'week'
        ? addDaysToDateStr(date, 6)
        : addDaysToDateStr(todayBogota, 30);

  const { barber, availableBarbers } = await resolveBarberForSession(
    session,
    requestedBarberId,
    idToken
  );

  const isBarberRole = session.role === UserRole.BARBER;

  const [appointmentsDocs, personalBlocksDocs, globalBlocksDocs, barberScheduleSnap, generalScheduleSnap] =
    await Promise.all([
      serverQueryCollection(
        'citas',
        {
          filters: [
            isBarberRole
              ? { field: 'barberUid', op: '==', value: session.uid }
              : { field: 'barberId', op: '==', value: barber.id },
          ],
        },
        idToken
      ).catch(() => []),
      serverQueryCollection(
        'bloqueos',
        {
          filters: [
            isBarberRole
              ? { field: 'barberUid', op: '==', value: session.uid }
              : { field: 'barberId', op: '==', value: barber.id },
          ],
        },
        idToken
      ).catch(() => []),
      serverQueryCollection(
        'bloqueos',
        { filters: [{ field: 'barberId', op: '==', value: 'all' }] },
        idToken
      ).catch(() => []),
      serverGetDoc('horarios', barber.id, idToken).catch(() => ({
        id: barber.id,
        exists: false,
        data: undefined,
      })),
      serverGetDoc('horarios', 'general', idToken).catch(() => ({
        id: 'general',
        exists: false,
        data: undefined,
      })),
    ]);

  const appointments: Appointment[] = appointmentsDocs
    .map((doc) => {
      const d = doc.data ?? {};
      return {
        id: doc.id,
        clientId: String(d.clientId ?? ''),
        clientName: String(d.clientName ?? ''),
        clientPhone: String(d.clientPhone ?? ''),
        clientEmail: String(d.clientEmail ?? ''),
        barberId: String(d.barberId ?? barber.id),
        barberUid: String(d.barberUid ?? ''),
        barberName: String(d.barberName ?? barber.name),
        serviceId: String(d.serviceId ?? ''),
        serviceName: String(d.serviceName ?? ''),
        priceCop: Number(d.priceCop ?? 0),
        durationMinutes: Number(d.durationMinutes ?? 30),
        date: String(d.date ?? ''),
        startTime: String(d.startTime ?? ''),
        endTime: String(d.endTime ?? ''),
        status: String(
          d.status ?? AppointmentStatus.CONFIRMED
        ) as AppointmentStatus,
        notes: d.notes ? String(d.notes) : undefined,
        bookingCode: d.bookingCode ? String(d.bookingCode) : undefined,
        createdAt: serializeTimestamp(d.createdAt),
        updatedAt: serializeTimestamp(d.updatedAt),
      };
    })
    .filter((appt) => appt.date >= startDate && appt.date <= endDate)
    .sort((a, b) =>
      `${a.date}_${a.startTime}`.localeCompare(`${b.date}_${b.startTime}`)
    );

  const summary: BarberWorkspaceSummary = {
    total: appointments.length,
    pendingCount: appointments.filter(
      (a) =>
        a.status === AppointmentStatus.CONFIRMED ||
        a.status === AppointmentStatus.IN_PROGRESS
    ).length,
    completedCount: appointments.filter(
      (a) => a.status === AppointmentStatus.COMPLETED
    ).length,
    cancelledCount: appointments.filter(
      (a) =>
        a.status === AppointmentStatus.CANCELLED ||
        a.status === AppointmentStatus.NO_SHOW
    ).length,
    completedRevenueCop: appointments
      .filter((a) => a.status === AppointmentStatus.COMPLETED)
      .reduce((acc, a) => acc + a.priceCop, 0),
  };

  const blockMap = new Map<string, ScheduleBlock>();
  for (const doc of [...personalBlocksDocs, ...globalBlocksDocs]) {
    const d = doc.data ?? {};
    blockMap.set(doc.id, {
      id: doc.id,
      barberId: String(d.barberId ?? barber.id) as string | 'all',
      barberUid: d.barberUid ? String(d.barberUid) : undefined,
      date: String(d.date ?? ''),
      allDay: Boolean(d.allDay),
      startTime: d.startTime ? String(d.startTime) : undefined,
      endTime: d.endTime ? String(d.endTime) : undefined,
      reason: String(d.reason ?? ''),
      createdBy: String(d.createdBy ?? ''),
      createdAt: serializeTimestamp(d.createdAt),
    });
  }

  const blocks = Array.from(blockMap.values())
    .filter((b) => b.date >= todayBogota)
    .sort((a, b) =>
      `${a.date}_${a.startTime ?? '00:00'}`.localeCompare(
        `${b.date}_${b.startTime ?? '00:00'}`
      )
    );

  const generalDays = Array.isArray(generalScheduleSnap.data?.days)
    ? (generalScheduleSnap.data?.days as DaySchedule[])
    : DEFAULT_DAYS;

  const hasCustomSchedule =
    barberScheduleSnap.exists &&
    Array.isArray(barberScheduleSnap.data?.days) &&
    barberScheduleSnap.data!.days.length === 7;

  const scheduleDays = hasCustomSchedule
    ? (barberScheduleSnap.data!.days as DaySchedule[])
    : generalDays;

  return {
    barber,
    availableBarbers,
    date,
    range,
    endDate,
    appointments,
    summary,
    scheduleDays,
    generalDays,
    hasCustomSchedule,
    blocks,
  };
}
