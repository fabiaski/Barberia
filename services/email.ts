import 'server-only';
import { Resend } from 'resend';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import { serverGetDoc } from '@/lib/firestore-server';
import {
  buildCancelledEmailPayloads,
  buildConfirmationEmailPayloads,
  buildRescheduledEmailPayloads,
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
  staffSent: boolean;
  skipped?: boolean;
  reason?: string;
  recipients: string[];
  error?: string;
  clientError?: string;
}

export interface EmailServiceStatus {
  resendConfigured: boolean;
  fromEmail: string;
  envAdminNotificationEmail: string;
  appUrl: string;
}

function getResendClient(override?: ResendLikeClient): ResendLikeClient | null {
  if (override) return override;
  const apiKey = cleanEnvValue(process.env.RESEND_API_KEY);
  if (!apiKey) return null;
  return new Resend(apiKey) as unknown as ResendLikeClient;
}

export function getEmailServiceStatus(): EmailServiceStatus {
  return {
    resendConfigured: Boolean(cleanEnvValue(process.env.RESEND_API_KEY)),
    fromEmail: getConfiguredFromEmail(),
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
  excludeEmail?: string;
  shopOverride?: Partial<ShopEmailContext>;
  skipShopLookup?: boolean;
}): Promise<{ shop: ShopEmailContext; staffRecipients: string[] }> {
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

  const staffSet = new Set<string>();

  if (isValidDeliverableEmail(shop.adminNotificationEmail)) {
    staffSet.add(shop.adminNotificationEmail.trim().toLowerCase());
  }

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
        const barberEmail = String(userSnap.data?.email ?? '')
          .trim()
          .toLowerCase();
        if (
          isValidDeliverableEmail(barberEmail) &&
          !barberEmail.endsWith('@barberiaestudio.co')
        ) {
          staffSet.add(barberEmail);
        }
      }
    } catch {
      // No interrumpir el envío si el rol no tiene acceso a usuarios
    }
  }

  if (params.excludeEmail) {
    staffSet.delete(params.excludeEmail.trim().toLowerCase());
  }

  return {
    shop,
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
  const resend = getResendClient(params.resendClient);
  if (!resend) {
    return {
      sent: false,
      clientSent: false,
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

    const { shop, staffRecipients } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      excludeEmail: summary.clientEmail,
      shopOverride,
      skipShopLookup,
    });

    const { clientPayload, staffPayload } = buildConfirmationEmailPayloads({
      summary,
      shop,
      fromEmail,
      baseUrl,
      staffRecipients,
    });

    const sentRecipients: string[] = [];
    const errors: string[] = [];
    let clientSent = false;
    let staffSent = false;
    let clientError: string | undefined;

    if (clientPayload) {
      const clientRes = await safeSendSingleEmail(resend, clientPayload);
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

    if (staffPayload) {
      const staffRes = await safeSendSingleEmail(resend, staffPayload);
      if (staffRes.ok) {
        staffSent = true;
        sentRecipients.push(...staffPayload.to);
      } else if (staffRes.error) {
        errors.push(staffRes.error);
      }
    }

    return {
      sent: sentRecipients.length > 0,
      clientSent,
      staffSent,
      recipients: sentRecipients,
      ...(clientError ? { clientError } : {}),
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
  const resend = getResendClient(params.resendClient);
  if (!resend) {
    return {
      sent: false,
      clientSent: false,
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

    const { shop, staffRecipients } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      excludeEmail: summary.clientEmail,
      shopOverride,
      skipShopLookup,
    });

    const { clientPayload, staffPayload } = buildRescheduledEmailPayloads({
      summary,
      previousDate,
      previousStartTime,
      previousEndTime,
      shop,
      fromEmail,
      baseUrl,
      staffRecipients,
    });

    const sentRecipients: string[] = [];
    const errors: string[] = [];
    let clientSent = false;
    let staffSent = false;
    let clientError: string | undefined;

    if (clientPayload) {
      const clientRes = await safeSendSingleEmail(resend, clientPayload);
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

    if (staffPayload) {
      const staffRes = await safeSendSingleEmail(resend, staffPayload);
      if (staffRes.ok) {
        staffSent = true;
        sentRecipients.push(...staffPayload.to);
      } else if (staffRes.error) {
        errors.push(staffRes.error);
      }
    }

    return {
      sent: sentRecipients.length > 0,
      clientSent,
      staffSent,
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
  const resend = getResendClient(params.resendClient);
  if (!resend) {
    return {
      sent: false,
      clientSent: false,
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

    const { shop, staffRecipients } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      excludeEmail: summary.clientEmail,
      shopOverride,
      skipShopLookup,
    });

    const { clientPayload, staffPayload } = buildCancelledEmailPayloads({
      summary,
      cancelledBy,
      shop,
      fromEmail,
      baseUrl,
      staffRecipients,
    });

    const sentRecipients: string[] = [];
    const errors: string[] = [];
    let clientSent = false;
    let staffSent = false;
    let clientError: string | undefined;

    if (clientPayload) {
      const clientRes = await safeSendSingleEmail(resend, clientPayload);
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

    if (staffPayload) {
      const staffRes = await safeSendSingleEmail(resend, staffPayload);
      if (staffRes.ok) {
        staffSent = true;
        sentRecipients.push(...staffPayload.to);
      } else if (staffRes.error) {
        errors.push(staffRes.error);
      }
    }

    return {
      sent: sentRecipients.length > 0,
      clientSent,
      staffSent,
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
