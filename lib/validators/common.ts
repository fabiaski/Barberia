import { z } from 'zod';

/**
 * Esquemas base de validación compartidos entre cliente y servidor.
 */

export const firestoreIdSchema = z
  .string()
  .min(1, 'El identificador es obligatorio')
  .max(128, 'Identificador demasiado largo')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Identificador con formato inválido');

export const dateYYYYMMDDSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (use AAAA-MM-DD)');

export const timeHHmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato de hora inválido (use HH:mm)');

export const colombiaPhoneSchema = z
  .string()
  .trim()
  .min(7, 'El número de teléfono es muy corto')
  .max(15, 'El número de teléfono es muy largo')
  .regex(/^[+\d\s()-]+$/, 'El teléfono contiene caracteres inválidos');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Ingresa un correo electrónico válido')
  .max(160, 'El correo electrónico es demasiado largo');

export const clientContactSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, 'Ingresa tu nombre completo')
    .max(120, 'El nombre no puede superar 120 caracteres'),
  phone: colombiaPhoneSchema,
  email: emailSchema,
});

export type ClientContactInput = z.infer<typeof clientContactSchema>;
