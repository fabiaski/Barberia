import { z } from 'zod';
import {
  colombiaPhoneSchema,
  dateYYYYMMDDSchema,
  emailSchema,
  timeHHmmSchema,
} from '@/lib/validators/common';
import { timeToMinutes } from '@/lib/utils/timezone';
import { AppointmentStatus } from '@/types';

export const createBarberSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(120, 'El nombre no puede superar 120 caracteres'),
  email: emailSchema,
  password: z
    .string()
    .min(6, 'La contraseña debe tener al menos 6 caracteres')
    .max(128, 'La contraseña es demasiado larga'),
  phone: colombiaPhoneSchema.optional().or(z.literal('')),
  specialty: z
    .string()
    .trim()
    .min(2, 'La especialidad es obligatoria')
    .max(120, 'Máximo 120 caracteres'),
  bio: z.string().trim().max(500, 'Máximo 500 caracteres').optional(),
  photoUrl: z.string().trim().max(500, 'URL demasiado larga').optional(),
  active: z.boolean().default(true),
});

export const updateBarberSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(120, 'El nombre no puede superar 120 caracteres'),
  specialty: z
    .string()
    .trim()
    .min(2, 'La especialidad es obligatoria')
    .max(120, 'Máximo 120 caracteres'),
  bio: z.string().trim().max(500, 'Máximo 500 caracteres').optional(),
  photoUrl: z.string().trim().max(500, 'URL demasiado larga').optional(),
  phone: colombiaPhoneSchema.optional().or(z.literal('')),
  active: z.boolean(),
  newPassword: z
    .string()
    .min(6, 'La contraseña debe tener al menos 6 caracteres')
    .max(128)
    .optional()
    .or(z.literal('')),
});

export const serviceMutationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'El nombre del servicio es obligatorio')
    .max(100, 'Máximo 100 caracteres'),
  description: z
    .string()
    .trim()
    .min(2, 'La descripción es obligatoria')
    .max(400, 'Máximo 400 caracteres'),
  priceCop: z.coerce
    .number()
    .int('El precio debe ser un número entero en COP')
    .positive('El precio debe ser mayor a 0'),
  durationMinutes: z.coerce
    .number()
    .int('La duración debe ser un número entero de minutos')
    .min(10, 'Mínimo 10 minutos')
    .max(360, 'Máximo 360 minutos'),
  order: z.coerce.number().int().min(0).max(999).default(1),
  active: z.boolean().default(true),
});

export const dayScheduleSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isOpen: z.boolean(),
    openTime: timeHHmmSchema,
    closeTime: timeHHmmSchema,
    breakStart: timeHHmmSchema.optional().or(z.literal('')),
    breakEnd: timeHHmmSchema.optional().or(z.literal('')),
  })
  .refine(
    (day) => {
      if (!day.isOpen) return true;
      return timeToMinutes(day.closeTime) > timeToMinutes(day.openTime);
    },
    {
      message: 'La hora de cierre debe ser posterior a la hora de apertura.',
      path: ['closeTime'],
    }
  )
  .refine(
    (day) => {
      if (!day.breakStart && !day.breakEnd) return true;
      if (!day.breakStart || !day.breakEnd) return false;
      return timeToMinutes(day.breakEnd) > timeToMinutes(day.breakStart);
    },
    {
      message: 'La pausa debe tener hora de inicio y fin válidas.',
      path: ['breakEnd'],
    }
  );

export const updateScheduleSchema = z.object({
  scheduleId: z.string().trim().min(1).max(128).default('general'),
  days: z.array(dayScheduleSchema).length(7, 'Deben enviarse los 7 días de la semana'),
});

export const createBlockSchema = z
  .object({
    barberId: z.string().trim().min(1, 'Selecciona un barbero o Todos'),
    date: dateYYYYMMDDSchema,
    allDay: z.boolean(),
    startTime: timeHHmmSchema.optional().or(z.literal('')),
    endTime: timeHHmmSchema.optional().or(z.literal('')),
    reason: z
      .string()
      .trim()
      .min(2, 'Ingresa el motivo del bloqueo')
      .max(240, 'Máximo 240 caracteres'),
  })
  .refine(
    (block) => {
      if (block.allDay) return true;
      if (!block.startTime || !block.endTime) return false;
      return timeToMinutes(block.endTime) > timeToMinutes(block.startTime);
    },
    {
      message: 'Para bloqueos parciales, indica hora inicial y final válidas.',
      path: ['endTime'],
    }
  );

export const shopConfigMutationSchema = z.object({
  name: z.string().trim().min(2, 'Nombre obligatorio').max(120),
  tagline: z.string().trim().min(2, 'Eslogan obligatorio').max(200),
  address: z.string().trim().min(4, 'Dirección obligatoria').max(200),
  city: z.string().trim().min(2, 'Ciudad obligatoria').max(80),
  phone: z.string().trim().min(7, 'Teléfono obligatorio').max(25),
  email: emailSchema,
  whatsapp: z.string().trim().max(25).optional().or(z.literal('')),
  instagram: z.string().trim().max(120).optional().or(z.literal('')),
  adminNotificationEmail: emailSchema.optional().or(z.literal('')),
  slotIntervalMinutes: z.coerce
    .number()
    .refine((v) => v === 10 || v === 15 || v === 30, {
      message: 'El intervalo debe ser 10, 15 o 30 minutos',
    }),
});

export const adminUpdateAppointmentStatusSchema = z.object({
  appointmentId: z.string().trim().min(1, 'El identificador de la cita es obligatorio').max(128),
  status: z.nativeEnum(AppointmentStatus, {
    error: 'El estado de la cita no es válido.',
  }),
});
