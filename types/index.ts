/**
 * Tipos e interfaces centrales del sistema de agendamiento de la barbería.
 * Alineados con las 9 colecciones planificadas en Cloud Firestore (Etapa 2).
 */

export enum UserRole {
  ADMIN = 'admin',
  BARBER = 'barbero',
}

export enum AppointmentStatus {
  CONFIRMED = 'confirmada',
  IN_PROGRESS = 'en_proceso',
  COMPLETED = 'finalizada',
  CANCELLED = 'cancelada',
  NO_SHOW = 'no_asistio',
}

export interface SystemUser {
  id: string;
  uid: string;
  email: string;
  phone?: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  barberId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Barber {
  id: string;
  userId: string;
  name: string;
  specialty: string;
  bio?: string;
  photoUrl?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  priceCop: number;
  durationMinutes: number;
  active: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  totalAppointments: number;
  lastAppointmentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  barberId: string;
  barberUid: string;
  barberName: string;
  serviceId: string;
  serviceName: string;
  priceCop: number;
  durationMinutes: number;
  date: string; // YYYY-MM-DD en America/Bogota
  startTime: string; // HH:mm en America/Bogota
  endTime: string; // HH:mm en America/Bogota
  status: AppointmentStatus;
  notes?: string;
  bookingCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DaySchedule {
  dayOfWeek: number; // 0 = Domingo, 6 = Sábado
  isOpen: boolean;
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
  breakStart?: string; // HH:mm
  breakEnd?: string; // HH:mm
}

export interface WorkSchedule {
  id: string; // 'general' o barberId
  barberId?: string;
  isPublic: boolean;
  days: DaySchedule[];
  updatedAt: string;
}

export interface ScheduleBlock {
  id: string;
  barberId: string | 'all';
  barberUid?: string;
  date: string; // YYYY-MM-DD
  allDay: boolean;
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface OccupancySlot {
  id: string; // Formato determinístico: `${barberId}_${YYYY-MM-DD}_${HHmm}`
  barberId: string;
  date: string;
  slotTime: string; // HH:mm
  appointmentId: string;
  createdAt: string;
}

export interface BarbershopConfig {
  id: 'main';
  name: string;
  tagline: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  whatsapp?: string;
  instagram?: string;
  timezone: 'America/Bogota';
  slotIntervalMinutes: number;
  adminNotificationEmail?: string;
  updatedByAdmin?: boolean;
  updatedAt: string;
}
