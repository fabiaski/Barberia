import { AppointmentStatus, UserRole } from '@/types';

export const SYSTEM_TIMEZONE = 'America/Bogota' as const;
export const DEFAULT_SLOT_INTERVAL_MINUTES = 30;
export const CURRENCY_CODE = 'COP' as const;

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'Administrador',
  [UserRole.BARBER]: 'Barbero',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  [AppointmentStatus.CONFIRMED]: 'Confirmada',
  [AppointmentStatus.IN_PROGRESS]: 'En proceso',
  [AppointmentStatus.COMPLETED]: 'Finalizada',
  [AppointmentStatus.CANCELLED]: 'Cancelada',
  [AppointmentStatus.NO_SHOW]: 'Cliente no asistió',
};

export const DAYS_OF_WEEK_ES = [
  { value: 0, label: 'Domingo', short: 'Dom' },
  { value: 1, label: 'Lunes', short: 'Lun' },
  { value: 2, label: 'Martes', short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves', short: 'Jue' },
  { value: 5, label: 'Viernes', short: 'Vie' },
  { value: 6, label: 'Sábado', short: 'Sáb' },
] as const;

export const DEVELOPMENT_STAGES = [
  { step: '01', title: 'Preparación y arquitectura', status: 'Completada' },
  { step: '02', title: 'Firebase, colecciones y reglas', status: 'Completada' },
  { step: '03', title: 'Página pública de la barbería', status: 'Completada' },
  { step: '04', title: 'Autenticación y control de roles', status: 'Completada' },
  { step: '05', title: 'Panel de administración', status: 'Completada' },
  { step: '06', title: 'Motor transaccional de reservas', status: 'Completada' },
  { step: '07', title: 'Panel privado del barbero', status: 'Completada' },
  { step: '08', title: 'Notificaciones por correo (Resend)', status: 'Pendiente' },
  { step: '09', title: 'Pruebas integrales y concurrencia', status: 'Pendiente' },
  { step: '10', title: 'Despliegue en Vercel y dominio', status: 'Pendiente' },
] as const;
