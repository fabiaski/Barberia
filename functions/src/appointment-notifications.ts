import {
  buildCancelledPayloads,
  buildConfirmationPayloads,
  buildRescheduledPayloads,
  cleanEnvValue,
  DEFAULT_FROM_EMAIL,
  DEFAULT_SHOP_EMAIL_CONTEXT,
  isValidDeliverableEmail,
  minutesToTime,
  timeToMinutes,
  type AppointmentEmailSummary,
  type EmailMessagePayload,
  type ShopEmailContext,
} from './email-templates';

export interface DocSnapLike {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface FirestoreLike {
  getDoc(collection: string, docId: string): Promise<DocSnapLike>;
  tryCreateNotificationLock(
    lockId: string,
    payload: Record<string, unknown>
  ): Promise<boolean>;
}

export interface AuthLookupLike {
  getUserEmail(uid: string): Promise<string | undefined>;
}

export interface ResendLikeClient {
  emails: {
    send(payload: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
      text?: string;
      replyTo?: string;
    }): Promise<{
      data?: { id?: string } | null;
      error?: { message?: string } | null;
    }>;
  };
}

export interface NotificationEnvConfig {
  resendApiKey: string;
  fromEmail: string;
  appUrl: string;
  adminNotificationEmail: string;
  manageTokenSecret: string;
}

export interface DispatchOutcome {
  eventType: 'created' | 'confirmed' | 'cancelled' | 'rescheduled' | 'ignored';
  skipped?: boolean;
  reason?: string;
  clientSent: boolean;
  barberSent: boolean;
  adminSent: boolean;
  recipients: string[];
  errors: string[];
  resolvedSummary?: AppointmentEmailSummary;
}

function isPlaceholderEmail(email: string, barberId?: string): boolean {
  const clean = email.trim().toLowerCase();
  if (!clean) return true;
  if (clean === DEFAULT_SHOP_EMAIL_CONTEXT.shopEmail) return true;
  if (barberId && clean === `${barberId}@barberiaestudio.co`) return true;
  return false;
}

export async function resolveCatalogVerifiedSummary(
  db: FirestoreLike,
  appointmentId: string,
  rawData: Record<string, unknown>
): Promise<AppointmentEmailSummary> {
  const serviceId = String(rawData.serviceId ?? '').trim();
  const barberId = String(rawData.barberId ?? '').trim();
  const startTime = String(rawData.startTime ?? '').trim();

  let serviceName = String(rawData.serviceName ?? '').trim();
  let priceCop = Number(rawData.priceCop ?? 0);
  let durationMinutes = Number(rawData.durationMinutes ?? 30);
  let endTime = String(rawData.endTime ?? '').trim();

  if (serviceId) {
    try {
      const svcSnap = await db.getDoc('servicios', serviceId);
      const svcData = svcSnap.exists ? svcSnap.data() : undefined;
      if (svcData) {
        if (typeof svcData.name === 'string' && svcData.name.trim()) {
          serviceName = svcData.name.trim();
        }
        const catalogPrice = Number(svcData.priceCop);
        if (Number.isFinite(catalogPrice) && catalogPrice > 0) {
          priceCop = catalogPrice;
        }
        const catalogDuration = Number(svcData.durationMinutes);
        if (Number.isFinite(catalogDuration) && catalogDuration > 0) {
          durationMinutes = catalogDuration;
        }
      }
    } catch {
      // Si falla la lectura puntual del catálogo, mantener datos de la cita
    }
  }

  if (
    startTime &&
    /^\d{2}:\d{2}$/.test(startTime) &&
    Number.isFinite(durationMinutes) &&
    durationMinutes > 0
  ) {
    endTime = minutesToTime(timeToMinutes(startTime) + durationMinutes);
  }

  let barberUid = String(rawData.barberUid ?? '').trim();
  let barberName = String(rawData.barberName ?? '').trim();

  if (barberId && barberId !== 'any') {
    try {
      const barberSnap = await db.getDoc('barberos', barberId);
      const barberData = barberSnap.exists ? barberSnap.data() : undefined;
      if (barberData) {
        if (typeof barberData.name === 'string' && barberData.name.trim()) {
          barberName = barberData.name.trim();
        }
        if (typeof barberData.userId === 'string' && barberData.userId.trim()) {
          barberUid = barberData.userId.trim();
        }
      }
    } catch {
      // Mantener los valores almacenados en la cita
    }
  }

  return {
    id: appointmentId,
    bookingCode: String(
      rawData.bookingCode ?? appointmentId.slice(0, 8).toUpperCase()
    ),
    serviceId,
    serviceName: serviceName || 'Servicio de barbería',
    priceCop: Number.isFinite(priceCop) ? priceCop : 0,
    durationMinutes:
      Number.isFinite(durationMinutes) && durationMinutes > 0
        ? durationMinutes
        : 30,
    barberId,
    barberUid,
    barberName: barberName || 'Barbero asignado',
    date: String(rawData.date ?? ''),
    startTime,
    endTime: endTime || startTime,
    status: String(rawData.status ?? ''),
    notes: rawData.notes ? String(rawData.notes) : undefined,
    clientName: String(rawData.clientName ?? ''),
    clientPhone: String(rawData.clientPhone ?? ''),
    clientEmail: String(rawData.clientEmail ?? '').trim().toLowerCase(),
  };
}

export async function resolveShopAndStaffContext(params: {
  db: FirestoreLike;
  authLookup?: AuthLookupLike;
  summary: AppointmentEmailSummary;
  envAdminEmail: string;
}): Promise<{
  shop: ShopEmailContext;
  barberEmail?: string;
  adminEmail?: string;
}> {
  const { db, authLookup, summary, envAdminEmail } = params;
  const shop: ShopEmailContext = {
    ...DEFAULT_SHOP_EMAIL_CONTEXT,
    adminNotificationEmail: cleanEnvValue(envAdminEmail),
  };

  try {
    const configSnap = await db.getDoc('configuracion', 'main');
    const d = configSnap.exists ? configSnap.data() : undefined;
    if (d) {
      if (typeof d.name === 'string' && d.name.trim()) shop.shopName = d.name.trim();
      if (typeof d.address === 'string' && d.address.trim()) {
        shop.address = d.address.trim();
      }
      if (typeof d.city === 'string' && d.city.trim()) shop.city = d.city.trim();
      if (typeof d.phone === 'string' && d.phone.trim()) shop.phone = d.phone.trim();
      if (typeof d.email === 'string' && d.email.trim()) shop.shopEmail = d.email.trim();
      if (
        typeof d.adminNotificationEmail === 'string' &&
        d.adminNotificationEmail.trim()
      ) {
        shop.adminNotificationEmail = d.adminNotificationEmail.trim();
      }
    }
  } catch {
    // Continuar con valores por defecto
  }

  let barberEmail: string | undefined;
  const barberUid = summary.barberUid.trim();
  if (barberUid) {
    try {
      const userSnap = await db.getDoc('usuarios', barberUid);
      const userDocEmail = String(userSnap.data()?.email ?? '')
        .trim()
        .toLowerCase();
      if (
        isValidDeliverableEmail(userDocEmail) &&
        !isPlaceholderEmail(userDocEmail, summary.barberId)
      ) {
        barberEmail = userDocEmail;
      }
    } catch {
      // Probar respaldo en Auth
    }

    if (!barberEmail && authLookup) {
      try {
        const authEmail = (await authLookup.getUserEmail(barberUid) ?? '')
          .trim()
          .toLowerCase();
        if (
          isValidDeliverableEmail(authEmail) &&
          !isPlaceholderEmail(authEmail, summary.barberId)
        ) {
          barberEmail = authEmail;
        }
      } catch {
        // Ignorar si no existe usuario en Auth
      }
    }
  }

  let adminEmail: string | undefined;
  const configuredAdmin = shop.adminNotificationEmail.trim().toLowerCase();
  if (isValidDeliverableEmail(configuredAdmin)) {
    adminEmail = configuredAdmin;
  } else {
    const publicShopEmail = shop.shopEmail.trim().toLowerCase();
    if (
      !barberEmail &&
      isValidDeliverableEmail(publicShopEmail) &&
      !isPlaceholderEmail(publicShopEmail)
    ) {
      adminEmail = publicShopEmail;
    }
  }

  return { shop, barberEmail, adminEmail };
}

async function safeSendPayload(
  resend: ResendLikeClient,
  payload: EmailMessagePayload | null
): Promise<{ sent: boolean; recipient?: string; error?: string }> {
  if (!payload || payload.to.length === 0) {
    return { sent: false };
  }

  try {
    const res = await resend.emails.send({
      from: payload.from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      ...(payload.replyTo && isValidDeliverableEmail(payload.replyTo)
        ? { replyTo: payload.replyTo }
        : {}),
    });

    if (res?.error) {
      return {
        sent: false,
        error: res.error.message || 'Resend rechazó el envío.',
      };
    }

    return { sent: true, recipient: payload.to[0] };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'Error de red enviando correo.',
    };
  }
}

async function dispatchPayloads(
  resend: ResendLikeClient,
  payloads: {
    clientPayload: EmailMessagePayload | null;
    barberPayload: EmailMessagePayload | null;
    adminPayload: EmailMessagePayload | null;
  }
): Promise<{
  clientSent: boolean;
  barberSent: boolean;
  adminSent: boolean;
  recipients: string[];
  errors: string[];
}> {
  const [clientRes, barberRes, adminRes] = await Promise.all([
    safeSendPayload(resend, payloads.clientPayload),
    safeSendPayload(resend, payloads.barberPayload),
    safeSendPayload(resend, payloads.adminPayload),
  ]);

  const recipients: string[] = [];
  const errors: string[] = [];

  if (clientRes.sent && clientRes.recipient) recipients.push(clientRes.recipient);
  if (clientRes.error) errors.push(`cliente: ${clientRes.error}`);

  if (barberRes.sent && barberRes.recipient) recipients.push(barberRes.recipient);
  if (barberRes.error) errors.push(`barbero: ${barberRes.error}`);

  if (adminRes.sent && adminRes.recipient) recipients.push(adminRes.recipient);
  if (adminRes.error) errors.push(`admin: ${adminRes.error}`);

  return {
    clientSent: clientRes.sent,
    barberSent: barberRes.sent,
    adminSent: adminRes.sent,
    recipients,
    errors,
  };
}

export async function processAppointmentCreatedEvent(params: {
  appointmentId: string;
  data: Record<string, unknown>;
  db: FirestoreLike;
  authLookup?: AuthLookupLike;
  resend: ResendLikeClient | null;
  env: NotificationEnvConfig;
}): Promise<DispatchOutcome> {
  const { appointmentId, data, db, authLookup, resend, env } = params;
  const status = String(data.status ?? '').trim();

  if (status !== 'confirmada') {
    return {
      eventType: 'ignored',
      skipped: true,
      reason: `Estado inicial "${status}" no requiere confirmación automática.`,
      clientSent: false,
      barberSent: false,
      adminSent: false,
      recipients: [],
      errors: [],
    };
  }

  if (!resend || !cleanEnvValue(env.resendApiKey)) {
    return {
      eventType: 'created',
      skipped: true,
      reason: 'RESEND_API_KEY no configurada en Cloud Functions.',
      clientSent: false,
      barberSent: false,
      adminSent: false,
      recipients: [],
      errors: [],
    };
  }

  const lockAcquired = await db.tryCreateNotificationLock(
    `${appointmentId}_created_confirmada`,
    {
      appointmentId,
      eventType: 'created',
      createdAt: new Date().toISOString(),
    }
  );
  if (!lockAcquired) {
    return {
      eventType: 'created',
      skipped: true,
      reason: 'Notificación de creación ya procesada anteriormente.',
      clientSent: false,
      barberSent: false,
      adminSent: false,
      recipients: [],
      errors: [],
    };
  }

  const summary = await resolveCatalogVerifiedSummary(db, appointmentId, data);
  const { shop, barberEmail, adminEmail } = await resolveShopAndStaffContext({
    db,
    authLookup,
    summary,
    envAdminEmail: env.adminNotificationEmail,
  });

  const fromEmail = cleanEnvValue(env.fromEmail) || DEFAULT_FROM_EMAIL;
  const baseUrl = cleanEnvValue(env.appUrl).replace(/\/+$/, '') || 'http://localhost:3000';

  const payloads = buildConfirmationPayloads({
    summary,
    shop,
    fromEmail,
    baseUrl,
    manageTokenSecret: env.manageTokenSecret,
    barberEmail,
    adminEmail,
  });

  const result = await dispatchPayloads(resend, payloads);
  return {
    eventType: 'created',
    ...result,
    resolvedSummary: summary,
  };
}

export async function processAppointmentUpdatedEvent(params: {
  appointmentId: string;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  db: FirestoreLike;
  authLookup?: AuthLookupLike;
  resend: ResendLikeClient | null;
  env: NotificationEnvConfig;
}): Promise<DispatchOutcome> {
  const {
    appointmentId,
    beforeData,
    afterData,
    db,
    authLookup,
    resend,
    env,
  } = params;

  const beforeStatus = String(beforeData.status ?? '').trim();
  const afterStatus = String(afterData.status ?? '').trim();

  const becameConfirmed =
    beforeStatus !== 'confirmada' && afterStatus === 'confirmada';
  const becameCancelled =
    beforeStatus !== 'cancelada' && afterStatus === 'cancelada';

  const beforeDate = String(beforeData.date ?? '');
  const afterDate = String(afterData.date ?? '');
  const beforeStart = String(beforeData.startTime ?? '');
  const afterStart = String(afterData.startTime ?? '');
  const beforeBarber = String(beforeData.barberId ?? '');
  const afterBarber = String(afterData.barberId ?? '');

  const wasRescheduled =
    beforeStatus === 'confirmada' &&
    afterStatus === 'confirmada' &&
    (beforeDate !== afterDate ||
      beforeStart !== afterStart ||
      beforeBarber !== afterBarber);

  if (!becameConfirmed && !becameCancelled && !wasRescheduled) {
    return {
      eventType: 'ignored',
      skipped: true,
      reason: 'Cambio sin transición notificable.',
      clientSent: false,
      barberSent: false,
      adminSent: false,
      recipients: [],
      errors: [],
    };
  }

  const eventType = becameConfirmed
    ? 'confirmed'
    : becameCancelled
      ? 'cancelled'
      : 'rescheduled';

  if (!resend || !cleanEnvValue(env.resendApiKey)) {
    return {
      eventType,
      skipped: true,
      reason: 'RESEND_API_KEY no configurada en Cloud Functions.',
      clientSent: false,
      barberSent: false,
      adminSent: false,
      recipients: [],
      errors: [],
    };
  }

  const versionTag =
    eventType === 'rescheduled'
      ? `${afterDate}_${afterStart}_${afterBarber}`
      : afterStatus;
  const lockAcquired = await db.tryCreateNotificationLock(
    `${appointmentId}_${eventType}_${versionTag}`,
    {
      appointmentId,
      eventType,
      versionTag,
      createdAt: new Date().toISOString(),
    }
  );
  if (!lockAcquired) {
    return {
      eventType,
      skipped: true,
      reason: 'Notificación de actualización ya procesada anteriormente.',
      clientSent: false,
      barberSent: false,
      adminSent: false,
      recipients: [],
      errors: [],
    };
  }

  const summary = await resolveCatalogVerifiedSummary(
    db,
    appointmentId,
    afterData
  );
  const { shop, barberEmail, adminEmail } = await resolveShopAndStaffContext({
    db,
    authLookup,
    summary,
    envAdminEmail: env.adminNotificationEmail,
  });

  const fromEmail = cleanEnvValue(env.fromEmail) || DEFAULT_FROM_EMAIL;
  const baseUrl = cleanEnvValue(env.appUrl).replace(/\/+$/, '') || 'http://localhost:3000';

  if (eventType === 'confirmed') {
    const payloads = buildConfirmationPayloads({
      summary,
      shop,
      fromEmail,
      baseUrl,
      manageTokenSecret: env.manageTokenSecret,
      barberEmail,
      adminEmail,
    });
    const result = await dispatchPayloads(resend, payloads);
    return { eventType, ...result, resolvedSummary: summary };
  }

  if (eventType === 'cancelled') {
    const payloads = buildCancelledPayloads({
      summary,
      shop,
      fromEmail,
      baseUrl,
      barberEmail,
      adminEmail,
    });
    const result = await dispatchPayloads(resend, payloads);
    return { eventType, ...result, resolvedSummary: summary };
  }

  const payloads = buildRescheduledPayloads({
    summary,
    previousDate: beforeDate || summary.date,
    previousStartTime: beforeStart || summary.startTime,
    previousEndTime: String(beforeData.endTime ?? summary.endTime),
    shop,
    fromEmail,
    baseUrl,
    manageTokenSecret: env.manageTokenSecret,
    barberEmail,
    adminEmail,
  });
  const result = await dispatchPayloads(resend, payloads);
  return { eventType, ...result, resolvedSummary: summary };
}
