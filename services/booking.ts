import 'server-only';
import { DEFAULT_SLOT_INTERVAL_MINUTES } from '@/lib/constants/config';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import {
  FirestoreRestPermissionError,
  serverGetDoc,
  serverQueryCollection,
  type ServerDocSnapshot,
} from '@/lib/firestore-server';
import {
  generateScheduleTimeSlots,
  getDayOfWeekBogota,
} from '@/lib/utils/schedule-slots';
import {
  formatTime12h,
  getBogotaDateString,
  minutesToTime,
  timeToMinutes,
} from '@/lib/utils/timezone';
import { AppointmentStatus, type DaySchedule } from '@/types';

const DEFAULT_OPEN_TIME = '08:00';
const DEFAULT_CLOSE_TIME = '20:00';

const DEFAULT_WEEK_SCHEDULE: DaySchedule[] = [0, 1, 2, 3, 4, 5, 6].map(
  (dayOfWeek) => ({
    dayOfWeek,
    isOpen: true,
    openTime: DEFAULT_OPEN_TIME,
    closeTime: DEFAULT_CLOSE_TIME,
  })
);

const NON_BLOCKING_STATUSES = new Set<string>([
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
]);

export interface CheckAvailabilityInput {
  barberId: string;
  date: string; // YYYY-MM-DD en America/Bogota
  serviceId?: string;
  durationMinutes?: number;
}

export interface AvailabilitySlotDetail {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  label12h: string; // Ej: "8:00 AM"
  period: 'morning' | 'afternoon';
  availableBarberIds: string[];
}

export interface BusyInterval {
  barberId: string;
  startTime: string;
  endTime: string;
  source: 'cita' | 'bloqueo';
}

export interface AvailabilityResult {
  barberId: string;
  date: string;
  dayOfWeek: number;
  isOpen: boolean;
  durationMinutes: number;
  slotIntervalMinutes: number;
  openTime: string | null;
  closeTime: string | null;
  availableSlots: string[];
  morningSlots: string[];
  afternoonSlots: string[];
  slots: AvailabilitySlotDetail[];
  busyIntervals: BusyInterval[];
  reason?: string;
}

function clampDayScheduleToOperatingWindow(
  daySchedule: DaySchedule
): DaySchedule {
  const minOpenMinutes = timeToMinutes(DEFAULT_OPEN_TIME);
  const maxCloseMinutes = timeToMinutes(DEFAULT_CLOSE_TIME);

  const openMinutes = Math.max(
    minOpenMinutes,
    timeToMinutes(daySchedule.openTime || DEFAULT_OPEN_TIME)
  );
  const closeMinutes = Math.min(
    maxCloseMinutes,
    timeToMinutes(daySchedule.closeTime || DEFAULT_CLOSE_TIME)
  );

  if (closeMinutes <= openMinutes) {
    return {
      ...daySchedule,
      isOpen: false,
    };
  }

  return {
    ...daySchedule,
    openTime: minutesToTime(openMinutes),
    closeTime: minutesToTime(closeMinutes),
  };
}

function getEffectiveDaySchedule(
  dayOfWeek: number,
  barberDays: DaySchedule[] | undefined,
  generalDays: DaySchedule[] | undefined
): DaySchedule {
  const barberDay = barberDays?.find((d) => d.dayOfWeek === dayOfWeek);
  const generalDay = generalDays?.find((d) => d.dayOfWeek === dayOfWeek);
  const fallbackDay = DEFAULT_WEEK_SCHEDULE.find(
    (d) => d.dayOfWeek === dayOfWeek
  )!;

  const chosen = barberDay ?? generalDay ?? fallbackDay;
  return clampDayScheduleToOperatingWindow(chosen);
}

function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && endA > startB;
}

async function safePublicQuery(
  fn: () => Promise<ServerDocSnapshot[]>
): Promise<ServerDocSnapshot[]> {
  try {
    return await fn();
  } catch (error) {
    if (
      !hasAdminServiceAccount() &&
      error instanceof FirestoreRestPermissionError &&
      error.status === 403
    ) {
      return [];
    }
    throw error;
  }
}

async function safePublicDoc(
  fn: () => Promise<ServerDocSnapshot>
): Promise<ServerDocSnapshot | null> {
  try {
    return await fn();
  } catch (error) {
    if (
      !hasAdminServiceAccount() &&
      error instanceof FirestoreRestPermissionError &&
      error.status === 403
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Consulta la disponibilidad real en Cloud Firestore para un barbero (o 'any') y fecha específicos.
 * Verifica horario de atención (8:00 AM - 8:00 PM de lunes a domingo, o ajuste particular del barbero),
 * bloqueos de agenda, citas existentes (excluyendo canceladas/no_asistio) y la duración del servicio.
 */
export async function checkAvailability(
  input: CheckAvailabilityInput
): Promise<AvailabilityResult> {
  const { barberId, date, serviceId, durationMinutes: rawDuration } = input;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Formato de fecha inválido. Se esperaba YYYY-MM-DD.');
  }

  if (!barberId || !barberId.trim()) {
    throw new Error('El identificador del barbero es obligatorio.');
  }

  const dayOfWeek = getDayOfWeekBogota(date);
  const todayBogota = getBogotaDateString(new Date());

  // Resolver duración desde el servicio en Firestore o desde el parámetro explícito
  let durationMinutes = rawDuration ?? 30;
  if (serviceId) {
    const serviceSnap = await safePublicDoc(() =>
      serverGetDoc('servicios', serviceId)
    );
    if (serviceSnap?.exists && serviceSnap.data) {
      if (!serviceSnap.data.active) {
        throw new Error(
          'El servicio seleccionado no está disponible actualmente.'
        );
      }
      durationMinutes = Number(serviceSnap.data.durationMinutes);
    } else if (hasAdminServiceAccount()) {
      throw new Error('El servicio seleccionado no existe.');
    }
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('La duración del servicio debe ser mayor a 0 minutos.');
  }

  const [configSnap, generalScheduleSnap] = await Promise.all([
    safePublicDoc(() => serverGetDoc('configuracion', 'main')),
    safePublicDoc(() => serverGetDoc('horarios', 'general')),
  ]);

  const slotIntervalMinutes = Number(
    configSnap?.data?.slotIntervalMinutes ?? DEFAULT_SLOT_INTERVAL_MINUTES
  );

  if (date < todayBogota) {
    return {
      barberId,
      date,
      dayOfWeek,
      isOpen: false,
      durationMinutes,
      slotIntervalMinutes,
      openTime: null,
      closeTime: null,
      availableSlots: [],
      morningSlots: [],
      afternoonSlots: [],
      slots: [],
      busyIntervals: [],
      reason: 'La fecha seleccionada ya transcurrió.',
    };
  }

  const generalDays = Array.isArray(generalScheduleSnap?.data?.days)
    ? (generalScheduleSnap?.data?.days as DaySchedule[])
    : DEFAULT_WEEK_SCHEDULE;

  // Determinar los barberos a evaluar ('any' evalúa todos los activos)
  let targetBarberIds: string[] = [];
  if (barberId === 'any') {
    const activeBarbersDocs = await safePublicQuery(() =>
      serverQueryCollection('barberos', {
        filters: [{ field: 'active', op: '==', value: true }],
      })
    );
    targetBarberIds =
      activeBarbersDocs.length > 0
        ? activeBarbersDocs.map((doc) => doc.id)
        : ['jose'];
  } else {
    const barberSnap = await safePublicDoc(() =>
      serverGetDoc('barberos', barberId)
    );
    if (barberSnap?.exists) {
      if (!barberSnap.data?.active) {
        return {
          barberId,
          date,
          dayOfWeek,
          isOpen: false,
          durationMinutes,
          slotIntervalMinutes,
          openTime: null,
          closeTime: null,
          availableSlots: [],
          morningSlots: [],
          afternoonSlots: [],
          slots: [],
          busyIntervals: [],
          reason: 'El barbero seleccionado no se encuentra activo.',
        };
      }
    } else if (hasAdminServiceAccount()) {
      return {
        barberId,
        date,
        dayOfWeek,
        isOpen: false,
        durationMinutes,
        slotIntervalMinutes,
        openTime: null,
        closeTime: null,
        availableSlots: [],
        morningSlots: [],
        afternoonSlots: [],
        slots: [],
        busyIntervals: [],
        reason: 'El barbero seleccionado no se encuentra activo.',
      };
    }
    targetBarberIds = [barberId];
  }

  if (targetBarberIds.length === 0) {
    return {
      barberId,
      date,
      dayOfWeek,
      isOpen: false,
      durationMinutes,
      slotIntervalMinutes,
      openTime: null,
      closeTime: null,
      availableSlots: [],
      morningSlots: [],
      afternoonSlots: [],
      slots: [],
      busyIntervals: [],
      reason: 'No hay barberos activos registrados para esa fecha.',
    };
  }

  // Consultar citas existentes de la fecha y bloqueos aplicables
  const [appointmentsDocs, blocksDocs, barberScheduleSnaps] = await Promise.all([
    safePublicQuery(() =>
      barberId === 'any'
        ? serverQueryCollection('citas', {
            filters: [{ field: 'date', op: '==', value: date }],
          })
        : serverQueryCollection('citas', {
            filters: [
              { field: 'barberId', op: '==', value: barberId },
              { field: 'date', op: '==', value: date },
            ],
          })
    ),
    safePublicQuery(() =>
      serverQueryCollection('bloqueos', {
        filters: [{ field: 'date', op: '==', value: date }],
      })
    ),
    Promise.all(
      targetBarberIds.map((id) =>
        safePublicDoc(() => serverGetDoc('horarios', id))
      )
    ),
  ]);

  const busyByBarber = new Map<string, BusyInterval[]>();
  for (const id of targetBarberIds) {
    busyByBarber.set(id, []);
  }

  // Registrar citas activas como intervalos ocupados
  for (const doc of appointmentsDocs) {
    const data = doc.data ?? {};
    const status = String(data.status ?? '');
    if (NON_BLOCKING_STATUSES.has(status)) {
      continue;
    }

    const apptBarberId = String(data.barberId ?? '');
    if (!busyByBarber.has(apptBarberId)) {
      continue;
    }

    const startTime = String(data.startTime ?? '');
    const endTime = String(data.endTime ?? '');
    if (startTime && endTime) {
      busyByBarber.get(apptBarberId)!.push({
        barberId: apptBarberId,
        startTime,
        endTime,
        source: 'cita',
      });
    }
  }

  // Registrar bloqueos manuales (globales o del barbero)
  for (const doc of blocksDocs) {
    const data = doc.data ?? {};
    const blockBarberId = String(data.barberId ?? '');
    const allDay = Boolean(data.allDay);
    const blockStart = allDay ? DEFAULT_OPEN_TIME : String(data.startTime ?? '');
    const blockEnd = allDay ? DEFAULT_CLOSE_TIME : String(data.endTime ?? '');

    if (!blockStart || !blockEnd) continue;

    if (blockBarberId === 'all') {
      for (const id of targetBarberIds) {
        busyByBarber.get(id)!.push({
          barberId: id,
          startTime: blockStart,
          endTime: blockEnd,
          source: 'bloqueo',
        });
      }
    } else if (busyByBarber.has(blockBarberId)) {
      busyByBarber.get(blockBarberId)!.push({
        barberId: blockBarberId,
        startTime: blockStart,
        endTime: blockEnd,
        source: 'bloqueo',
      });
    }
  }

  // Calcular franjas libres por cada barbero candidato
  const slotToBarberIds = new Map<string, string[]>();
  let anyBarberOpen = false;
  let effectiveOpenTime: string | null = null;
  let effectiveCloseTime: string | null = null;

  targetBarberIds.forEach((id, index) => {
    const barberScheduleDoc = barberScheduleSnaps[index];
    const barberDays = barberScheduleDoc?.exists
      ? (barberScheduleDoc.data?.days as DaySchedule[] | undefined)
      : undefined;

    const daySchedule = getEffectiveDaySchedule(
      dayOfWeek,
      barberDays,
      generalDays
    );

    if (!daySchedule.isOpen) {
      return;
    }

    anyBarberOpen = true;
    if (!effectiveOpenTime || daySchedule.openTime < effectiveOpenTime) {
      effectiveOpenTime = daySchedule.openTime;
    }
    if (!effectiveCloseTime || daySchedule.closeTime > effectiveCloseTime) {
      effectiveCloseTime = daySchedule.closeTime;
    }

    const baseCandidates = generateScheduleTimeSlots({
      date,
      daySchedule,
      durationMinutes,
      intervalMinutes: slotIntervalMinutes,
    });

    const barberBusy = busyByBarber.get(id) ?? [];

    for (const candidateStart of baseCandidates) {
      const candidateStartMin = timeToMinutes(candidateStart);
      const candidateEndMin = candidateStartMin + durationMinutes;

      const hasConflict = barberBusy.some((busy) =>
        intervalsOverlap(
          candidateStartMin,
          candidateEndMin,
          timeToMinutes(busy.startTime),
          timeToMinutes(busy.endTime)
        )
      );

      if (!hasConflict) {
        const currentList = slotToBarberIds.get(candidateStart) ?? [];
        currentList.push(id);
        slotToBarberIds.set(candidateStart, currentList);
      }
    }
  });

  const sortedSlotTimes = Array.from(slotToBarberIds.keys()).sort(
    (a, b) => timeToMinutes(a) - timeToMinutes(b)
  );

  const slots: AvailabilitySlotDetail[] = sortedSlotTimes.map((startTime) => {
    const startMinutes = timeToMinutes(startTime);
    return {
      startTime,
      endTime: minutesToTime(startMinutes + durationMinutes),
      label12h: formatTime12h(startTime),
      period: startMinutes < 12 * 60 ? 'morning' : 'afternoon',
      availableBarberIds: slotToBarberIds.get(startTime) ?? [],
    };
  });

  const morningSlots = slots
    .filter((s) => s.period === 'morning')
    .map((s) => s.startTime);
  const afternoonSlots = slots
    .filter((s) => s.period === 'afternoon')
    .map((s) => s.startTime);

  const allBusyIntervals = Array.from(busyByBarber.values()).flat();

  return {
    barberId,
    date,
    dayOfWeek,
    isOpen: anyBarberOpen,
    durationMinutes,
    slotIntervalMinutes,
    openTime: effectiveOpenTime,
    closeTime: effectiveCloseTime,
    availableSlots: sortedSlotTimes,
    morningSlots,
    afternoonSlots,
    slots,
    busyIntervals: allBusyIntervals,
    reason: !anyBarberOpen
      ? 'No hay atención programada para esta fecha.'
      : sortedSlotTimes.length === 0
        ? 'No quedan horarios disponibles para la duración de este servicio en la fecha elegida.'
        : undefined,
  };
}
