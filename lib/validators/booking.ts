import { z } from 'zod';
import {
  clientContactSchema,
  dateYYYYMMDDSchema,
  emailSchema,
  firestoreIdSchema,
  timeHHmmSchema,
} from '@/lib/validators/common';

export const bookingNotesSchema = z
  .string()
  .trim()
  .max(500, 'Las notas no pueden superar 500 caracteres')
  .optional()
  .or(z.literal(''));

export const bookingContactFormSchema = clientContactSchema.extend({
  notes: bookingNotesSchema,
});

export type BookingContactFormInput = z.infer<typeof bookingContactFormSchema>;

export const createBookingSchema = bookingContactFormSchema.extend({
  serviceId: firestoreIdSchema,
  barberId: z.union([z.literal('any'), firestoreIdSchema]),
  date: dateYYYYMMDDSchema,
  startTime: timeHHmmSchema,
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(4, 'Ingresa el código de tu reserva')
  .max(24, 'El código de reserva es demasiado largo')
  .regex(/^[A-Z0-9-]+$/, 'El código solo puede contener letras, números y guiones');

export const manageBookingRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('lookup'),
    bookingCode: bookingCodeSchema.optional(),
    email: emailSchema.optional(),
    manageToken: z.string().trim().min(10).max(512).optional(),
  }),
  z.object({
    mode: z.literal('cancel'),
    bookingCode: bookingCodeSchema.optional(),
    email: emailSchema.optional(),
    manageToken: z.string().trim().min(10).max(512).optional(),
  }),
  z.object({
    mode: z.literal('reschedule'),
    bookingCode: bookingCodeSchema.optional(),
    email: emailSchema.optional(),
    manageToken: z.string().trim().min(10).max(512).optional(),
    date: dateYYYYMMDDSchema,
    startTime: timeHHmmSchema,
    barberId: z.union([z.literal('any'), firestoreIdSchema]).optional(),
  }),
]);

export type ManageBookingRequest = z.infer<typeof manageBookingRequestSchema>;
