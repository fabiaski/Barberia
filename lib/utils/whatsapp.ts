import { SYSTEM_TIMEZONE } from '@/lib/constants/config';
import { formatTime12h } from '@/lib/utils/timezone';

export interface AppointmentWhatsAppParams {
  clientPhone: string;
  clientName: string;
  barberName: string;
  serviceName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  shopName?: string;
}

/**
 * Normaliza un número telefónico para enlaces wa.me (agrega código de país 57 para móviles colombianos de 10 dígitos).
 */
export function normalizeWhatsAppPhone(rawPhone: string): string | null {
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('00') && digits.length > 4) {
    digits = digits.slice(2);
  }

  if (trimmed.startsWith('+') && digits.length >= 10) {
    return digits;
  }

  if (digits.length === 10 && digits.startsWith('3')) {
    return `57${digits}`;
  }

  if (digits.length === 12 && digits.startsWith('57')) {
    return digits;
  }

  if (digits.length >= 7) {
    return digits;
  }

  return null;
}

function formatDateSpanish(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return dateStr;
  }
  const [year, month, day] = parts;
  const dt = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: SYSTEM_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(dt);
}

/**
 * Construye el texto prellenado en español para confirmar la asistencia de una cita por WhatsApp.
 */
export function buildAttendanceConfirmationMessage(
  params: Omit<AppointmentWhatsAppParams, 'clientPhone'>
): string {
  const clientName = params.clientName.trim() || 'cliente';
  const barberName = params.barberName.trim() || 'tu barbero';
  const shopName = params.shopName?.trim() || 'Barbería Estudio';
  const serviceName = params.serviceName.trim() || 'tu servicio';
  const dateLabel = formatDateSpanish(params.date);
  const timeLabel = /^\d{2}:\d{2}$/.test(params.startTime)
    ? formatTime12h(params.startTime)
    : params.startTime;

  return `Hola ${clientName}, te saluda ${barberName} de ${shopName}. Te escribo para confirmar si asistirás a tu cita de ${serviceName} el ${dateLabel} a las ${timeLabel}. Por favor confírmame por aquí. ¡Te esperamos!`;
}

/**
 * Genera el enlace directo https://wa.me/<numero>?text=<mensaje> listo para abrir en WhatsApp.
 */
export function buildAppointmentWhatsAppUrl(
  params: AppointmentWhatsAppParams
): string | null {
  const normalizedPhone = normalizeWhatsAppPhone(params.clientPhone);
  if (!normalizedPhone) {
    return null;
  }

  const message = buildAttendanceConfirmationMessage({
    clientName: params.clientName,
    barberName: params.barberName,
    serviceName: params.serviceName,
    date: params.date,
    startTime: params.startTime,
    shopName: params.shopName,
  });

  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}
