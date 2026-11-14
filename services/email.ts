import 'server-only';
import { Resend } from 'resend';
import { createBookingManageToken } from '@/lib/auth/manage-token';
import { SYSTEM_TIMEZONE } from '@/lib/constants/config';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import { serverGetDoc } from '@/lib/firestore-server';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import { formatCurrencyCOP, formatTime12h } from '@/lib/utils/timezone';
import type { PublicBookingSummary } from '@/services/booking';

const DEFAULT_FROM_EMAIL = 'Barbería Estudio <onboarding@resend.dev>';

export interface EmailDispatchResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  recipients: string[];
  error?: string;
}

export interface EmailServiceStatus {
  resendConfigured: boolean;
  fromEmail: string;
  envAdminNotificationEmail: string;
  appUrl: string;
}

interface ShopContext {
  shopName: string;
  address: string;
  city: string;
  phone: string;
  shopEmail: string;
  adminNotificationEmail: string;
}

function cleanEnvValue(value: string | undefined): string {
  if (!value) return '';
  let v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function getResendClient(): Resend | null {
  const apiKey = cleanEnvValue(process.env.RESEND_API_KEY);
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function getFromEmail(): string {
  return cleanEnvValue(process.env.RESEND_FROM_EMAIL) || DEFAULT_FROM_EMAIL;
}

export function resolveAppBaseUrl(requestOrigin?: string): string {
  const candidates = [
    cleanEnvValue(process.env.APP_URL),
    cleanEnvValue(process.env.NEXT_PUBLIC_APP_URL),
    cleanEnvValue(process.env.VERCEL_URL)
      ? `https://${cleanEnvValue(process.env.VERCEL_URL)}`
      : '',
    requestOrigin?.trim() || '',
    'http://localhost:3000',
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (
      candidate.startsWith('https://') ||
      candidate.startsWith('http://localhost') ||
      candidate.startsWith('http://127.0.0.1')
    ) {
      return candidate.replace(/\/+$/, '');
    }
  }

  return 'http://localhost:3000';
}

export function getEmailServiceStatus(): EmailServiceStatus {
  return {
    resendConfigured: Boolean(cleanEnvValue(process.env.RESEND_API_KEY)),
    fromEmail: getFromEmail(),
    envAdminNotificationEmail: cleanEnvValue(
      process.env.ADMIN_NOTIFICATION_EMAIL
    ),
    appUrl: resolveAppBaseUrl(),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateBogotaEs(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const d = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: SYSTEM_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

function isValidDeliverableEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

async function resolveShopAndStaffRecipients(params: {
  barberId?: string;
  barberUid?: string;
  idToken?: string;
  excludeEmail?: string;
}): Promise<{ shop: ShopContext; staffRecipients: string[] }> {
  const fallbackAdminEmail = cleanEnvValue(process.env.ADMIN_NOTIFICATION_EMAIL);
  const shop: ShopContext = {
    shopName: 'Barbería Estudio',
    address: 'Calle 85 # 14-32, Zona T',
    city: 'Bogotá',
    phone: '+57 310 555 0148',
    shopEmail: '',
    adminNotificationEmail: fallbackAdminEmail,
  };

  try {
    const configSnap = await serverGetDoc(
      'configuracion',
      'main',
      params.idToken
    );
    if (configSnap.exists && configSnap.data) {
      const d = configSnap.data;
      if (d.name) shop.shopName = String(d.name);
      if (d.address) shop.address = String(d.address);
      if (d.city) shop.city = String(d.city);
      if (d.phone) shop.phone = String(d.phone);
      if (d.email) shop.shopEmail = String(d.email);
      const configuredAdmin = String(d.adminNotificationEmail ?? '').trim();
      if (configuredAdmin) {
        shop.adminNotificationEmail = configuredAdmin;
      }
    }
  } catch {
    // Usar valores predeterminados si falla la lectura de configuración
  }

  const staffSet = new Set<string>();

  if (isValidDeliverableEmail(shop.adminNotificationEmail)) {
    staffSet.add(shop.adminNotificationEmail.trim().toLowerCase());
  }

  if (hasAdminServiceAccount() || params.idToken) {
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

function buildEmailLayout(params: {
  shopName: string;
  preheader: string;
  kicker: string;
  title: string;
  intro: string;
  highlightLabel?: string;
  highlightValue?: string;
  rows: Array<{ label: string; value: string }>;
  ctaLabel: string;
  ctaUrl: string;
  footerNote: string;
}): string {
  const rowsHtml = params.rows
    .map(
      (row) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e7e5e4;color:#78716c;font-size:13px;vertical-align:top;width:38%;">${escapeHtml(row.label)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e7e5e4;color:#1c1917;font-size:13px;font-weight:600;text-align:right;vertical-align:top;">${escapeHtml(row.value)}</td>
        </tr>`
    )
    .join('');

  const highlightHtml =
    params.highlightLabel && params.highlightValue
      ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background-color:#fafaf9;border:1px solid #d6d3d1;border-radius:10px;">
        <tr>
          <td style="padding:16px 20px;text-align:center;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#78716c;margin-bottom:4px;">${escapeHtml(params.highlightLabel)}</div>
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:700;letter-spacing:0.12em;color:#b45309;">${escapeHtml(params.highlightValue)}</div>
          </td>
        </tr>
      </table>`
      : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(params.preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#ffffff;border:1px solid #e7e5e4;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="background-color:#1c1917;padding:22px 28px;border-bottom:3px solid #d97706;">
              <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${escapeHtml(params.shopName)}</div>
              <div style="font-size:12px;color:#d6d3d1;margin-top:2px;">Sistema de reservas y agenda</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <div style="font-size:12px;font-weight:600;color:#b45309;margin-bottom:6px;">${escapeHtml(params.kicker)}</div>
              <h1 style="margin:0 0 10px 0;font-size:22px;line-height:1.3;font-weight:700;color:#1c1917;">${escapeHtml(params.title)}</h1>
              <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#57534e;">${escapeHtml(params.intro)}</p>
              ${highlightHtml}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;">
                ${rowsHtml}
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(params.ctaUrl)}" style="display:inline-block;background-color:#b45309;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:12px 24px;border-radius:8px;">${escapeHtml(params.ctaLabel)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#fafaf9;padding:18px 28px;border-top:1px solid #e7e5e4;font-size:12px;line-height:1.5;color:#78716c;">
              ${escapeHtml(params.footerNote)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function safeSendSingleEmail(
  resend: Resend,
  payload: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }
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
    if (response.error) {
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
}): Promise<EmailDispatchResult> {
  const resend = getResendClient();
  if (!resend) {
    return {
      sent: false,
      skipped: true,
      reason: 'RESEND_API_KEY no configurada',
      recipients: [],
    };
  }

  try {
    const { summary, barberUid, idToken, requestOrigin } = params;
    const baseUrl = resolveAppBaseUrl(requestOrigin);
    const manageToken =
      summary.manageToken ||
      createBookingManageToken(summary.id, summary.clientEmail);
    const manageUrl = `${baseUrl}/reservar?gestionar=1&token=${encodeURIComponent(manageToken)}`;
    const panelUrl = `${baseUrl}/login`;
    const fromEmail = getFromEmail();

    const { shop, staffRecipients } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      excludeEmail: summary.clientEmail,
    });

    const formattedDate = formatDateBogotaEs(summary.date);
    const formattedSchedule = `${formattedDate} · ${formatTime12h(summary.startTime)} – ${formatTime12h(summary.endTime)}`;
    const priceLabel = `${formatCurrencyCOP(summary.priceCop)} · ${summary.durationMinutes} min`;

    const clientHtml = buildEmailLayout({
      shopName: shop.shopName,
      preheader: `Tu cita ${summary.bookingCode} quedó confirmada para el ${formattedSchedule}.`,
      kicker: 'Confirmación de reserva',
      title: `¡Tu cita está confirmada, ${summary.clientName}!`,
      intro: `Hemos reservado tu turno en ${shop.shopName}. Conserva tu código de confirmación por si necesitas consultar, reprogramar o cancelar.`,
      highlightLabel: 'Código de confirmación',
      highlightValue: summary.bookingCode,
      rows: [
        { label: 'Servicio', value: summary.serviceName },
        { label: 'Valor y duración', value: priceLabel },
        { label: 'Barbero asignado', value: summary.barberName },
        { label: 'Fecha y horario', value: formattedSchedule },
        { label: 'Ubicación', value: `${shop.address}, ${shop.city}` },
        ...(summary.notes
          ? [{ label: 'Notas registradas', value: summary.notes }]
          : []),
      ],
      ctaLabel: 'Consultar, reprogramar o cancelar cita',
      ctaUrl: manageUrl,
      footerNote: `${shop.shopName} · ${shop.address}, ${shop.city} · Tel: ${shop.phone}. Horario expresado en ${SYSTEM_TIMEZONE}.`,
    });

    const clientText = [
      `${shop.shopName} — Confirmación de reserva`,
      `Hola ${summary.clientName}, tu cita quedó confirmada.`,
      `Código: ${summary.bookingCode}`,
      `Servicio: ${summary.serviceName} (${priceLabel})`,
      `Barbero: ${summary.barberName}`,
      `Fecha y horario: ${formattedSchedule}`,
      `Dirección: ${shop.address}, ${shop.city}`,
      `Gestionar cita: ${manageUrl}`,
    ].join('\n');

    const sentRecipients: string[] = [];
    const errors: string[] = [];

    if (isValidDeliverableEmail(summary.clientEmail)) {
      const clientRes = await safeSendSingleEmail(resend, {
        from: fromEmail,
        to: [summary.clientEmail],
        subject: `Cita confirmada (${summary.bookingCode}) — ${shop.shopName}`,
        html: clientHtml,
        text: clientText,
        replyTo: shop.shopEmail,
      });
      if (clientRes.ok) {
        sentRecipients.push(summary.clientEmail);
      } else if (clientRes.error) {
        errors.push(clientRes.error);
      }
    }

    if (staffRecipients.length > 0) {
      const staffHtml = buildEmailLayout({
        shopName: shop.shopName,
        preheader: `Nueva cita ${summary.bookingCode} con ${summary.barberName} (${formattedSchedule}).`,
        kicker: 'Aviso de agenda interna',
        title: `Nueva cita reservada: ${summary.clientName}`,
        intro: `Se registró una nueva cita en línea desde la plataforma pública. El horario ya quedó bloqueado automáticamente en Cloud Firestore.`,
        highlightLabel: 'Código de cita',
        highlightValue: summary.bookingCode,
        rows: [
          { label: 'Cliente', value: summary.clientName },
          { label: 'Teléfono', value: summary.clientPhone },
          { label: 'Correo', value: summary.clientEmail },
          { label: 'Servicio', value: `${summary.serviceName} (${priceLabel})` },
          { label: 'Barbero', value: summary.barberName },
          { label: 'Fecha y horario', value: formattedSchedule },
          ...(summary.notes
            ? [{ label: 'Indicaciones', value: summary.notes }]
            : []),
        ],
        ctaLabel: 'Abrir panel de agenda',
        ctaUrl: panelUrl,
        footerNote: `Notificación operativa automática de ${shop.shopName}.`,
      });

      const staffText = [
        `Nueva cita agendada (${summary.bookingCode})`,
        `Cliente: ${summary.clientName} (${summary.clientPhone} / ${summary.clientEmail})`,
        `Servicio: ${summary.serviceName} (${priceLabel})`,
        `Barbero: ${summary.barberName}`,
        `Horario: ${formattedSchedule}`,
        `Panel: ${panelUrl}`,
      ].join('\n');

      const staffRes = await safeSendSingleEmail(resend, {
        from: fromEmail,
        to: staffRecipients,
        subject: `Nueva cita ${summary.bookingCode} · ${summary.clientName} (${formatTime12h(summary.startTime)})`,
        html: staffHtml,
        text: staffText,
      });
      if (staffRes.ok) {
        sentRecipients.push(...staffRecipients);
      } else if (staffRes.error) {
        errors.push(staffRes.error);
      }
    }

    return {
      sent: sentRecipients.length > 0,
      recipients: sentRecipients,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  } catch (err) {
    return {
      sent: false,
      recipients: [],
      error: translateErrorMessageEs(err, 'Error inesperado al notificar'),
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
}): Promise<EmailDispatchResult> {
  const resend = getResendClient();
  if (!resend) {
    return {
      sent: false,
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
    } = params;
    const baseUrl = resolveAppBaseUrl(requestOrigin);
    const manageToken =
      summary.manageToken ||
      createBookingManageToken(summary.id, summary.clientEmail);
    const manageUrl = `${baseUrl}/reservar?gestionar=1&token=${encodeURIComponent(manageToken)}`;
    const panelUrl = `${baseUrl}/login`;
    const fromEmail = getFromEmail();

    const { shop, staffRecipients } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      excludeEmail: summary.clientEmail,
    });

    const newSchedule = `${formatDateBogotaEs(summary.date)} · ${formatTime12h(summary.startTime)} – ${formatTime12h(summary.endTime)}`;
    const prevSchedule = `${formatDateBogotaEs(previousDate)} · ${formatTime12h(previousStartTime)} – ${formatTime12h(previousEndTime)}`;
    const priceLabel = `${formatCurrencyCOP(summary.priceCop)} · ${summary.durationMinutes} min`;

    const sentRecipients: string[] = [];
    const errors: string[] = [];

    if (isValidDeliverableEmail(summary.clientEmail)) {
      const clientHtml = buildEmailLayout({
        shopName: shop.shopName,
        preheader: `Tu cita ${summary.bookingCode} fue reprogramada para el ${newSchedule}.`,
        kicker: 'Cambio de horario confirmado',
        title: `Tu cita fue reprogramada, ${summary.clientName}`,
        intro: `Actualizamos tu turno correctamente y liberamos el horario anterior en nuestra agenda.`,
        highlightLabel: 'Código de reserva',
        highlightValue: summary.bookingCode,
        rows: [
          { label: 'Servicio', value: `${summary.serviceName} (${priceLabel})` },
          { label: 'Barbero asignado', value: summary.barberName },
          { label: 'Nuevo horario', value: newSchedule },
          { label: 'Horario anterior', value: prevSchedule },
          { label: 'Ubicación', value: `${shop.address}, ${shop.city}` },
        ],
        ctaLabel: 'Ver o gestionar reserva',
        ctaUrl: manageUrl,
        footerNote: `${shop.shopName} · ${shop.address}, ${shop.city} · Tel: ${shop.phone}.`,
      });

      const clientText = [
        `${shop.shopName} — Cita reprogramada`,
        `Código: ${summary.bookingCode}`,
        `Nuevo horario: ${newSchedule}`,
        `Horario anterior: ${prevSchedule}`,
        `Barbero: ${summary.barberName}`,
        `Gestionar: ${manageUrl}`,
      ].join('\n');

      const clientRes = await safeSendSingleEmail(resend, {
        from: fromEmail,
        to: [summary.clientEmail],
        subject: `Cita reprogramada (${summary.bookingCode}) — ${shop.shopName}`,
        html: clientHtml,
        text: clientText,
        replyTo: shop.shopEmail,
      });
      if (clientRes.ok) sentRecipients.push(summary.clientEmail);
      else if (clientRes.error) errors.push(clientRes.error);
    }

    if (staffRecipients.length > 0) {
      const staffHtml = buildEmailLayout({
        shopName: shop.shopName,
        preheader: `Reprogramación de cita ${summary.bookingCode} por el cliente.`,
        kicker: 'Actualización de agenda',
        title: `Cita reprogramada: ${summary.clientName}`,
        intro: `El cliente modificó el horario de su reserva desde la web. El espacio anterior quedó libre.`,
        highlightLabel: 'Código de cita',
        highlightValue: summary.bookingCode,
        rows: [
          { label: 'Cliente', value: `${summary.clientName} (${summary.clientPhone})` },
          { label: 'Servicio', value: summary.serviceName },
          { label: 'Barbero', value: summary.barberName },
          { label: 'Nuevo horario', value: newSchedule },
          { label: 'Horario anterior', value: prevSchedule },
        ],
        ctaLabel: 'Ver agenda actualizada',
        ctaUrl: panelUrl,
        footerNote: `Notificación operativa automática de ${shop.shopName}.`,
      });

      const staffText = [
        `Cita reprogramada (${summary.bookingCode})`,
        `Cliente: ${summary.clientName} (${summary.clientPhone})`,
        `Nuevo horario: ${newSchedule}`,
        `Horario anterior: ${prevSchedule}`,
      ].join('\n');

      const staffRes = await safeSendSingleEmail(resend, {
        from: fromEmail,
        to: staffRecipients,
        subject: `Cita reprogramada ${summary.bookingCode} · ${summary.clientName}`,
        html: staffHtml,
        text: staffText,
      });
      if (staffRes.ok) sentRecipients.push(...staffRecipients);
      else if (staffRes.error) errors.push(staffRes.error);
    }

    return {
      sent: sentRecipients.length > 0,
      recipients: sentRecipients,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  } catch (err) {
    return {
      sent: false,
      recipients: [],
      error: translateErrorMessageEs(err, 'Error al enviar notificación'),
    };
  }
}

export async function sendBookingCancelledEmails(params: {
  summary: PublicBookingSummary;
  cancelledBy: 'cliente' | 'barbero' | 'admin';
  barberUid?: string;
  idToken?: string;
  requestOrigin?: string;
}): Promise<EmailDispatchResult> {
  const resend = getResendClient();
  if (!resend) {
    return {
      sent: false,
      skipped: true,
      reason: 'RESEND_API_KEY no configurada',
      recipients: [],
    };
  }

  try {
    const { summary, cancelledBy, barberUid, idToken, requestOrigin } = params;
    const baseUrl = resolveAppBaseUrl(requestOrigin);
    const rebookUrl = `${baseUrl}/reservar`;
    const panelUrl = `${baseUrl}/login`;
    const fromEmail = getFromEmail();

    const { shop, staffRecipients } = await resolveShopAndStaffRecipients({
      barberId: summary.barberId,
      barberUid,
      idToken,
      excludeEmail: summary.clientEmail,
    });

    const formattedSchedule = `${formatDateBogotaEs(summary.date)} · ${formatTime12h(summary.startTime)} – ${formatTime12h(summary.endTime)}`;
    const cancelledByLabel =
      cancelledBy === 'cliente'
        ? 'Cancelada por el cliente'
        : cancelledBy === 'barbero'
          ? 'Cancelada por el barbero'
          : 'Cancelada por administración';

    const sentRecipients: string[] = [];
    const errors: string[] = [];

    if (isValidDeliverableEmail(summary.clientEmail)) {
      const clientHtml = buildEmailLayout({
        shopName: shop.shopName,
        preheader: `Tu cita ${summary.bookingCode} fue cancelada.`,
        kicker: 'Aviso de cancelación',
        title: `Cita cancelada (${summary.bookingCode})`,
        intro:
          cancelledBy === 'cliente'
            ? `Confirmamos la cancelación de tu cita en ${shop.shopName}. Si deseas volver a agendar en otro horario, puedes hacerlo cuando prefieras.`
            : `Tu cita programada en ${shop.shopName} fue cancelada por el equipo de la barbería. Puedes elegir un nuevo turno en línea en cualquier momento.`,
        rows: [
          { label: 'Servicio', value: summary.serviceName },
          { label: 'Barbero', value: summary.barberName },
          { label: 'Horario cancelado', value: formattedSchedule },
          { label: 'Estado', value: 'Cancelada' },
        ],
        ctaLabel: 'Agendar una nueva cita',
        ctaUrl: rebookUrl,
        footerNote: `${shop.shopName} · ${shop.address}, ${shop.city} · Tel: ${shop.phone}.`,
      });

      const clientText = [
        `${shop.shopName} — Cita cancelada`,
        `Código: ${summary.bookingCode}`,
        `Servicio: ${summary.serviceName}`,
        `Horario cancelado: ${formattedSchedule}`,
        `Agendar nueva cita: ${rebookUrl}`,
      ].join('\n');

      const clientRes = await safeSendSingleEmail(resend, {
        from: fromEmail,
        to: [summary.clientEmail],
        subject: `Cita cancelada (${summary.bookingCode}) — ${shop.shopName}`,
        html: clientHtml,
        text: clientText,
        replyTo: shop.shopEmail,
      });
      if (clientRes.ok) sentRecipients.push(summary.clientEmail);
      else if (clientRes.error) errors.push(clientRes.error);
    }

    if (staffRecipients.length > 0) {
      const staffHtml = buildEmailLayout({
        shopName: shop.shopName,
        preheader: `Cita ${summary.bookingCode} cancelada; el espacio quedó disponible.`,
        kicker: cancelledByLabel,
        title: `Turno liberado: ${summary.clientName}`,
        intro: `La cita fue marcada como cancelada y el horario quedó libre nuevamente para otros clientes.`,
        highlightLabel: 'Código cancelado',
        highlightValue: summary.bookingCode,
        rows: [
          { label: 'Cliente', value: `${summary.clientName} (${summary.clientPhone})` },
          { label: 'Servicio', value: summary.serviceName },
          { label: 'Barbero', value: summary.barberName },
          { label: 'Horario liberado', value: formattedSchedule },
          { label: 'Origen', value: cancelledByLabel },
        ],
        ctaLabel: 'Revisar agenda',
        ctaUrl: panelUrl,
        footerNote: `Notificación operativa automática de ${shop.shopName}.`,
      });

      const staffText = [
        `Cita cancelada (${summary.bookingCode}) — ${cancelledByLabel}`,
        `Cliente: ${summary.clientName} (${summary.clientPhone})`,
        `Barbero: ${summary.barberName}`,
        `Horario liberado: ${formattedSchedule}`,
      ].join('\n');

      const staffRes = await safeSendSingleEmail(resend, {
        from: fromEmail,
        to: staffRecipients,
        subject: `Cita cancelada ${summary.bookingCode} · ${summary.clientName}`,
        html: staffHtml,
        text: staffText,
      });
      if (staffRes.ok) sentRecipients.push(...staffRecipients);
      else if (staffRes.error) errors.push(staffRes.error);
    }

    return {
      sent: sentRecipients.length > 0,
      recipients: sentRecipients,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  } catch (err) {
    return {
      sent: false,
      recipients: [],
      error: translateErrorMessageEs(err, 'Error al enviar cancelación'),
    };
  }
}

export async function sendTestNotificationEmail(params: {
  toEmail: string;
  idToken?: string;
  requestOrigin?: string;
}): Promise<EmailDispatchResult> {
  const resend = getResendClient();
  if (!resend) {
    return {
      sent: false,
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
      recipients: [],
      error: 'Ingresa un correo electrónico válido para la prueba.',
    };
  }

  const { shop } = await resolveShopAndStaffRecipients({
    idToken: params.idToken,
  });
  const baseUrl = resolveAppBaseUrl(params.requestOrigin);
  const fromEmail = getFromEmail();

  const html = buildEmailLayout({
    shopName: shop.shopName,
    preheader: `Prueba de notificaciones Resend desde ${shop.shopName}.`,
    kicker: 'Verificación de correo electrónico',
    title: 'Las notificaciones con Resend funcionan correctamente',
    intro: `Este mensaje confirma que el servidor de ${shop.shopName} tiene conectividad activa con Resend para enviar confirmaciones, reprogramaciones y cancelaciones de citas.`,
    rows: [
      { label: 'Remitente activo', value: fromEmail },
      { label: 'Destinatario de prueba', value: target },
      { label: 'URL base de enlaces', value: baseUrl },
      { label: 'Zona horaria', value: SYSTEM_TIMEZONE },
    ],
    ctaLabel: 'Ir al panel de administración',
    ctaUrl: `${baseUrl}/admin/configuracion`,
    footerNote: `Correo de verificación emitido desde el módulo de configuración de ${shop.shopName}.`,
  });

  const text = [
    `${shop.shopName} — Prueba de notificaciones Resend`,
    `Remitente: ${fromEmail}`,
    `Destinatario: ${target}`,
    `URL base: ${baseUrl}`,
  ].join('\n');

  const res = await safeSendSingleEmail(resend, {
    from: fromEmail,
    to: [target],
    subject: `Prueba de correo Resend — ${shop.shopName}`,
    html,
    text,
    replyTo: shop.shopEmail,
  });

  if (!res.ok) {
    return {
      sent: false,
      recipients: [],
      error: res.error || 'Resend rechazó el envío de prueba.',
    };
  }

  return {
    sent: true,
    recipients: [target],
  };
}
