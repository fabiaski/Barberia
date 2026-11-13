import { SYSTEM_TIMEZONE } from '@/lib/constants/config';
import {
  getBogotaDateString,
  getBogotaTimeString,
  minutesToTime,
  timeToMinutes,
} from '@/lib/utils/timezone';
import type { DaySchedule } from '@/types';

export interface UpcomingDateOption {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0..6
  dayShort: string;
  dayNumber: string;
  monthShort: string;
  fullLabel: string;
  isOpen: boolean;
}

/**
 * Obtiene el día de la semana (0 = Dom .. 6 = Sáb) para una fecha YYYY-MM-DD en America/Bogota.
 */
export function getDayOfWeekBogota(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Mediodía UTC evita desfases por cambio de día
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  const weekdayEn = new Intl.DateTimeFormat('en-US', {
    timeZone: SYSTEM_TIMEZONE,
    weekday: 'short',
  }).format(utcMidday);

  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekdayEn] ?? 0;
}

/**
 * Construye los próximos N días calendario en America/Bogota cruzando con el horario semanal.
 */
export function getUpcomingBookingDates(
  daysSchedule: DaySchedule[],
  totalDays: number = 14
): UpcomingDateOption[] {
  const todayStr = getBogotaDateString(new Date());
  const [y, m, d] = todayStr.split('-').map(Number);
  const options: UpcomingDateOption[] = [];

  for (let offset = 0; offset < totalDays; offset++) {
    const dateObj = new Date(Date.UTC(y, m - 1, d + offset, 17, 0, 0));
    const dateStr = getBogotaDateString(dateObj);
    const dayOfWeek = getDayOfWeekBogota(dateStr);
    const scheduleForDay = daysSchedule.find((item) => item.dayOfWeek === dayOfWeek);

    const dayShort = new Intl.DateTimeFormat('es-CO', {
      timeZone: SYSTEM_TIMEZONE,
      weekday: 'short',
    })
      .format(dateObj)
      .replace('.', '');

    const dayNumber = new Intl.DateTimeFormat('es-CO', {
      timeZone: SYSTEM_TIMEZONE,
      day: '2-digit',
    }).format(dateObj);

    const monthShort = new Intl.DateTimeFormat('es-CO', {
      timeZone: SYSTEM_TIMEZONE,
      month: 'short',
    })
      .format(dateObj)
      .replace('.', '');

    const fullLabel = new Intl.DateTimeFormat('es-CO', {
      timeZone: SYSTEM_TIMEZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(dateObj);

    options.push({
      date: dateStr,
      dayOfWeek,
      dayShort,
      dayNumber,
      monthShort,
      fullLabel,
      isOpen: Boolean(scheduleForDay?.isOpen),
    });
  }

  return options;
}

/**
 * Genera franjas de inicio disponibles según horario laboral, pausa de almuerzo y duración del servicio.
 */
export function generateScheduleTimeSlots(params: {
  date: string;
  daySchedule: DaySchedule | undefined;
  durationMinutes: number;
  intervalMinutes?: number;
}): string[] {
  const { date, daySchedule, durationMinutes, intervalMinutes = 30 } = params;
  if (!daySchedule || !daySchedule.isOpen) {
    return [];
  }

  const openMinutes = timeToMinutes(daySchedule.openTime);
  const closeMinutes = timeToMinutes(daySchedule.closeTime);
  const breakStart = daySchedule.breakStart
    ? timeToMinutes(daySchedule.breakStart)
    : null;
  const breakEnd = daySchedule.breakEnd
    ? timeToMinutes(daySchedule.breakEnd)
    : null;

  const todayBogota = getBogotaDateString(new Date());
  const nowMinutesBogota = timeToMinutes(getBogotaTimeString(new Date()));

  const slots: string[] = [];

  for (
    let start = openMinutes;
    start + durationMinutes <= closeMinutes;
    start += intervalMinutes
  ) {
    const end = start + durationMinutes;

    // Si es hoy en Colombia, exigir al menos 30 min de anticipación
    if (date === todayBogota && start < nowMinutesBogota + 30) {
      continue;
    }

    // Evitar traslape con descanso/almuerzo configurado
    if (breakStart !== null && breakEnd !== null) {
      const overlapsBreak = start < breakEnd && end > breakStart;
      if (overlapsBreak) {
        continue;
      }
    }

    slots.push(minutesToTime(start));
  }

  return slots;
}
