import { z } from 'zod';
import { emailSchema } from '@/lib/validators/common';

export const emailPasswordLoginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(6, 'La contraseña debe tener al menos 6 caracteres')
    .max(128, 'La contraseña supera el límite permitido'),
});

export type EmailPasswordLoginInput = z.infer<typeof emailPasswordLoginSchema>;

export const sessionExchangeSchema = z.object({
  idToken: z.string().min(20, 'Token de autenticación inválido'),
});
