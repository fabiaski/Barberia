import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createBookingManageToken, verifyBookingManageToken } from '@/lib/auth/manage-token';
import { DEFAULT_SLOT_INTERVAL_MINUTES } from '@/lib/constants/config';
import { getAdminDb, hasAdminServiceAccount } from '@/lib/firebase-admin';
import {
  FirestoreRestPermissionError,
  generateFirestoreAutoId,
  serverCommitWrites,
  serverGetDoc,
  serverQueryCollection,
  type ServerBatchOperation,
  type ServerDocSnapshot,
} from '@/lib/firestore-server';
import {
  generateScheduleTimeSlots,
  getDayOfWeekBogota,
} from '@/lib/utils/schedule-slots';
import {
  formatTime12h,
  getBogotaDateString,
  getBogotaTimeString,
  minutesToTime,
  timeToMinutes,
} from '@/lib/utils/timezone';
import type { CreateBookingInput } from '@/lib/validators/booking';
import {
  AppointmentStatus,
  type Appointment,
  type DaySchedule,
} from '@/types';

const DEFAULT_OPEN_TIME = '08:00';
const DEFAULT_CLOSE_TIME = '20:00';
const OCCUPANCY_STEP_MINUTES = 5;

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

export class BookingConflictError extends Error {
  status = 409;
  code = 'SLOT_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'BookingConflictError';
  }
}

export class BookingNotFoundError extends Error {
  status = 404;
  code = 'BOOKING_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'BookingNotFoundError';
  }
}

export class BookingValidationError extends Error {
  status = 400;
  code = 'BOOKING_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'BookingValidationError';
  }
}

export class BookingConfigurationError extends Error {
  status = 503;
  code = 'MISSING_ADMIN_CREDENTIALS';
  constructor(message: string) {
    super(message);
    this.name = 'BookingConfigurationError';
  }
}

export interface CheckAvailabilityInput {
  barberId: string;
  date: string; // YYYY-MM-DD en America/Bogota
  serviceId?: string;
  durationMinutes?: number;
  excludeAppointmentId?: string;
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

export interface PublicBookingSummary {
  id: string;
  bookingCode: string;
  serviceId: string;
  serviceName: string;
  priceCop: number;
  durationMinutes: number;
  barberId: string;
  barberName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  notes?: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  canModify: boolean;
  manageToken: string;
}

export type BookingAuthProof =
  | { manageToken: string }
  | { bookingCode: string; email: string };

function serializeTimestamp(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
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

export function buildOccupancySlotKeys(
  barberId: string,
  date: string,
  startTime: string,
  durationMinutes: number
): Array<{ slotKey: string; slotTime: string }> {
  const startMin = timeToMinutes(startTime);
  const endMin = startMin + durationMinutes;
  const alignedStart =
    Math.floor(startMin / OCCUPANCY_STEP_MINUTES) * OCCUPANCY_STEP_MINUTES;
  const slots: Array<{ slotKey: string; slotTime: string }> = [];

  for (let m = alignedStart; m < endMin; m += OCCUPANCY_STEP_MINUTES) {
    const slotTime = minutesToTime(m);
    const slotKey = `${barberId}_${date}_${slotTime.replace(':', '')}`;
    slots.push({ slotKey, slotTime });
  }

  return slots;
}

function buildClientId(email: string): string {
  const hash = createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 20);
  return `cli_${hash}`;
}

function generateBookingCode(): string {
  const raw = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `BE-${raw}`;
}

function isAppointmentModifiable(status: string, date: string, startTime: string): boolean {
  if (status !== AppointmentStatus.CONFIRMED) {
    return false;
  }
  const todayBogota = getBogotaDateString(new Date());
  if (date > todayBogota) return true;
  if (date < todayBogota) return false;
  const nowMin = timeToMinutes(getBogotaTimeString(new Date()));
  return timeToMinutes(startTime) > nowMin;
}

function toPublicSummary(
  id: string,
  data: Record<string, unknown>
): PublicBookingSummary {
  const clientEmail = String(data.clientEmail ?? '');
  const status = String(
    data.status ?? AppointmentStatus.CONFIRMED
  ) as AppointmentStatus;
  const date = String(data.date ?? '');
  const startTime = String(data.startTime ?? '');

  return {
    id,
    bookingCode: String(data.bookingCode ?? id.slice(0, 8).toUpperCase()),
    serviceId: String(data.serviceId ?? ''),
    serviceName: String(data.serviceName ?? ''),
    priceCop: Number(data.priceCop ?? 0),
    durationMinutes: Number(data.durationMinutes ?? 30),
    barberId: String(data.barberId ?? ''),
    barberName: String(data.barberName ?? ''),
    date,
    startTime,
    endTime: String(data.endTime ?? ''),
    status,
    notes: data.notes ? String(data.notes) : undefined,
    clientName: String(data.clientName ?? ''),
    clientPhone: String(data.clientPhone ?? ''),
    clientEmail,
    canModify: isAppointmentModifiable(status, date, startTime),
    manageToken: createBookingManageToken(id, clientEmail),
  };
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
 */
export async function checkAvailability(
  input: CheckAvailabilityInput
): Promise<AvailabilityResult> {
  const {
    barberId,
    date,
    serviceId,
    durationMinutes: rawDuration,
    excludeAppointmentId,
  } = input;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BookingValidationError(
      'Formato de fecha inválido. Se esperaba AAAA-MM-DD.'
    );
  }

  if (!barberId || !barberId.trim()) {
    throw new BookingValidationError(
      'El identificador del barbero es obligatorio.'
    );
  }

  const dayOfWeek = getDayOfWeekBogota(date);
  const todayBogota = getBogotaDateString(new Date());

  let durationMinutes = rawDuration ?? 30;
  if (serviceId) {
    const serviceSnap = await safePublicDoc(() =>
      serverGetDoc('servicios', serviceId)
    );
    if (serviceSnap?.exists && serviceSnap.data) {
      if (!serviceSnap.data.active) {
        throw new BookingValidationError(
          'El servicio seleccionado no está disponible actualmente.'
        );
      }
      durationMinutes = Number(serviceSnap.data.durationMinutes);
    } else if (hasAdminServiceAccount()) {
      throw new BookingValidationError('El servicio seleccionado no existe.');
    }
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new BookingValidationError(
      'La duración del servicio debe ser mayor a 0 minutos.'
    );
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

  for (const doc of appointmentsDocs) {
    if (excludeAppointmentId && doc.id === excludeAppointmentId) {
      continue;
    }
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

/**
 * Crea una cita de forma transaccional y atómica:
 * - Valida disponibilidad real (horario, bloqueos y citas previas).
 * - Bloquea todos los intervalos de 5 minutos en `ocupacion/{barberId}_{YYYY-MM-DD}_{HHmm}`.
 * - Actualiza o crea el registro CRM del cliente en `clientes`.
 * - Inserta la reserva en `citas` con código único y token de gestión.
 */
export async function createAtomicBooking(
  input: CreateBookingInput,
  idToken?: string
): Promise<{ appointment: Appointment; summary: PublicBookingSummary }> {
  const todayBogota = getBogotaDateString(new Date());
  if (input.date < todayBogota) {
    throw new BookingValidationError(
      'No es posible agendar reservas en fechas pasadas.'
    );
  }

  const availability = await checkAvailability({
    barberId: input.barberId,
    date: input.date,
    serviceId: input.serviceId,
  });

  if (!availability.isOpen) {
    throw new BookingValidationError(
      availability.reason ?? 'La barbería no atiende en la fecha elegida.'
    );
  }

  const slotDetail = availability.slots.find(
    (s) => s.startTime === input.startTime
  );
  if (!slotDetail || slotDetail.availableBarberIds.length === 0) {
    throw new BookingConflictError(
      'El horario seleccionado ya no está disponible. Elige otra franja horaria.'
    );
  }

  const trimmedNotes = input.notes?.trim() || undefined;
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedFullName = input.fullName.trim();
  const normalizedPhone = input.phone.trim();
  const clientId = buildClientId(normalizedEmail);
  const appointmentId = generateFirestoreAutoId();
  const bookingCode = generateBookingCode();

  // Ruta principal: transacción atómica real con Firebase Admin SDK
  if (hasAdminServiceAccount()) {
    const db = getAdminDb();
    const candidateBarberIds =
      input.barberId === 'any'
        ? slotDetail.availableBarberIds
        : [input.barberId];

    const createdAppointment = await db.runTransaction(async (tx) => {
      const serviceRef = db.collection('servicios').doc(input.serviceId);
      const clientRef = db.collection('clientes').doc(clientId);
      const dayAppointmentsQuery = db
        .collection('citas')
        .where('date', '==', input.date);
      const dayBlocksQuery = db
        .collection('bloqueos')
        .where('date', '==', input.date);

      const barberRefs = candidateBarberIds.map((bId) =>
        db.collection('barberos').doc(bId)
      );

      // Primero leemos servicio para conocer la duración exacta
      const serviceSnap = await tx.get(serviceRef);
      if (!serviceSnap.exists || !serviceSnap.data()?.active) {
        throw new BookingValidationError(
          'El servicio seleccionado no está disponible.'
        );
      }
      const serviceData = serviceSnap.data()!;
      const durationMinutes = Number(serviceData.durationMinutes);
      const priceCop = Number(serviceData.priceCop);
      const serviceName = String(serviceData.name);
      const startMinutes = timeToMinutes(input.startTime);
      const endMinutes = startMinutes + durationMinutes;
      const endTime = minutesToTime(endMinutes);

      // Preparar lecturas de candados de ocupación para cada barbero candidato
      const candidateLocks = candidateBarberIds.map((bId) => ({
        barberId: bId,
        slots: buildOccupancySlotKeys(
          bId,
          input.date,
          input.startTime,
          durationMinutes
        ),
      }));

      const allLockRefs = candidateLocks.flatMap((c) =>
        c.slots.map((s) => db.collection('ocupacion').doc(s.slotKey))
      );

      const [
        clientSnap,
        barberSnaps,
        dayApptsSnap,
        dayBlocksSnap,
        flatLockSnaps,
      ] = await Promise.all([
        tx.get(clientRef),
        Promise.all(barberRefs.map((ref) => tx.get(ref))),
        tx.get(dayAppointmentsQuery),
        tx.get(dayBlocksQuery),
        allLockRefs.length > 0
          ? tx.getAll(...allLockRefs)
          : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
      ]);

      const lockExistsByKey = new Map<string, boolean>();
      for (const lockSnap of flatLockSnaps) {
        lockExistsByKey.set(lockSnap.id, lockSnap.exists);
      }

      // Verificar bloqueos y citas existentes dentro de la transacción
      const activeApptsByBarber = new Map<
        string,
        Array<{ start: number; end: number }>
      >();
      for (const doc of dayApptsSnap.docs) {
        const d = doc.data();
        if (NON_BLOCKING_STATUSES.has(String(d.status ?? ''))) continue;
        const bId = String(d.barberId ?? '');
        const list = activeApptsByBarber.get(bId) ?? [];
        list.push({
          start: timeToMinutes(String(d.startTime)),
          end: timeToMinutes(String(d.endTime)),
        });
        activeApptsByBarber.set(bId, list);
      }

      const blocksByBarber = new Map<
        string,
        Array<{ start: number; end: number }>
      >();
      for (const doc of dayBlocksSnap.docs) {
        const d = doc.data();
        const bId = String(d.barberId ?? '');
        const bStart = d.allDay
          ? timeToMinutes(DEFAULT_OPEN_TIME)
          : timeToMinutes(String(d.startTime));
        const bEnd = d.allDay
          ? timeToMinutes(DEFAULT_CLOSE_TIME)
          : timeToMinutes(String(d.endTime));
        const list = blocksByBarber.get(bId) ?? [];
        list.push({ start: bStart, end: bEnd });
        blocksByBarber.set(bId, list);
      }

      let chosenBarber: {
        id: string;
        userId: string;
        name: string;
        slots: Array<{ slotKey: string; slotTime: string }>;
      } | null = null;

      for (let i = 0; i < candidateBarberIds.length; i++) {
        const bId = candidateBarberIds[i];
        const barberSnap = barberSnaps[i];
        if (!barberSnap.exists || !barberSnap.data()?.active) continue;

        const slots = candidateLocks[i].slots;
        const hasOccupancyCollision = slots.some(
          (s) => lockExistsByKey.get(s.slotKey) === true
        );
        if (hasOccupancyCollision) continue;

        const barberAppts = activeApptsByBarber.get(bId) ?? [];
        const hasAppointmentOverlap = barberAppts.some((a) =>
          intervalsOverlap(startMinutes, endMinutes, a.start, a.end)
        );
        if (hasAppointmentOverlap) continue;

        const globalBlocks = blocksByBarber.get('all') ?? [];
        const personalBlocks = blocksByBarber.get(bId) ?? [];
        const hasBlockOverlap = [...globalBlocks, ...personalBlocks].some((bl) =>
          intervalsOverlap(startMinutes, endMinutes, bl.start, bl.end)
        );
        if (hasBlockOverlap) continue;

        const barberData = barberSnap.data()!;
        chosenBarber = {
          id: bId,
          userId: String(barberData.userId ?? ''),
          name: String(barberData.name ?? bId),
          slots,
        };
        break;
      }

      if (!chosenBarber) {
        throw new BookingConflictError(
          'Lo sentimos, ese horario acaba de ser reservado por otro cliente. Selecciona otra hora disponible.'
        );
      }

      // Escrituras atómicas dentro de la transacción (después de todas las lecturas)
      for (const slot of chosenBarber.slots) {
        tx.set(db.collection('ocupacion').doc(slot.slotKey), {
          barberId: chosenBarber.id,
          date: input.date,
          slotTime: slot.slotTime,
          appointmentId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      if (clientSnap.exists) {
        tx.update(clientRef, {
          fullName: normalizedFullName,
          phone: normalizedPhone,
          email: normalizedEmail,
          totalAppointments: FieldValue.increment(1),
          lastAppointmentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.set(clientRef, {
          id: clientId,
          fullName: normalizedFullName,
          phone: normalizedPhone,
          email: normalizedEmail,
          totalAppointments: 1,
          lastAppointmentAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const citaPayload: Record<string, unknown> = {
        id: appointmentId,
        clientId,
        clientName: normalizedFullName,
        clientPhone: normalizedPhone,
        clientEmail: normalizedEmail,
        barberId: chosenBarber.id,
        barberUid: chosenBarber.userId,
        barberName: chosenBarber.name,
        serviceId: input.serviceId,
        serviceName,
        priceCop,
        durationMinutes,
        date: input.date,
        startTime: input.startTime,
        endTime,
        status: AppointmentStatus.CONFIRMED,
        bookingCode,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (trimmedNotes) {
        citaPayload.notes = trimmedNotes;
      }

      tx.set(db.collection('citas').doc(appointmentId), citaPayload);

      const nowIso = new Date().toISOString();
      const resultAppointment: Appointment = {
        id: appointmentId,
        clientId,
        clientName: normalizedFullName,
        clientPhone: normalizedPhone,
        clientEmail: normalizedEmail,
        barberId: chosenBarber.id,
        barberUid: chosenBarber.userId,
        barberName: chosenBarber.name,
        serviceId: input.serviceId,
        serviceName,
        priceCop,
        durationMinutes,
        date: input.date,
        startTime: input.startTime,
        endTime,
        status: AppointmentStatus.CONFIRMED,
        notes: trimmedNotes,
        bookingCode,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      return resultAppointment;
    });

    return {
      appointment: createdAppointment,
      summary: toPublicSummary(
        createdAppointment.id,
        createdAppointment as unknown as Record<string, unknown>
      ),
    };
  }

  // Modo vista previa sin Service Account: requiere sesión autenticada de administrador
  if (!idToken) {
    throw new BookingConfigurationError(
      'Faltan credenciales de servidor Firebase Admin (FIREBASE_ADMIN_CLIENT_EMAIL y FIREBASE_ADMIN_PRIVATE_KEY) para registrar reservas públicas sin iniciar sesión.'
    );
  }

  const chosenBarberId = slotDetail.availableBarberIds[0];
  const [serviceSnap, barberSnap, clientSnap] = await Promise.all([
    serverGetDoc('servicios', input.serviceId, idToken),
    serverGetDoc('barberos', chosenBarberId, idToken),
    serverGetDoc('clientes', clientId, idToken),
  ]);

  if (!serviceSnap.exists || !serviceSnap.data?.active) {
    throw new BookingValidationError(
      'El servicio seleccionado no está disponible.'
    );
  }
  if (!barberSnap.exists || !barberSnap.data?.active) {
    throw new BookingConflictError(
      'El barbero seleccionado ya no está disponible.'
    );
  }

  const durationMinutes = Number(serviceSnap.data.durationMinutes);
  const priceCop = Number(serviceSnap.data.priceCop);
  const serviceName = String(serviceSnap.data.name);
  const barberUid = String(barberSnap.data.userId ?? '');
  const barberName = String(barberSnap.data.name ?? chosenBarberId);
  const endTime = minutesToTime(
    timeToMinutes(input.startTime) + durationMinutes
  );

  const occupancySlots = buildOccupancySlotKeys(
    chosenBarberId,
    input.date,
    input.startTime,
    durationMinutes
  );

  const ops: ServerBatchOperation[] = occupancySlots.map((slot) => ({
    type: 'set',
    collection: 'ocupacion',
    docId: slot.slotKey,
    preconditionExists: false,
    data: {
      barberId: chosenBarberId,
      date: input.date,
      slotTime: slot.slotTime,
      appointmentId,
    },
    serverTimestampFields: ['createdAt'],
  }));

  if (clientSnap.exists && clientSnap.data) {
    const prevCount = Number(clientSnap.data.totalAppointments ?? 0);
    ops.push({
      type: 'update',
      collection: 'clientes',
      docId: clientId,
      data: {
        fullName: normalizedFullName,
        phone: normalizedPhone,
        email: normalizedEmail,
        totalAppointments: prevCount + 1,
      },
      serverTimestampFields: ['lastAppointmentAt', 'updatedAt'],
    });
  } else {
    ops.push({
      type: 'set',
      collection: 'clientes',
      docId: clientId,
      preconditionExists: false,
      data: {
        id: clientId,
        fullName: normalizedFullName,
        phone: normalizedPhone,
        email: normalizedEmail,
        totalAppointments: 1,
      },
      serverTimestampFields: ['lastAppointmentAt', 'createdAt', 'updatedAt'],
    });
  }

  const citaPayload: Record<string, unknown> = {
    id: appointmentId,
    clientId,
    clientName: normalizedFullName,
    clientPhone: normalizedPhone,
    clientEmail: normalizedEmail,
    barberId: chosenBarberId,
    barberUid,
    barberName,
    serviceId: input.serviceId,
    serviceName,
    priceCop,
    durationMinutes,
    date: input.date,
    startTime: input.startTime,
    endTime,
    status: AppointmentStatus.CONFIRMED,
    bookingCode,
  };
  if (trimmedNotes) {
    citaPayload.notes = trimmedNotes;
  }

  ops.push({
    type: 'set',
    collection: 'citas',
    docId: appointmentId,
    preconditionExists: false,
    data: citaPayload,
    serverTimestampFields: ['createdAt', 'updatedAt'],
  });

  try {
    await serverCommitWrites(ops, idToken);
  } catch (error) {
    if (
      error instanceof FirestoreRestPermissionError &&
      (error.status === 409 || error.message.includes('ALREADY_EXISTS'))
    ) {
      throw new BookingConflictError(
        'Lo sentimos, ese horario acaba de ser reservado por otro cliente. Elige otra hora disponible.'
      );
    }
    throw error;
  }

  const nowIso = new Date().toISOString();
  const appointment: Appointment = {
    id: appointmentId,
    clientId,
    clientName: normalizedFullName,
    clientPhone: normalizedPhone,
    clientEmail: normalizedEmail,
    barberId: chosenBarberId,
    barberUid,
    barberName,
    serviceId: input.serviceId,
    serviceName,
    priceCop,
    durationMinutes,
    date: input.date,
    startTime: input.startTime,
    endTime,
    status: AppointmentStatus.CONFIRMED,
    notes: trimmedNotes,
    bookingCode,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    appointment,
    summary: toPublicSummary(appointment.id, citaPayload),
  };
}

async function resolveBookingDocByProof(
  proof: BookingAuthProof,
  idToken?: string
): Promise<ServerDocSnapshot> {
  if (!hasAdminServiceAccount() && !idToken) {
    throw new BookingConfigurationError(
      'Faltan credenciales de servidor Firebase Admin (FIREBASE_ADMIN_CLIENT_EMAIL y FIREBASE_ADMIN_PRIVATE_KEY) para consultar reservas.'
    );
  }

  if ('manageToken' in proof) {
    const verified = verifyBookingManageToken(proof.manageToken);
    if (!verified) {
      throw new BookingValidationError(
        'El enlace o token de gestión expiró o no es válido. Usa tu código de reserva y correo electrónico.'
      );
    }
    const snap = await serverGetDoc('citas', verified.appointmentId, idToken);
    if (!snap.exists || !snap.data) {
      throw new BookingNotFoundError('No encontramos una reserva con esos datos.');
    }
    if (
      String(snap.data.clientEmail ?? '').trim().toLowerCase() !== verified.email
    ) {
      throw new BookingNotFoundError('No encontramos una reserva con esos datos.');
    }
    return snap;
  }

  const normalizedCode = proof.bookingCode.trim().toUpperCase();
  const normalizedEmail = proof.email.trim().toLowerCase();

  const matches = await serverQueryCollection(
    'citas',
    { filters: [{ field: 'bookingCode', op: '==', value: normalizedCode }] },
    idToken
  );

  const matchedDoc = matches.find(
    (doc) =>
      String(doc.data?.clientEmail ?? '').trim().toLowerCase() ===
      normalizedEmail
  );

  if (!matchedDoc || !matchedDoc.data) {
    throw new BookingNotFoundError(
      'No encontramos ninguna reserva que coincida con ese código y correo electrónico.'
    );
  }

  return matchedDoc;
}

export async function lookupPublicBooking(
  proof: BookingAuthProof,
  idToken?: string
): Promise<PublicBookingSummary> {
  const doc = await resolveBookingDocByProof(proof, idToken);
  return toPublicSummary(doc.id, doc.data!);
}

export async function cancelPublicBooking(
  proof: BookingAuthProof,
  idToken?: string
): Promise<PublicBookingSummary> {
  const doc = await resolveBookingDocByProof(proof, idToken);
  const existing = doc.data!;
  const status = String(existing.status ?? '');
  const date = String(existing.date ?? '');
  const startTime = String(existing.startTime ?? '');
  const durationMinutes = Number(existing.durationMinutes ?? 30);
  const barberId = String(existing.barberId ?? '');

  if (status === AppointmentStatus.CANCELLED) {
    throw new BookingValidationError('Esta reserva ya había sido cancelada.');
  }
  if (!isAppointmentModifiable(status, date, startTime)) {
    throw new BookingValidationError(
      'Solo es posible cancelar citas confirmadas cuyo horario aún no ha iniciado.'
    );
  }

  const lockKeys = buildOccupancySlotKeys(
    barberId,
    date,
    startTime,
    durationMinutes
  ).map((s) => s.slotKey);

  if (hasAdminServiceAccount()) {
    const db = getAdminDb();
    await db.runTransaction(async (tx) => {
      const citaRef = db.collection('citas').doc(doc.id);
      const occQuery = db
        .collection('ocupacion')
        .where('appointmentId', '==', doc.id);

      const [freshSnap, occSnap] = await Promise.all([
        tx.get(citaRef),
        tx.get(occQuery),
      ]);

      if (!freshSnap.exists) {
        throw new BookingNotFoundError('La reserva ya no existe.');
      }
      const freshData = freshSnap.data()!;
      if (freshData.status !== AppointmentStatus.CONFIRMED) {
        throw new BookingValidationError(
          'Esta reserva ya no puede modificarse.'
        );
      }

      const deleteRefs = new Map<string, FirebaseFirestore.DocumentReference>();
      for (const k of lockKeys) {
        deleteRefs.set(k, db.collection('ocupacion').doc(k));
      }
      for (const oDoc of occSnap.docs) {
        deleteRefs.set(oDoc.id, oDoc.ref);
      }

      for (const ref of deleteRefs.values()) {
        tx.delete(ref);
      }
      tx.update(citaRef, {
        status: AppointmentStatus.CANCELLED,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } else {
    const ops: ServerBatchOperation[] = [
      {
        type: 'update',
        collection: 'citas',
        docId: doc.id,
        data: { status: AppointmentStatus.CANCELLED },
        serverTimestampFields: ['updatedAt'],
      },
      ...lockKeys.map((k) => ({
        type: 'delete' as const,
        collection: 'ocupacion',
        docId: k,
      })),
    ];
    await serverCommitWrites(ops, idToken);
  }

  return toPublicSummary(doc.id, {
    ...existing,
    status: AppointmentStatus.CANCELLED,
    updatedAt: serializeTimestamp(new Date().toISOString()),
  });
}

export async function reschedulePublicBooking(
  proof: BookingAuthProof,
  newSlot: { date: string; startTime: string; barberId?: string },
  idToken?: string
): Promise<PublicBookingSummary> {
  const doc = await resolveBookingDocByProof(proof, idToken);
  const existing = doc.data!;

  const status = String(existing.status ?? '');
  const oldDate = String(existing.date ?? '');
  const oldStartTime = String(existing.startTime ?? '');
  const oldBarberId = String(existing.barberId ?? '');
  const serviceId = String(existing.serviceId ?? '');
  const durationMinutes = Number(existing.durationMinutes ?? 30);

  if (!isAppointmentModifiable(status, oldDate, oldStartTime)) {
    throw new BookingValidationError(
      'Solo es posible reprogramar citas confirmadas cuyo horario aún no ha iniciado.'
    );
  }

  const todayBogota = getBogotaDateString(new Date());
  if (newSlot.date < todayBogota) {
    throw new BookingValidationError(
      'No puedes reprogramar una cita para una fecha pasada.'
    );
  }

  const requestedBarberId = newSlot.barberId || oldBarberId;
  const availability = await checkAvailability({
    barberId: requestedBarberId,
    date: newSlot.date,
    serviceId,
    durationMinutes,
    excludeAppointmentId: doc.id,
  });

  if (!availability.isOpen) {
    throw new BookingValidationError(
      availability.reason ?? 'No hay atención en la fecha seleccionada.'
    );
  }

  const slotDetail = availability.slots.find(
    (s) => s.startTime === newSlot.startTime
  );
  if (!slotDetail || slotDetail.availableBarberIds.length === 0) {
    throw new BookingConflictError(
      'El nuevo horario elegido ya no está disponible. Selecciona otra hora.'
    );
  }

  const newEndTime = minutesToTime(
    timeToMinutes(newSlot.startTime) + durationMinutes
  );
  const oldLockSlots = buildOccupancySlotKeys(
    oldBarberId,
    oldDate,
    oldStartTime,
    durationMinutes
  );

  if (hasAdminServiceAccount()) {
    const db = getAdminDb();
    const candidateBarberIds =
      requestedBarberId === 'any'
        ? slotDetail.availableBarberIds
        : [requestedBarberId];

    const updatedFields = await db.runTransaction(async (tx) => {
      const citaRef = db.collection('citas').doc(doc.id);
      const barberRefs = candidateBarberIds.map((bId) =>
        db.collection('barberos').doc(bId)
      );
      const candidateLocks = candidateBarberIds.map((bId) => ({
        barberId: bId,
        slots: buildOccupancySlotKeys(
          bId,
          newSlot.date,
          newSlot.startTime,
          durationMinutes
        ),
      }));
      const newLockRefs = candidateLocks.flatMap((c) =>
        c.slots.map((s) => db.collection('ocupacion').doc(s.slotKey))
      );

      const [freshSnap, barberSnaps, dayApptsSnap, existingLocksSnap, flatNewLocks] =
        await Promise.all([
          tx.get(citaRef),
          Promise.all(barberRefs.map((r) => tx.get(r))),
          tx.get(db.collection('citas').where('date', '==', newSlot.date)),
          tx.get(db.collection('ocupacion').where('appointmentId', '==', doc.id)),
          newLockRefs.length > 0
            ? tx.getAll(...newLockRefs)
            : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
        ]);

      if (!freshSnap.exists) {
        throw new BookingNotFoundError('La reserva ya no existe.');
      }
      if (freshSnap.data()?.status !== AppointmentStatus.CONFIRMED) {
        throw new BookingValidationError(
          'Esta reserva ya no se encuentra confirmada.'
        );
      }

      const lockOwnerByKey = new Map<string, string>();
      for (const lSnap of flatNewLocks) {
        if (lSnap.exists) {
          lockOwnerByKey.set(
            lSnap.id,
            String(lSnap.data()?.appointmentId ?? '')
          );
        }
      }

      const startMin = timeToMinutes(newSlot.startTime);
      const endMin = startMin + durationMinutes;

      let chosen: {
        id: string;
        userId: string;
        name: string;
        slots: Array<{ slotKey: string; slotTime: string }>;
      } | null = null;

      for (let i = 0; i < candidateBarberIds.length; i++) {
        const bId = candidateBarberIds[i];
        const bSnap = barberSnaps[i];
        if (!bSnap.exists || !bSnap.data()?.active) continue;

        const slots = candidateLocks[i].slots;
        const hasLockConflict = slots.some((s) => {
          const owner = lockOwnerByKey.get(s.slotKey);
          return Boolean(owner && owner !== doc.id);
        });
        if (hasLockConflict) continue;

        const hasApptOverlap = dayApptsSnap.docs.some((aDoc) => {
          if (aDoc.id === doc.id) return false;
          const d = aDoc.data();
          if (String(d.barberId) !== bId) return false;
          if (NON_BLOCKING_STATUSES.has(String(d.status ?? ''))) return false;
          return intervalsOverlap(
            startMin,
            endMin,
            timeToMinutes(String(d.startTime)),
            timeToMinutes(String(d.endTime))
          );
        });
        if (hasApptOverlap) continue;

        chosen = {
          id: bId,
          userId: String(bSnap.data()?.userId ?? ''),
          name: String(bSnap.data()?.name ?? bId),
          slots,
        };
        break;
      }

      if (!chosen) {
        throw new BookingConflictError(
          'Ese nuevo horario acaba de ser tomado. Selecciona otro disponible.'
        );
      }

      const newSlotKeySet = new Set(chosen.slots.map((s) => s.slotKey));

      // Borrar bloqueos anteriores que no coinciden con los nuevos
      const refsToDelete = new Map<string, FirebaseFirestore.DocumentReference>();
      for (const s of oldLockSlots) {
        if (!newSlotKeySet.has(s.slotKey)) {
          refsToDelete.set(s.slotKey, db.collection('ocupacion').doc(s.slotKey));
        }
      }
      for (const eDoc of existingLocksSnap.docs) {
        if (!newSlotKeySet.has(eDoc.id)) {
          refsToDelete.set(eDoc.id, eDoc.ref);
        }
      }
      for (const ref of refsToDelete.values()) {
        tx.delete(ref);
      }

      // Crear los nuevos bloqueos faltantes
      for (const slot of chosen.slots) {
        if (lockOwnerByKey.get(slot.slotKey) !== doc.id) {
          tx.set(db.collection('ocupacion').doc(slot.slotKey), {
            barberId: chosen.id,
            date: newSlot.date,
            slotTime: slot.slotTime,
            appointmentId: doc.id,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      const updatedPayload = {
        barberId: chosen.id,
        barberUid: chosen.userId,
        barberName: chosen.name,
        date: newSlot.date,
        startTime: newSlot.startTime,
        endTime: newEndTime,
      };

      tx.update(citaRef, {
        ...updatedPayload,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return updatedPayload;
    });

    return toPublicSummary(doc.id, {
      ...existing,
      ...updatedFields,
    });
  }

  // Modo vista previa sin Service Account (con idToken de administrador)
  const chosenBarberId = slotDetail.availableBarberIds[0];
  const barberSnap = await serverGetDoc('barberos', chosenBarberId, idToken);
  if (!barberSnap.exists || !barberSnap.data?.active) {
    throw new BookingConflictError('El barbero seleccionado no está activo.');
  }

  const newSlots = buildOccupancySlotKeys(
    chosenBarberId,
    newSlot.date,
    newSlot.startTime,
    durationMinutes
  );
  const oldSet = new Set(oldLockSlots.map((s) => s.slotKey));
  const newSet = new Set(newSlots.map((s) => s.slotKey));

  const ops: ServerBatchOperation[] = [
    ...oldLockSlots
      .filter((s) => !newSet.has(s.slotKey))
      .map((s) => ({
        type: 'delete' as const,
        collection: 'ocupacion',
        docId: s.slotKey,
      })),
    ...newSlots
      .filter((s) => !oldSet.has(s.slotKey))
      .map((s) => ({
        type: 'set' as const,
        collection: 'ocupacion',
        docId: s.slotKey,
        preconditionExists: false,
        data: {
          barberId: chosenBarberId,
          date: newSlot.date,
          slotTime: s.slotTime,
          appointmentId: doc.id,
        },
        serverTimestampFields: ['createdAt'],
      })),
    {
      type: 'update',
      collection: 'citas',
      docId: doc.id,
      data: {
        barberId: chosenBarberId,
        barberUid: String(barberSnap.data.userId ?? ''),
        barberName: String(barberSnap.data.name ?? chosenBarberId),
        date: newSlot.date,
        startTime: newSlot.startTime,
        endTime: newEndTime,
      },
      serverTimestampFields: ['updatedAt'],
    },
  ];

  try {
    await serverCommitWrites(ops, idToken);
  } catch (error) {
    if (
      error instanceof FirestoreRestPermissionError &&
      (error.status === 409 || error.message.includes('ALREADY_EXISTS'))
    ) {
      throw new BookingConflictError(
        'Ese nuevo horario acaba de ser tomado. Selecciona otro disponible.'
      );
    }
    throw error;
  }

  return toPublicSummary(doc.id, {
    ...existing,
    barberId: chosenBarberId,
    barberUid: String(barberSnap.data.userId ?? ''),
    barberName: String(barberSnap.data.name ?? chosenBarberId),
    date: newSlot.date,
    startTime: newSlot.startTime,
    endTime: newEndTime,
  });
}
