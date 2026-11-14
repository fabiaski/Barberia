import { SYSTEM_TIMEZONE } from '@/lib/constants/config';

/**
 * Obtiene la fecha actual en formato YYYY-MM-DD en la zona horaria America/Bogota.
 */
export function getBogotaDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYSTEM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Obtiene la hora actual en formato HH:mm (24h) en la zona horaria America/Bogota.
 */
export function getBogotaTimeString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYSTEM_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.format(date);
}

/**
 * Formatea fecha y hora legible para Colombia (America/Bogota).
 */
export function formatBogotaDateTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: SYSTEM_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Convierte una hora HH:mm en minutos transcurridos desde medianoche.
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convierte minutos desde medianoche al formato HH:mm.
 */
export function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Convierte HH:mm (24h) a formato legible 12h (ej. "8:00 AM", "2:30 PM").
 */
export function formatTime12h(time24: string): string {
  if (!time24 || !time24.includes(':')) return time24;
  const [rawHours, rawMinutes] = time24.split(':').map(Number);
  const period = rawHours >= 12 ? 'PM' : 'AM';
  const hours12 = rawHours % 12 === 0 ? 12 : rawHours % 12;
  return `${hours12}:${String(rawMinutes).padStart(2, '0')} ${period}`;
}

/**
 * Formatea un valor numérico en pesos colombianos (COP).
 */
export function formatCurrencyCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount);
}
