import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/guards';
import { emailSchema } from '@/lib/validators/common';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { getAdminShopConfig } from '@/services/admin';
import { sendTestNotificationEmail } from '@/services/email';
import { UserRole } from '@/types';

const testEmailBodySchema = z.object({
  email: emailSchema.optional().or(z.literal('')),
});

export async function POST(request: NextRequest) {
  const authResult = await requireApiRole(request, [UserRole.ADMIN]);
  if (!authResult.ok) return authResult.response;

  try {
    const rawBody = await request.json().catch(() => ({}));
    const parsed = testEmailBodySchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            parsed.error.issues[0]?.message,
            'El correo electrónico ingresado no es válido.'
          ),
        },
        { status: 400 }
      );
    }

    const config = await getAdminShopConfig(authResult.idToken);
    const targetEmail =
      parsed.data.email ||
      config.adminNotificationEmail?.trim() ||
      process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ||
      authResult.user.email;

    const result = await sendTestNotificationEmail({
      toEmail: targetEmail,
      idToken: authResult.idToken,
      requestOrigin: request.nextUrl.origin,
    });

    if (!result.sent) {
      return NextResponse.json(
        {
          error: translateErrorMessageEs(
            result.error ?? result.reason,
            'No se pudo enviar el correo de prueba.'
          ),
        },
        { status: result.skipped ? 503 : 502 }
      );
    }

    return NextResponse.json({
      message: `Correo de prueba enviado correctamente a ${targetEmail}.`,
      recipients: result.recipients,
    });
  } catch (error) {
    const message = translateErrorMessageEs(
      error,
      'No fue posible ejecutar la prueba de correo.'
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
