import { APPOINTMENT_STATUS_LABELS, SYSTEM_TIMEZONE } from '@/lib/constants/config';
import { AppointmentStatus, type Appointment } from '@/types';

export interface CalendarDayCell {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

export interface MonthlyCalendarGrid {
  yearMonth: string; // YYYY-MM
  year: number;
  month: number; // 1-12
  titleEs: string;
  gridStartDate: string; // YYYY-MM-DD (Lunes)
  gridEndDate: string; // YYYY-MM-DD (Domingo)
  monthStartDate: string; // YYYY-MM-01
  monthEndDate: string; // YYYY-MM-DD
  cells: CalendarDayCell[];
}

export interface MonthAppointmentsSummary {
  total: number;
  active: number;
  completed: number;
  cancelledOrNoShow: number;
  projectedRevenueCop: number;
  completedRevenueCop: number;
}

const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

export const CALENDAR_WEEKDAYS_ES = [
  'Lun',
  'Mar',
  'Mié',
  'Jue',
  'Vie',
  'Sáb',
  'Dom',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatUtcYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function getBogotaYearMonth(todayBogota: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(todayBogota)) {
    return todayBogota.slice(0, 7);
  }
  return '2026-01';
}

export function parseYearMonth(yearMonth: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!match) {
    return { year: 2026, month: 1 };
  }
  const year = Number(match[1]);
  const month = Math.min(12, Math.max(1, Number(match[2])));
  return { year, month };
}

export function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const { year, month } = parseYearMonth(yearMonth);
  const shifted = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}`;
}

export function formatMonthTitleEs(yearMonth: string): string {
  const { year, month } = parseYearMonth(yearMonth);
  const name = MONTHS_ES[month - 1] ?? MONTHS_ES[0];
  return `${name} ${year}`;
}

export function formatFullDateEs(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: SYSTEM_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Construye una grilla mensual de lunes a domingo (5 o 6 semanas) sin desfase
 * de zona horaria, marcando el día actual en America/Bogota.
 */
export function buildMonthlyCalendarGrid(
  yearMonth: string,
  todayBogota: string
): MonthlyCalendarGrid {
  const { year, month } = parseYearMonth(yearMonth);
  const normalizedYm = `${year}-${pad2(month)}`;
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const lastOfMonth = new Date(Date.UTC(year, month, 0));

  // Convertir domingo (0) -> 6, lunes (1) -> 0 ... sábado (6) -> 5
  const firstWeekdayMonStart = (firstOfMonth.getUTCDay() + 6) % 7;
  const lastWeekdayMonStart = (lastOfMonth.getUTCDay() + 6) % 7;
  const trailingDays = 6 - lastWeekdayMonStart;

  const gridStart = new Date(
    Date.UTC(year, month - 1, 1 - firstWeekdayMonStart)
  );
  const totalDays =
    firstWeekdayMonStart + lastOfMonth.getUTCDate() + trailingDays;

  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < totalDays; i++) {
    const current = new Date(
      Date.UTC(
        gridStart.getUTCFullYear(),
        gridStart.getUTCMonth(),
        gridStart.getUTCDate() + i
      )
    );
    const dateStr = formatUtcYmd(current);
    cells.push({
      date: dateStr,
      dayNumber: current.getUTCDate(),
      inCurrentMonth: dateStr.startsWith(`${normalizedYm}-`),
      isToday: dateStr === todayBogota,
    });
  }

  return {
    yearMonth: normalizedYm,
    year,
    month,
    titleEs: formatMonthTitleEs(normalizedYm),
    gridStartDate: cells[0]?.date ?? formatUtcYmd(firstOfMonth),
    gridEndDate: cells[cells.length - 1]?.date ?? formatUtcYmd(lastOfMonth),
    monthStartDate: formatUtcYmd(firstOfMonth),
    monthEndDate: formatUtcYmd(lastOfMonth),
    cells,
  };
}

export function groupAppointmentsByDate(
  appointments: Appointment[]
): Record<string, Appointment[]> {
  const grouped: Record<string, Appointment[]> = {};

  for (const appt of appointments) {
    if (!appt.date) continue;
    if (!grouped[appt.date]) {
      grouped[appt.date] = [];
    }
    grouped[appt.date].push(appt);
  }

  for (const dateKey of Object.keys(grouped)) {
    grouped[dateKey].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  return grouped;
}

export function summarizeMonthAppointments(
  appointments: Appointment[],
  yearMonth: string
): MonthAppointmentsSummary {
  const prefix = `${yearMonth}-`;
  let total = 0;
  let active = 0;
  let completed = 0;
  let cancelledOrNoShow = 0;
  let projectedRevenueCop = 0;
  let completedRevenueCop = 0;

  for (const appt of appointments) {
    if (!appt.date.startsWith(prefix)) continue;
    total += 1;

    if (
      appt.status === AppointmentStatus.CONFIRMED ||
      appt.status === AppointmentStatus.IN_PROGRESS
    ) {
      active += 1;
      projectedRevenueCop += appt.priceCop;
    } else if (appt.status === AppointmentStatus.COMPLETED) {
      completed += 1;
      completedRevenueCop += appt.priceCop;
      projectedRevenueCop += appt.priceCop;
    } else {
      cancelledOrNoShow += 1;
    }
  }

  return {
    total,
    active,
    completed,
    cancelledOrNoShow,
    projectedRevenueCop,
    completedRevenueCop,
  };
}

export function getShortStatusLabelEs(status: AppointmentStatus): string {
  switch (status) {
    case AppointmentStatus.CONFIRMED:
      return 'Confirmada';
    case AppointmentStatus.IN_PROGRESS:
      return 'En curso';
    case AppointmentStatus.COMPLETED:
      return 'Finalizada';
    case AppointmentStatus.CANCELLED:
      return 'Cancelada';
    case AppointmentStatus.NO_SHOW:
      return 'No asistió';
    default:
      return APPOINTMENT_STATUS_LABELS[status] ?? String(status);
  }
}
