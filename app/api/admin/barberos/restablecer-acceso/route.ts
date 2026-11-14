import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/guards';
import { getFirebaseProjectConfig } from '@/lib/firebase-admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { emailSchema } from '@/lib/validators/common';
import { UserRole } from '@/types';

const resetEmailSchema = z.object({
  email: emailSchema,
});

export async function POST(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const parsed = resetEmailSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Ingresa un correo electrónico válido.' },
        { status: 400 }
      );
    }

    const { apiKey } = getFirebaseProjectConfig();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'PASSWORD_RESET',
          email: parsed.data.email,
        }),
      }
    );

    const json = (await res.json()) as { error?: { message?: string } };
    if (!res.ok) {
      throw new Error(
        translateErrorMessageEs(
          json.error?.message,
          'No fue posible enviar el enlace de restablecimiento.'
        )
      );
    }

    return NextResponse.json({
      message: `Enviamos un enlace para restablecer la contraseña a ${parsed.data.email}. Revisa la bandeja o spam, define una nueva contraseña y vuelve a crear el barbero con esa clave.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: translateErrorMessageEs(
          error,
          'No fue posible enviar el correo de recuperación.'
        ),
      },
      { status: 400 }
    );
  }
}
