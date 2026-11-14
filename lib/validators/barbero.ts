import { z } from 'zod';
import { dayScheduleSchema } from '@/lib/validators/admin';
import {
  dateYYYYMMDDSchema,
  firestoreIdSchema,
  timeHHmmSchema,
} from '@/lib/validators/common';
import { timeToMinutes } from '@/lib/utils/timezone';
import { AppointmentStatus } from '@/types';

export const barberUpdateAppointmentStatusSchema = z.object({
  status: z.nativeEnum(AppointmentStatus, {
    error: 'El estado de la cita no es válido.',
  }),
});

export const barberUpdateScheduleSchema = z.object({
  barberId: firestoreIdSchema.optional(),
  days: z
    .array(dayScheduleSchema)
    .length(7, 'Deben enviarse los 7 días de la semana'),
});

export const barberCreateBlockSchema = z
  .object({
    barberId: firestoreIdSchema.optional(),
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
      message:
        'Para bloqueos por rango horario, la hora final debe ser posterior a la inicial.',
      path: ['endTime'],
    }
  );
