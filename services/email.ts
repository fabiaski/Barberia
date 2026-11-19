import 'server-only';
import { Resend } from 'resend';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import { serverGetDoc, serverQueryCollection } from '@/lib/firestore-server';
import {
  buildCancelledEmailPayloads,
  buildConfirmationEmailPayloads,
  buildRescheduledEmailPayloads,
  buildStaffConfirmationEmailPayload,
  buildTestEmailPayload,
  cleanEnvValue,
  DEFAULT_SHOP_EMAIL_CONTEXT,
  getConfiguredFromEmail,
  isValidDeliverableEmail,
  resolveAppBaseUrl,
  type EmailMessagePayload,
  type ShopEmailContext,
} from '@/lib/utils/email-templates';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import type { PublicBookingSummary } from '@/services/booking';

export { resolveAppBaseUrl };

export interface ResendLikeClient {
  emails: {
    send: (payload: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
      text?: string;
      replyTo?: string;
    }) => Promise<{ data?: { id?: string } | null; error?: { message?: string } | null }>;
  };
}

export interface EmailDispatchResult {
  sent: boolean;
  clientSent: boolean;
  adminSent?: boolean;
  barberSent?: boolean;
  staffSent: boolean;
  skipped?: boolean;
  delegatedToFunctions?: boolean;
  reason?: string;
  recipients: string[];
  error?: string;
  clientError?: string;
  adminError?: string;
}

export interface EmailServiceStatus {
  resendConfigured: boolean;
  delegatedToFunctions: boolean;
  fromEmail: string;
  isSandboxSender: boolean;
  hasAdminServiceAccount: boolean;
  envAdminNotificationEmail: string;
  appUrl: string;
}

export function isEmailDelegatedToFunctions(): boolean {
  return (
    cleanEnvValue(process.env.EMAIL_DISPATCH_VIA_FUNCTIONS).toLowerCase() ===
    'true'
  );
}

function getResendClient(override?: ResendLikeClient): ResendLikeClient | null {
  if (override) return override;
  const apiKey = cleanEnvValue(process.env.RESEND_API_KEY);
  if (!apiKey) return null;
  return new Resend(apiKey) as unknown as ResendLikeClient;
}

export function getEmailServiceStatus(): EmailServiceStatus {
  const fromEmail = getConfiguredFromEmail();
  return {
    resendConfigured: Boolean(cleanEnvValue(process.env.RESEND_API_KEY)),
    delegatedToFunctions: isEmailDelegatedToFunctions(),
    fromEmail,
    isSandboxSender: fromEmail.toLowerCase().includes('onboarding@resend.dev'),
    hasAdminServiceAccount: hasAdminServiceAccount(),
    envAdminNotificationEmail: cleanEnvValue(
      process.env.ADMIN_NOTIFICATION_EMAIL
    ),
    appUrl: resolveAppBaseUrl(),
  };
}

async function resolveShopAndStaffRecipients(params: {
  barberId?: string;
  barberUid?: string;
  idToken?: string;
  shopOverride?: Partial<ShopEmailContext>;
  skipShopLookup?: boolean;
}): Promise<{
  shop: ShopEmailContext;
  adminEmail?: string;
  barberEmail?: string;
  staffRecipients: string[];
}> {
  const fallbackAdminEmail = cleanEnvValue(process.env.ADMIN_NOTIFICATION_EMAIL);
  const shop: ShopEmailContext = {
    ...DEFAULT_SHOP_EMAIL_CONTEXT,
    adminNotificationEmail: fallbackAdminEmail,
    ...params.shopOverride,
  };

  if (!params.skipShopLookup) {
    try {
      const configSnap = await serverGetDoc(
        'configuracion',
        'main',
        params.idToken
      );
      if (configSnap.exists && configSnap.data) {
        const d = configSnap.data;
        if (d.name && !params.shopOverride?.shopName) {
          shop.shopName = String(d.name);
        }
        if (d.address && !params.shopOverride?.address) {
          shop.address = String(d.address);
        }
        if (d.city && !params.shopOverride?.city) {
          shop.city = String(d.city);
        }
        if (d.phone && !params.shopOverride?.phone) {
          shop.phone = String(d.phone);
        }
        if (d.email && !params.shopOverride?.shopEmail) {
          shop.shopEmail = String(d.email);
        }
        const configuredAdmin = String(d.adminNotificationEmail ?? '').trim();
        if (configuredAdmin && !params.shopOverride?.adminNotificationEmail) {
          shop.adminNotificationEmail = configuredAdmin;
        }
      }
    } catch {
      // Usar valores predeterminados si falla la lectura de configuración
    }
  }

  let adminEmail: string | undefined;
  if (isValidDeliverableEmail(shop.adminNotificationEmail)) {
    adminEmail = shop.adminNotificationEmail.trim().toLowerCase();
  }

  // Respaldo: buscar el correo del administrador activo si no hubo correo explícito
  if (
    !adminEmail &&
    !params.skipShopLookup &&
    (hasAdminServiceAccount() || params.idToken)
  ) {
    try {
      const adminUsers = await serverQueryCollection(
        'usuarios',
        {
          filters: [
            { field: 'role', op: '==', value: 'admin' },
            { field: 'active', op: '==', value: true },
          ],
          limit: 3,
        },
        params.idToken
      );
      for (const adminDoc of adminUsers) {
        const candidate = String(adminDoc.data?.email ?? '')
          .trim()
          .toLowerCase();
        if (
          isValidDeliverableEmail(candidate) &&
          candidate !== DEFAULT_SHOP_EMAIL_CONTEXT.shopEmail
        ) {
          adminEmail = candidate;
          break;
        }
      }
    } catch {
      // Ignorar si no tiene permisos de lectura sobre usuarios
    }
  }

  if (
    !adminEmail &&
    !params.skipShopLookup &&
    isValidDeliverableEmail(shop.shopEmail) &&
    shop.shopEmail.trim().toLowerCase() !== DEFAULT_SHOP_EMAIL_CONTEXT.shopEmail
  ) {
    adminEmail = shop.shopEmail.trim().toLowerCase();
  }

  let barberEmail: string | undefined;
  if (!params.skipShopLookup && (hasAdminServiceAccount() || params.idToken)) {
    try {
      let resolvedUid = params.barberUid?.trim() || '';
      if (!resolvedUid && params.barberId && params.barberId !== 'any') {
        const barberSnap = await serverGetDoc(
          'barberos',
          params.barberId,
          params.idToken
        );
        if (barberSnap.exists && barberSnap.data?.userId) {
          resolvedUid = String(barberSnap.data.userId).trim();
        }
      }

      if (resolvedUid) {
        const userSnap = await serverGetDoc(
          'usuarios',
          resolvedUid,
          params.idToken
        );
        const candidate = String(userSnap.data?.email ?? '')
          .trim()
          .toLowerCase();
        const syntheticFallback = params.barberId
          ? `${params.barberId}@barberiaestudio.co`
          : '';
        if (
          isValidDeliverableEmail(candidate) &&
          candidate !== DEFAULT_SHOP_EMAIL_CONTEXT.shopEmail &&
          candidate !== syntheticFallback
        ) {
          barberEmail = candidate;
        }
      }
    } catch {
      // No interrumpir el envío si el rol no tiene acceso a usuarios
    }
  }

  const staffSet = new Set<string>();
  if (adminEmail) staffSet.add(adminEmail);
  if (barberEmail) staffSet.add(barberEmail);

  return {
    shop,
    adminEmail,
    barberEmail,
    staffRecipients: Array.from(staffSet),
  };
}

async function safeSendSingleEmail(
  resend: ResendLikeClient,
  payload: EmailMessagePayload
): Promise<{ ok: boolean; error?: string }> {
  if (payload.to.length === 0) return { ok: true };
  try {
    const response = await resend.emails.send({
      from: payload.from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      ...(payload.replyTo && isValidDeliverableEmail(payload.replyTo)
        ? { replyTo: payload.replyTo }
        : {}),
    });
    if (response?.error) {
      console.warn('[Resend] Envío rechazado:', response.error.message);
      return {
        ok: false,
        error: translateErrorMessageEs(
          response.error.message,
          'No fue posible enviar el correo con Resend.'
        ),
      };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[Resend] Excepción al enviar correo:', err);
    return {
      ok: false,
      error: translateErrorMessageEs(
        err,
        'No fue posible enviar el correo con Resend.'
      ),
    };
  }
}

export async function sendBookingConfirmationEmails(params: {
  summary: PublicBookingSummary;
  barberUid?: string;
  idToken?: string;
  requestOrigin?: string;
  resendClient?: ResendLikeClient;
  shopOverride?: Partial<ShopEmailContext>;
  skipShopLookup?: boolean;
}): Promise<EmailDispatchResult> {
  if (!params.resendClient && isEmailDelegatedToFunctions()) {
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      skipped: true,
      delegatedToFunctions: true,
      reason: 'Despacho automático delegado a Firebase Cloud Functions.',
      recipients: [],
    };
  }

  const resend = getResendClient(params.resendClient);
  if (!resend) {
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      skipped: true,
      reason: 'RESEND_API_KEY no configurada',
      recipients: [],
    };
  }

  try {
    const {
      summary,
      barberUid,
      idToken,
      requestOrigin,
      shopOverride,
      skipShopLookup,
    } = params;
    const baseUrl = resolveAppBaseUrl(requestOrigin);
    const fromEmail = getConfiguredFromEmail();

    const { shop, adminEmail, barberEmail } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      shopOverride,
      skipShopLookup,
    });

    const { clientPayload } = buildConfirmationEmailPayloads({
      summary,
      shop,
      fromEmail,
      baseUrl,
      staffRecipients: [],
    });

    const adminPayload = adminEmail
      ? buildStaffConfirmationEmailPayload({
          summary,
          shop,
          fromEmail,
          baseUrl,
          recipients: [adminEmail],
          targetRole: 'admin',
        })
      : null;

    const barberPayload =
      barberEmail && barberEmail !== adminEmail
        ? buildStaffConfirmationEmailPayload({
            summary,
            shop,
            fromEmail,
            baseUrl,
            recipients: [barberEmail],
            targetRole: 'barbero',
          })
        : null;

    const sentRecipients: string[] = [];
    const errors: string[] = [];
    let clientSent = false;
    let adminSent = false;
    let barberSent = false;
    let clientError: string | undefined;
    let adminError: string | undefined;

    const [clientRes, adminRes, barberRes] = await Promise.all([
      clientPayload
        ? safeSendSingleEmail(resend, clientPayload)
        : Promise.resolve(null),
      adminPayload
        ? safeSendSingleEmail(resend, adminPayload)
        : Promise.resolve(null),
      barberPayload
        ? safeSendSingleEmail(resend, barberPayload)
        : Promise.resolve(null),
    ]);

    if (clientPayload && clientRes) {
      if (clientRes.ok) {
        clientSent = true;
        sentRecipients.push(...clientPayload.to);
      } else if (clientRes.error) {
        clientError = clientRes.error;
        errors.push(clientRes.error);
      }
    } else {
      clientError = 'El cliente no tiene un correo electrónico válido registrado.';
    }

    if (adminPayload && adminRes) {
      if (adminRes.ok) {
        adminSent = true;
        sentRecipients.push(...adminPayload.to);
      } else if (adminRes.error) {
        adminError = adminRes.error;
        errors.push(adminRes.error);
      }
    }

    if (barberPayload && barberRes) {
      if (barberRes.ok) {
        barberSent = true;
        sentRecipients.push(...barberPayload.to);
      } else if (barberRes.error) {
        errors.push(barberRes.error);
      }
    }

    const staffSent = adminSent || barberSent;

    return {
      sent: sentRecipients.length > 0,
      clientSent,
      adminSent,
      barberSent,
      staffSent,
      recipients: sentRecipients,
      ...(clientError ? { clientError } : {}),
      ...(adminError ? { adminError } : {}),
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  } catch (err) {
    const translated = translateErrorMessageEs(
      err,
      'Error inesperado al notificar la confirmación'
    );
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      recipients: [],
      clientError: translated,
      error: translated,
    };
  }
}

export async function sendBookingRescheduledEmails(params: {
  summary: PublicBookingSummary;
  previousDate: string;
  previousStartTime: string;
  previousEndTime: string;
  barberUid?: string;
  idToken?: string;
  requestOrigin?: string;
  resendClient?: ResendLikeClient;
  shopOverride?: Partial<ShopEmailContext>;
  skipShopLookup?: boolean;
}): Promise<EmailDispatchResult> {
  if (!params.resendClient && isEmailDelegatedToFunctions()) {
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      skipped: true,
      delegatedToFunctions: true,
      reason: 'Despacho automático delegado a Firebase Cloud Functions.',
      recipients: [],
    };
  }

  const resend = getResendClient(params.resendClient);
  if (!resend) {
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      skipped: true,
      reason: 'RESEND_API_KEY no configurada',
      recipients: [],
    };
  }

  try {
    const {
      summary,
      previousDate,
      previousStartTime,
      previousEndTime,
      barberUid,
      idToken,
      requestOrigin,
      shopOverride,
      skipShopLookup,
    } = params;
    const baseUrl = resolveAppBaseUrl(requestOrigin);
    const fromEmail = getConfiguredFromEmail();

    const { shop, adminEmail, barberEmail } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      shopOverride,
      skipShopLookup,
    });

    const { clientPayload } = buildRescheduledEmailPayloads({
      summary,
      previousDate,
      previousStartTime,
      previousEndTime,
      shop,
      fromEmail,
      baseUrl,
      staffRecipients: [],
    });

    const adminPayload = adminEmail
      ? buildRescheduledEmailPayloads({
          summary,
          previousDate,
          previousStartTime,
          previousEndTime,
          shop,
          fromEmail,
          baseUrl,
          staffRecipients: [adminEmail],
        }).staffPayload
      : null;

    const barberPayload =
      barberEmail && barberEmail !== adminEmail
        ? buildRescheduledEmailPayloads({
            summary,
            previousDate,
            previousStartTime,
            previousEndTime,
            shop,
            fromEmail,
            baseUrl,
            staffRecipients: [barberEmail],
          }).staffPayload
        : null;

    const sentRecipients: string[] = [];
    const errors: string[] = [];
    let clientSent = false;
    let adminSent = false;
    let barberSent = false;
    let clientError: string | undefined;

    const [clientRes, adminRes, barberRes] = await Promise.all([
      clientPayload
        ? safeSendSingleEmail(resend, clientPayload)
        : Promise.resolve(null),
      adminPayload
        ? safeSendSingleEmail(resend, adminPayload)
        : Promise.resolve(null),
      barberPayload
        ? safeSendSingleEmail(resend, barberPayload)
        : Promise.resolve(null),
    ]);

    if (clientPayload && clientRes) {
      if (clientRes.ok) {
        clientSent = true;
        sentRecipients.push(...clientPayload.to);
      } else if (clientRes.error) {
        clientError = clientRes.error;
        errors.push(clientRes.error);
      }
    } else {
      clientError = 'El cliente no tiene un correo electrónico válido registrado.';
    }

    if (adminPayload && adminRes) {
      if (adminRes.ok) {
        adminSent = true;
        sentRecipients.push(...adminPayload.to);
      } else if (adminRes.error) {
        errors.push(adminRes.error);
      }
    }

    if (barberPayload && barberRes) {
      if (barberRes.ok) {
        barberSent = true;
        sentRecipients.push(...barberPayload.to);
      } else if (barberRes.error) {
        errors.push(barberRes.error);
      }
    }

    return {
      sent: sentRecipients.length > 0,
      clientSent,
      adminSent,
      barberSent,
      staffSent: adminSent || barberSent,
      recipients: sentRecipients,
      ...(clientError ? { clientError } : {}),
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  } catch (err) {
    const translated = translateErrorMessageEs(
      err,
      'Error al enviar notificación de reprogramación'
    );
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      recipients: [],
      clientError: translated,
      error: translated,
    };
  }
}

export async function sendBookingCancelledEmails(params: {
  summary: PublicBookingSummary;
  cancelledBy: 'cliente' | 'barbero' | 'admin';
  barberUid?: string;
  idToken?: string;
  requestOrigin?: string;
  resendClient?: ResendLikeClient;
  shopOverride?: Partial<ShopEmailContext>;
  skipShopLookup?: boolean;
}): Promise<EmailDispatchResult> {
  if (!params.resendClient && isEmailDelegatedToFunctions()) {
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      skipped: true,
      delegatedToFunctions: true,
      reason: 'Despacho automático delegado a Firebase Cloud Functions.',
      recipients: [],
    };
  }

  const resend = getResendClient(params.resendClient);
  if (!resend) {
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      skipped: true,
      reason: 'RESEND_API_KEY no configurada',
      recipients: [],
    };
  }

  try {
    const {
      summary,
      cancelledBy,
      barberUid,
      idToken,
      requestOrigin,
      shopOverride,
      skipShopLookup,
    } = params;
    const baseUrl = resolveAppBaseUrl(requestOrigin);
    const fromEmail = getConfiguredFromEmail();

    const { shop, adminEmail, barberEmail } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      shopOverride,
      skipShopLookup,
    });

    const { clientPayload } = buildCancelledEmailPayloads({
      summary,
      cancelledBy,
      shop,
      fromEmail,
      baseUrl,
      staffRecipients: [],
    });

    const adminPayload = adminEmail
      ? buildCancelledEmailPayloads({
          summary,
          cancelledBy,
          shop,
          fromEmail,
          baseUrl,
          staffRecipients: [adminEmail],
        }).staffPayload
      : null;

    const barberPayload =
      barberEmail && barberEmail !== adminEmail
        ? buildCancelledEmailPayloads({
            summary,
            cancelledBy,
            shop,
            fromEmail,
            baseUrl,
            staffRecipients: [barberEmail],
          }).staffPayload
        : null;

    const sentRecipients: string[] = [];
    const errors: string[] = [];
    let clientSent = false;
    let adminSent = false;
    let barberSent = false;
    let clientError: string | undefined;

    const [clientRes, adminRes, barberRes] = await Promise.all([
      clientPayload
        ? safeSendSingleEmail(resend, clientPayload)
        : Promise.resolve(null),
      adminPayload
        ? safeSendSingleEmail(resend, adminPayload)
        : Promise.resolve(null),
      barberPayload
        ? safeSendSingleEmail(resend, barberPayload)
        : Promise.resolve(null),
    ]);

    if (clientPayload && clientRes) {
      if (clientRes.ok) {
        clientSent = true;
        sentRecipients.push(...clientPayload.to);
      } else if (clientRes.error) {
        clientError = clientRes.error;
        errors.push(clientRes.error);
      }
    } else {
      clientError = 'El cliente no tiene un correo electrónico válido registrado.';
    }

    if (adminPayload && adminRes) {
      if (adminRes.ok) {
        adminSent = true;
        sentRecipients.push(...adminPayload.to);
      } else if (adminRes.error) {
        errors.push(adminRes.error);
      }
    }

    if (barberPayload && barberRes) {
      if (barberRes.ok) {
        barberSent = true;
        sentRecipients.push(...barberPayload.to);
      } else if (barberRes.error) {
        errors.push(barberRes.error);
      }
    }

    return {
      sent: sentRecipients.length > 0,
      clientSent,
      adminSent,
      barberSent,
      staffSent: adminSent || barberSent,
      recipients: sentRecipients,
      ...(clientError ? { clientError } : {}),
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  } catch (err) {
    const translated = translateErrorMessageEs(
      err,
      'Error al enviar notificación de cancelación'
    );
    return {
      sent: false,
      clientSent: false,
      adminSent: false,
      barberSent: false,
      staffSent: false,
      recipients: [],
      clientError: translated,
      error: translated,
    };
  }
}

export async function sendTestNotificationEmail(params: {
  toEmail: string;
  idToken?: string;
  requestOrigin?: string;
  resendClient?: ResendLikeClient;
  shopOverride?: Partial<ShopEmailContext>;
  skipShopLookup?: boolean;
}): Promise<EmailDispatchResult> {
  const resend = getResendClient(params.resendClient);
  if (!resend) {
    return {
      sent: false,
      clientSent: false,
      staffSent: false,
      skipped: true,
      reason: 'Falta configurar RESEND_API_KEY en las variables de entorno.',
      recipients: [],
      error: 'RESEND_API_KEY no está configurada en el servidor.',
    };
  }

  const target = params.toEmail.trim().toLowerCase();
  if (!isValidDeliverableEmail(target)) {
    return {
      sent: false,
      clientSent: false,
      staffSent: false,
      recipients: [],
      error: 'Ingresa un correo electrónico válido para la prueba.',
    };
  }

  const { shop } = await resolveShopAndStaffRecipients({
    idToken: params.idToken,
    shopOverride: params.shopOverride,
    skipShopLookup: params.skipShopLookup,
  });
  const baseUrl = resolveAppBaseUrl(params.requestOrigin);
  const fromEmail = getConfiguredFromEmail();

  const payload = buildTestEmailPayload({
    targetEmail: target,
    shop,
    fromEmail,
    baseUrl,
  });

  const res = await safeSendSingleEmail(resend, payload);

  if (!res.ok) {
    return {
      sent: false,
      clientSent: false,
      staffSent: false,
      recipients: [],
      clientError: res.error || 'Resend rechazó el envío de prueba.',
      error: res.error || 'Resend rechazó el envío de prueba.',
    };
  }

  return {
    sent: true,
    clientSent: true,
    staffSent: false,
    recipients: [target],
  };
}
