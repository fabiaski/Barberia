import { getDayOfWeekBogota, generateScheduleTimeSlots } from '@/lib/utils/schedule-slots';
import {
  formatTime12h,
  getBogotaDateString,
  getBogotaTimeString,
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

const ACTIVE_APPOINTMENT_STATUSES = new Set<string>([
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
]);

export function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && endA > startB;
}

export function clampDayScheduleToOperatingWindow(
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

export function resolveEffectiveDaySchedule(
  date: string,
  barberDays: DaySchedule[] | undefined,
  generalDays: DaySchedule[] | undefined
): DaySchedule {
  const dayOfWeek = getDayOfWeekBogota(date);
  const barberDay = barberDays?.find((d) => d.dayOfWeek === dayOfWeek);
  const generalDay = generalDays?.find((d) => d.dayOfWeek === dayOfWeek);
  const fallbackDay = DEFAULT_WEEK_SCHEDULE.find(
    (d) => d.dayOfWeek === dayOfWeek
  )!;

  return clampDayScheduleToOperatingWindow(barberDay ?? generalDay ?? fallbackDay);
}

export interface BlockValidationAppointmentRef {
  id: string;
  barberId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  clientName?: string;
}

export interface BlockValidationExistingBlockRef {
  id: string;
  barberId: string;
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
}

export type BlockValidationResult =
  | {
      ok: true;
      blockStart: string;
      blockEnd: string;
      deactivatedSlots: string[];
      deactivatedCount: number;
      summaryMessage: string;
    }
  | {
      ok: false;
      status: 400 | 409;
      code: 'INVALID_BLOCK' | 'APPOINTMENT_CONFLICT' | 'DUPLICATE_BLOCK';
      error: string;
    };

export function validateAndComputeBlockedSlots(params: {
  barberId: string; // ID del barbero o 'all'
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  daySchedules: DaySchedule[]; // Uno o varios (para 'all')
  slotIntervalMinutes: number;
  minServiceDurationMinutes?: number;
  existingAppointments: BlockValidationAppointmentRef[];
  existingBlocks: BlockValidationExistingBlockRef[];
  now?: Date;
}): BlockValidationResult {
  const {
    barberId,
    date,
    allDay,
    startTime,
    endTime,
    daySchedules,
    slotIntervalMinutes,
    minServiceDurationMinutes,
    existingAppointments,
    existingBlocks,
    now = new Date(),
  } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_BLOCK',
      error: 'Formato de fecha inválido. Usa el formato AAAA-MM-DD.',
    };
  }

  const todayBogota = getBogotaDateString(now);
  const nowMinutesBogota = timeToMinutes(getBogotaTimeString(now));

  if (date < todayBogota) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_BLOCK',
      error: 'No puedes crear bloqueos en fechas pasadas.',
    };
  }

  let blockStart = '00:00';
  let blockEnd = '23:59';

  if (!allDay) {
    if (
      !startTime ||
      !endTime ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
    ) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_BLOCK',
        error:
          'Para bloqueos por rango horario debes indicar hora inicial y hora final válidas.',
      };
    }

    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    if (endMin <= startMin) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_BLOCK',
        error: 'La hora final del bloqueo debe ser posterior a la hora inicial.',
      };
    }

    if (date === todayBogota && endMin <= nowMinutesBogota) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_BLOCK',
        error:
          'El rango horario seleccionado para hoy ya transcurrió. Elige un horario futuro.',
      };
    }

    blockStart = startTime;
    blockEnd = endTime;
  }

  const blockStartMin = timeToMinutes(blockStart);
  const blockEndMin = timeToMinutes(blockEnd);

  // 1. Verificar que no existan citas confirmadas o en proceso traslapadas con el bloqueo
  const conflictingAppointments = existingAppointments
    .filter((appt) => {
      if (appt.date !== date) return false;
      if (!ACTIVE_APPOINTMENT_STATUSES.has(appt.status)) return false;
      if (barberId !== 'all' && appt.barberId !== barberId) return false;
      if (!appt.startTime || !appt.endTime) return false;
      return intervalsOverlap(
        blockStartMin,
        blockEndMin,
        timeToMinutes(appt.startTime),
        timeToMinutes(appt.endTime)
      );
    })
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  if (conflictingAppointments.length > 0) {
    const first = conflictingAppointments[0];
    const clientLabel = first.clientName ? ` con ${first.clientName}` : '';
    const rangeLabel = `${formatTime12h(first.startTime)} – ${formatTime12h(first.endTime)}`;

    if (conflictingAppointments.length === 1) {
      return {
        ok: false,
        status: 409,
        code: 'APPOINTMENT_CONFLICT',
        error: `No puedes bloquear este horario porque ya existe una cita activa${clientLabel} (${rangeLabel}). Cancélala o finalízala primero.`,
      };
    }

    return {
      ok: false,
      status: 409,
      code: 'APPOINTMENT_CONFLICT',
      error: `No puedes bloquear este horario porque hay ${conflictingAppointments.length} citas activas programadas en ese lapso (la primera${clientLabel} a las ${formatTime12h(first.startTime)}). Cancélalas o reprográmalas primero.`,
    };
  }

  // 2. Verificar bloqueos duplicados o redundantes que ya cubran exactamente este rango
  const relevantExistingBlocks = existingBlocks.filter((b) => {
    if (b.date !== date) return false;
    if (barberId === 'all') {
      return b.barberId === 'all';
    }
    return b.barberId === barberId || b.barberId === 'all';
  });

  for (const b of relevantExistingBlocks) {
    if (b.allDay) {
      return {
        ok: false,
        status: 409,
        code: 'DUPLICATE_BLOCK',
        error: 'Ya existe un bloqueo de día completo activo para esa fecha.',
      };
    }
    if (b.startTime && b.endTime) {
      const exStart = timeToMinutes(b.startTime);
      const exEnd = timeToMinutes(b.endTime);
      if (!allDay && exStart <= blockStartMin && exEnd >= blockEndMin) {
        return {
          ok: false,
          status: 409,
          code: 'DUPLICATE_BLOCK',
          error: `Ya existe un bloqueo registrado que cubre ese rango horario (${formatTime12h(
            b.startTime
          )} – ${formatTime12h(b.endTime)}).`,
        };
      }
    }
  }

  // 3. Calcular todos los turnos disponibles que quedan desactivados automáticamente
  const effectiveSlotSpan = Math.min(
    slotIntervalMinutes || 30,
    minServiceDurationMinutes && minServiceDurationMinutes > 0
      ? minServiceDurationMinutes
      : slotIntervalMinutes || 30
  );

  const deactivatedSlotSet = new Set<string>();
  const existingBlockIntervals = relevantExistingBlocks
    .map((b) => ({
      start: b.allDay ? 0 : timeToMinutes(b.startTime ?? '00:00'),
      end: b.allDay ? 23 * 60 + 59 : timeToMinutes(b.endTime ?? '00:00'),
    }))
    .filter((b) => b.end > b.start);

  for (const schedule of daySchedules) {
    if (!schedule.isOpen) continue;
    const candidates = generateScheduleTimeSlots({
      date,
      daySchedule: schedule,
      durationMinutes: effectiveSlotSpan,
      intervalMinutes: slotIntervalMinutes || 30,
      now,
    });

    for (const slot of candidates) {
      const slotStartMin = timeToMinutes(slot);
      const slotEndMin = slotStartMin + effectiveSlotSpan;

      const alreadyBlocked = existingBlockIntervals.some((ex) =>
        intervalsOverlap(slotStartMin, slotEndMin, ex.start, ex.end)
      );
      if (alreadyBlocked) continue;

      if (intervalsOverlap(slotStartMin, slotEndMin, blockStartMin, blockEndMin)) {
        deactivatedSlotSet.add(slot);
      }
    }
  }

  const deactivatedSlots = Array.from(deactivatedSlotSet).sort(
    (a, b) => timeToMinutes(a) - timeToMinutes(b)
  );
  const deactivatedCount = deactivatedSlots.length;

  let summaryMessage: string;
  if (deactivatedCount > 0) {
    const firstLabel = formatTime12h(deactivatedSlots[0]);
    const lastLabel = formatTime12h(deactivatedSlots[deactivatedCount - 1]);
    const rangeText =
      deactivatedCount === 1 ? firstLabel : `${firstLabel} a ${lastLabel}`;
    summaryMessage = `Bloqueo guardado. Se desactivaron automáticamente ${deactivatedCount} ${
      deactivatedCount === 1 ? 'turno disponible' : 'turnos disponibles'
    } (${rangeText}), impidiendo nuevas reservas públicas en ese lapso.`;
  } else {
    summaryMessage =
      'Bloqueo guardado correctamente. No había turnos públicos habilitados en ese horario, y el lapso quedó protegido contra futuras reservas.';
  }

  return {
    ok: true,
    blockStart,
    blockEnd,
    deactivatedSlots,
    deactivatedCount,
    summaryMessage,
  };
}
