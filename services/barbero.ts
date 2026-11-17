import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import type { SessionUser } from '@/lib/auth/session';
import { DEFAULT_SLOT_INTERVAL_MINUTES } from '@/lib/constants/config';
import {
  generateFirestoreAutoId,
  serverGetDoc,
  serverQueryCollection,
  serverSetDoc,
} from '@/lib/firestore-server';
import {
  resolveEffectiveDaySchedule,
  validateAndComputeBlockedSlots,
} from '@/lib/utils/schedule-blocks';
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
  shopName: string;
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
      id: barberId || '',
      userId: session.uid,
      name: session.displayName,
      specialty: 'Barbero del equipo',
      active: session.active,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return {
      barber: fallback,
      availableBarbers: fallback.id
        ? [{ id: fallback.id, name: fallback.name, active: fallback.active }]
        : [],
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
      id: '',
      userId: '',
      name: 'Sin barberos registrados',
      specialty: 'Agrega un barbero desde Administración',
      active: false,
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

  const [
    appointmentsDocs,
    personalBlocksDocs,
    globalBlocksDocs,
    barberScheduleSnap,
    generalScheduleSnap,
    shopConfigSnap,
  ] = await Promise.all([
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
    serverGetDoc('configuracion', 'main', idToken).catch(() => ({
      id: 'main',
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

  const shopName =
    shopConfigSnap.exists && shopConfigSnap.data?.name
      ? String(shopConfigSnap.data.name)
      : 'Barbería Estudio';

  return {
    shopName,
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

export class BarberBlockValidationError extends Error {
  status = 400;
  code = 'INVALID_BLOCK';
  constructor(message: string) {
    super(message);
    this.name = 'BarberBlockValidationError';
  }
}

export class BarberBlockConflictError extends Error {
  status = 409;
  code: string;
  constructor(message: string, code = 'BLOCK_CONFLICT') {
    super(message);
    this.name = 'BarberBlockConflictError';
    this.code = code;
  }
}

export class BarberBlockNotFoundError extends Error {
  status = 404;
  code = 'BARBER_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'BarberBlockNotFoundError';
  }
}

export interface CreateValidatedScheduleBlockResult {
  block: ScheduleBlock;
  deactivatedSlots: string[];
  deactivatedCount: number;
  message: string;
}

export async function createValidatedScheduleBlock(params: {
  session: SessionUser;
  targetBarberId: string; // ID del barbero o 'all' (solo admin)
  targetBarberUid?: string;
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  reason: string;
  idToken?: string;
}): Promise<CreateValidatedScheduleBlockResult> {
  const {
    session,
    targetBarberId,
    targetBarberUid,
    date,
    allDay,
    startTime,
    endTime,
    reason,
    idToken,
  } = params;

  if (!targetBarberId || !targetBarberId.trim()) {
    throw new BarberBlockValidationError(
      'No encontramos un perfil de barbero asociado para registrar el bloqueo.'
    );
  }

  if (targetBarberId === 'all' && session.role !== UserRole.ADMIN) {
    throw new BarberBlockValidationError(
      'Solo un administrador puede crear bloqueos globales para toda la barbería.'
    );
  }

  // Verificar existencia del barbero si no es bloqueo global
  let resolvedBarberUid = targetBarberUid;
  if (targetBarberId !== 'all') {
    const barberDoc = await serverGetDoc('barberos', targetBarberId, idToken);
    if (!barberDoc.exists || !barberDoc.data) {
      throw new BarberBlockNotFoundError('El barbero seleccionado no existe.');
    }
    resolvedBarberUid =
      session.role === UserRole.BARBER
        ? session.uid
        : String(barberDoc.data.userId ?? targetBarberUid ?? '');
  }

  const isBarberRole = session.role === UserRole.BARBER;

  const [
    configSnap,
    generalScheduleSnap,
    barberScheduleSnap,
    allActiveBarbersDocs,
    activeServicesDocs,
    dayBlocksDocs,
    appointmentsDocs,
  ] = await Promise.all([
    serverGetDoc('configuracion', 'main', idToken).catch(() => ({
      id: 'main',
      exists: false,
      data: undefined,
    })),
    serverGetDoc('horarios', 'general', idToken).catch(() => ({
      id: 'general',
      exists: false,
      data: undefined,
    })),
    targetBarberId !== 'all'
      ? serverGetDoc('horarios', targetBarberId, idToken).catch(() => ({
          id: targetBarberId,
          exists: false,
          data: undefined,
        }))
      : Promise.resolve({ id: 'all', exists: false, data: undefined }),
    targetBarberId === 'all'
      ? serverQueryCollection(
          'barberos',
          { filters: [{ field: 'active', op: '==', value: true }] },
          idToken
        ).catch(() => [])
      : Promise.resolve([]),
    serverQueryCollection(
      'servicios',
      { filters: [{ field: 'active', op: '==', value: true }] },
      idToken
    ).catch(() => []),
    serverQueryCollection(
      'bloqueos',
      { filters: [{ field: 'date', op: '==', value: date }] },
      idToken
    ).catch(() => []),
    serverQueryCollection(
      'citas',
      {
        filters: [
          isBarberRole
            ? { field: 'barberUid', op: '==', value: session.uid }
            : { field: 'date', op: '==', value: date },
        ],
      },
      idToken
    ).catch(() => []),
  ]);

  const slotIntervalMinutes = Number(
    configSnap.data?.slotIntervalMinutes ?? DEFAULT_SLOT_INTERVAL_MINUTES
  );

  const generalDays = Array.isArray(generalScheduleSnap.data?.days)
    ? (generalScheduleSnap.data?.days as DaySchedule[])
    : DEFAULT_DAYS;

  let daySchedules: DaySchedule[] = [];
  if (targetBarberId === 'all') {
    const activeIds = allActiveBarbersDocs.map((b) => b.id);
    if (activeIds.length === 0) {
      daySchedules = [resolveEffectiveDaySchedule(date, undefined, generalDays)];
    } else {
      const perBarberSchedules = await Promise.all(
        activeIds.map((id) =>
          serverGetDoc('horarios', id, idToken).catch(() => ({
            id,
            exists: false,
            data: undefined,
          }))
        )
      );
      daySchedules = perBarberSchedules.map((snap) =>
        resolveEffectiveDaySchedule(
          date,
          Array.isArray(snap.data?.days)
            ? (snap.data?.days as DaySchedule[])
            : undefined,
          generalDays
        )
      );
    }
  } else {
    const barberDays =
      barberScheduleSnap.exists && Array.isArray(barberScheduleSnap.data?.days)
        ? (barberScheduleSnap.data?.days as DaySchedule[])
        : undefined;
    daySchedules = [resolveEffectiveDaySchedule(date, barberDays, generalDays)];
  }

  const serviceDurations = activeServicesDocs
    .map((s) => Number(s.data?.durationMinutes ?? 0))
    .filter((d) => Number.isFinite(d) && d > 0);
  const minServiceDurationMinutes =
    serviceDurations.length > 0 ? Math.min(...serviceDurations) : undefined;

  const existingAppointments = appointmentsDocs.map((doc) => {
    const d = doc.data ?? {};
    return {
      id: doc.id,
      barberId: String(d.barberId ?? ''),
      date: String(d.date ?? ''),
      startTime: String(d.startTime ?? ''),
      endTime: String(d.endTime ?? ''),
      status: String(d.status ?? ''),
      clientName: d.clientName ? String(d.clientName) : undefined,
    };
  });

  const existingBlocks = dayBlocksDocs.map((doc) => {
    const d = doc.data ?? {};
    return {
      id: doc.id,
      barberId: String(d.barberId ?? ''),
      date: String(d.date ?? ''),
      allDay: Boolean(d.allDay),
      startTime: d.startTime ? String(d.startTime) : undefined,
      endTime: d.endTime ? String(d.endTime) : undefined,
    };
  });

  const validation = validateAndComputeBlockedSlots({
    barberId: targetBarberId,
    date,
    allDay,
    startTime: allDay ? undefined : startTime,
    endTime: allDay ? undefined : endTime,
    daySchedules,
    slotIntervalMinutes,
    minServiceDurationMinutes,
    existingAppointments,
    existingBlocks,
  });

  if (!validation.ok) {
    if (validation.status === 409) {
      throw new BarberBlockConflictError(validation.error, validation.code);
    }
    throw new BarberBlockValidationError(validation.error);
  }

  const blockId = generateFirestoreAutoId();

  await serverSetDoc(
    'bloqueos',
    blockId,
    {
      id: blockId,
      barberId: targetBarberId,
      ...(resolvedBarberUid ? { barberUid: resolvedBarberUid } : {}),
      date,
      allDay,
      ...(!allDay && startTime && endTime ? { startTime, endTime } : {}),
      reason,
      createdBy: session.uid,
    },
    { serverTimestampFields: ['createdAt'] },
    idToken
  );

  const block: ScheduleBlock = {
    id: blockId,
    barberId: targetBarberId,
    ...(resolvedBarberUid ? { barberUid: resolvedBarberUid } : {}),
    date,
    allDay,
    ...(!allDay && startTime && endTime ? { startTime, endTime } : {}),
    reason,
    createdBy: session.uid,
    createdAt: new Date().toISOString(),
  };

  return {
    block,
    deactivatedSlots: validation.deactivatedSlots,
    deactivatedCount: validation.deactivatedCount,
    message: validation.summaryMessage,
  };
}
