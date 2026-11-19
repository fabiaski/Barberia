import { createHmac } from 'node:crypto';

export const SYSTEM_TIMEZONE = 'America/Bogota';
export const DEFAULT_FROM_EMAIL = 'Barbería Estudio <onboarding@resend.dev>';

export interface ShopEmailContext {
  shopName: string;
  address: string;
  city: string;
  phone: string;
  shopEmail: string;
  adminNotificationEmail: string;
}

export const DEFAULT_SHOP_EMAIL_CONTEXT: ShopEmailContext = {
  shopName: 'Barbería Estudio',
  address: 'Calle 59 # 8-34, Local 2 · Chapinero Alto',
  city: 'Bogotá, Colombia',
  phone: '+57 310 458 9210',
  shopEmail: 'reservas@barberiaestudio.co',
  adminNotificationEmail: '',
};

export interface AppointmentEmailSummary {
  id: string;
  bookingCode: string;
  serviceId: string;
  serviceName: string;
  priceCop: number;
  durationMinutes: number;
  barberId: string;
  barberUid: string;
  barberName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  notes?: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
}

export interface EmailMessagePayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export function cleanEnvValue(value: string | undefined): string {
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

export function isValidDeliverableEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatCurrencyCOP(amount: number): string {
  const rounded = Math.round(Number.isFinite(amount) ? amount : 0);
  const formatted = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  }).format(rounded);
  return `$ ${formatted}`;
}

export function timeToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh * 60 + mm;
}

export function minutesToTime(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hh = String(Math.floor(safe / 60)).padStart(2, '0');
  const mm = String(safe % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatTime12h(time24: string): string {
  const [hhRaw, mmRaw] = time24.split(':').map(Number);
  if (!Number.isFinite(hhRaw) || !Number.isFinite(mmRaw)) return time24;
  const period = hhRaw >= 12 ? 'PM' : 'AM';
  const hh12 = hhRaw % 12 === 0 ? 12 : hhRaw % 12;
  return `${hh12}:${String(mmRaw).padStart(2, '0')} ${period}`;
}

export function formatDateBogotaEs(dateStr: string): string {
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

export function formatDateReceiptLongEs(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const monthsEs = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  const monthName = monthsEs[month - 1];
  if (!monthName) return formatDateBogotaEs(dateStr);
  return `${day} de ${monthName} del ${year}`;
}

export function createBookingManageToken(
  appointmentId: string,
  clientEmail: string,
  secret: string,
  ttlDays: number = 30
): string {
  const payload = {
    id: appointmentId,
    email: clientEmail.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60,
  };
  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    'utf-8'
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function getShopMonogram(shopName: string): string {
  const words = shopName
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return (words[0]?.slice(0, 2) || 'BE').toUpperCase();
}

function buildClientReceiptEmailLayout(params: {
  shop: ShopEmailContext;
  preheader: string;
  title: string;
  greetingName: string;
  subtitleLine: string;
  statusNote?: string;
  accentTone?: 'blue' | 'red';
  appointmentDetails: Array<{ label: string; value: string }>;
  serviceName: string;
  serviceDurationLabel: string;
  serviceBarberLabel: string;
  servicePriceLabel: string;
  notes?: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  const isRed = params.accentTone === 'red';
  const boxBg = isRed ? '#fef2f2' : '#eef4ff';
  const boxBorder = isRed ? '#fecaca' : '#dbeafe';
  const labelColor = isRed ? '#991b1b' : '#1e3a8a';
  const valueColor = isRed ? '#dc2626' : '#1d4ed8';
  const brandColor = isRed ? '#dc2626' : '#1a6bff';
  const monogram = getShopMonogram(params.shop.shopName);

  const detailsHtml = params.appointmentDetails
    .map(
      (item, index) => `
        <p style="margin:${index === 0 ? '0' : '8px 0 0 0'};font-size:13px;line-height:1.5;color:${valueColor};">
          <strong style="color:${labelColor};font-weight:700;">${escapeHtml(item.label)}:</strong>
          <span> ${escapeHtml(item.value)}</span>
        </p>`
    )
    .join('');

  const notesHtml = params.notes
    ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #f3f4f6;font-size:12px;line-height:1.5;color:#4b5563;">
        <strong style="color:#111827;">Indicaciones:</strong> ${escapeHtml(params.notes)}
      </div>`
    : '';

  const statusNoteHtml = params.statusNote
    ? `<p style="margin:10px auto 0 auto;max-width:440px;font-size:12px;line-height:1.55;color:#4b5563;text-align:center;">
        ${escapeHtml(params.statusNote)}
      </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(params.preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6;padding:32px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:34px 28px 28px 28px;">
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 18px auto;">
                <tr>
                  <td align="center" valign="middle" style="width:46px;height:46px;border-radius:12px;border:2px solid ${brandColor};background-color:${isRed ? '#fff5f5' : '#eff6ff'};font-size:16px;font-weight:800;letter-spacing:0.04em;color:${brandColor};text-align:center;">
                    ${escapeHtml(monogram)}
                  </td>
                </tr>
              </table>

              <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:#111827;text-align:center;">
                Hola ${escapeHtml(params.greetingName)}
              </h1>
              <p style="margin:8px 0 0 0;font-size:13px;line-height:1.5;color:#4b5563;text-align:center;">
                ${escapeHtml(params.subtitleLine)}
              </p>
              <p style="margin:3px 0 0 0;font-size:13px;line-height:1.4;font-weight:800;letter-spacing:0.03em;color:#111827;text-transform:uppercase;text-align:center;">
                ${escapeHtml(params.shop.shopName)}
              </p>
              ${statusNoteHtml}

              <div style="margin:26px 0 9px 0;font-size:11px;font-weight:600;letter-spacing:0.06em;color:#6b7280;text-transform:uppercase;">
                DATOS DE TU CITA
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${boxBg};border:1px solid ${boxBorder};border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    ${detailsHtml}
                  </td>
                </tr>
              </table>

              <div style="margin:22px 0 9px 0;font-size:11px;font-weight:600;letter-spacing:0.06em;color:#6b7280;text-transform:uppercase;">
                RESUMEN DE SERVICIOS
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-size:13px;font-weight:700;letter-spacing:0.02em;color:#111827;text-transform:uppercase;">
                      ${escapeHtml(params.serviceName)}
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;">
                      <tr>
                        <td style="font-size:12px;color:#4b5563;vertical-align:middle;">
                          ${escapeHtml(params.serviceDurationLabel)} · ${escapeHtml(params.serviceBarberLabel)}
                        </td>
                        <td style="font-size:14px;font-weight:700;color:#111827;text-align:right;vertical-align:middle;white-space:nowrap;">
                          ${escapeHtml(params.servicePriceLabel)}
                        </td>
                      </tr>
                    </table>
                    ${notesHtml}
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(params.ctaUrl)}" style="display:inline-block;background-color:${brandColor};color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:12px 24px;border-radius:8px;">
                      ${escapeHtml(params.ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;padding:16px 28px;border-top:1px solid #e5e7eb;font-size:11px;line-height:1.5;color:#6b7280;text-align:center;">
              ${escapeHtml(params.shop.shopName)} · ${escapeHtml(params.shop.address)}, ${escapeHtml(params.shop.city)} · Tel: ${escapeHtml(params.shop.phone)} · Horario ${SYSTEM_TIMEZONE}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildStaffEmailLayout(params: {
  shopName: string;
  preheader: string;
  kicker: string;
  title: string;
  intro: string;
  highlightLabel: string;
  highlightValue: string;
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
              <div style="font-size:12px;color:#d6d3d1;margin-top:2px;">Notificación de agenda · ${SYSTEM_TIMEZONE}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <div style="font-size:12px;font-weight:600;color:#b45309;margin-bottom:6px;">${escapeHtml(params.kicker)}</div>
              <h1 style="margin:0 0 10px 0;font-size:22px;line-height:1.3;font-weight:700;color:#1c1917;">${escapeHtml(params.title)}</h1>
              <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#57534e;">${escapeHtml(params.intro)}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background-color:#fafaf9;border:1px solid #d6d3d1;border-radius:10px;">
                <tr>
                  <td style="padding:16px 20px;text-align:center;">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#78716c;margin-bottom:4px;">${escapeHtml(params.highlightLabel)}</div>
                    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:700;letter-spacing:0.12em;color:#b45309;">${escapeHtml(params.highlightValue)}</div>
                  </td>
                </tr>
              </table>
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

export function buildConfirmationPayloads(params: {
  summary: AppointmentEmailSummary;
  shop: ShopEmailContext;
  fromEmail: string;
  baseUrl: string;
  manageTokenSecret: string;
  barberEmail?: string;
  adminEmail?: string;
}): {
  clientPayload: EmailMessagePayload | null;
  barberPayload: EmailMessagePayload | null;
  adminPayload: EmailMessagePayload | null;
  manageUrl: string;
} {
  const {
    summary,
    shop,
    fromEmail,
    baseUrl,
    manageTokenSecret,
    barberEmail,
    adminEmail,
  } = params;

  const manageToken = createBookingManageToken(
    summary.id,
    summary.clientEmail,
    manageTokenSecret
  );
  const manageUrl = `${baseUrl}/reservar?gestionar=1&token=${encodeURIComponent(manageToken)}`;
  const barberPanelUrl = `${baseUrl}/barbero`;
  const adminPanelUrl = `${baseUrl}/admin`;

  const formattedDateReceipt = formatDateReceiptLongEs(summary.date);
  const formattedTimeRange = `${formatTime12h(summary.startTime)} – ${formatTime12h(summary.endTime)}`;
  const formattedSchedule = `${formatDateBogotaEs(summary.date)} · ${formattedTimeRange}`;
  const priceLabel = formatCurrencyCOP(summary.priceCop);
  const priceDurationLabel = `${priceLabel} · ${summary.durationMinutes} min`;

  const clientEmailClean = summary.clientEmail.trim().toLowerCase();
  const clientPayload: EmailMessagePayload | null = isValidDeliverableEmail(
    clientEmailClean
  )
    ? {
        from: fromEmail,
        to: [clientEmailClean],
        subject: `Cita confirmada (${summary.bookingCode}) — ${shop.shopName}`,
        html: buildClientReceiptEmailLayout({
          shop,
          preheader: `Tu cita ${summary.bookingCode} quedó confirmada para el ${formattedDateReceipt} a las ${formatTime12h(summary.startTime)}.`,
          title: `Confirmación de reserva — ${shop.shopName}`,
          greetingName: summary.clientName,
          subtitleLine: 'Tu reserva fue recibida exitosamente en:',
          appointmentDetails: [
            { label: 'Fecha', value: formattedDateReceipt },
            { label: 'Hora', value: formattedTimeRange },
            { label: 'Barbero', value: summary.barberName },
            { label: 'Dirección', value: `${shop.address} (${shop.city})` },
            { label: 'Teléfono', value: shop.phone },
            { label: 'Código de reserva', value: summary.bookingCode },
          ],
          serviceName: summary.serviceName,
          serviceDurationLabel: `${summary.durationMinutes} min`,
          serviceBarberLabel: `Barbero: ${summary.barberName}`,
          servicePriceLabel: priceLabel,
          notes: summary.notes,
          ctaLabel: 'Consultar, reprogramar o cancelar cita',
          ctaUrl: manageUrl,
        }),
        text: [
          `Hola ${summary.clientName}`,
          `Tu reserva fue recibida exitosamente en: ${shop.shopName}`,
          '',
          'DATOS DE TU CITA',
          `Fecha: ${formattedDateReceipt}`,
          `Hora: ${formattedTimeRange}`,
          `Barbero: ${summary.barberName}`,
          `Dirección: ${shop.address}, ${shop.city}`,
          `Teléfono: ${shop.phone}`,
          `Código: ${summary.bookingCode}`,
          '',
          'RESUMEN DE SERVICIOS',
          `${summary.serviceName} (${priceDurationLabel})`,
          `Gestionar cita: ${manageUrl}`,
        ].join('\n'),
        replyTo: isValidDeliverableEmail(shop.shopEmail)
          ? shop.shopEmail
          : undefined,
      }
    : null;

  const staffRows = [
    { label: 'Cliente', value: summary.clientName },
    { label: 'Teléfono', value: summary.clientPhone },
    { label: 'Correo del cliente', value: summary.clientEmail },
    { label: 'Servicio', value: `${summary.serviceName} (${priceDurationLabel})` },
    { label: 'Valor catálogo', value: priceLabel },
    { label: 'Barbero asignado', value: summary.barberName },
    { label: 'Fecha y horario', value: formattedSchedule },
    ...(summary.notes ? [{ label: 'Indicaciones', value: summary.notes }] : []),
  ];

  const barberEmailClean = barberEmail?.trim().toLowerCase() ?? '';
  const barberPayload: EmailMessagePayload | null = isValidDeliverableEmail(
    barberEmailClean
  )
    ? {
        from: fromEmail,
        to: [barberEmailClean],
        subject: `Nueva cita asignada ${summary.bookingCode} · ${summary.clientName} (${formatTime12h(summary.startTime)})`,
        html: buildStaffEmailLayout({
          shopName: shop.shopName,
          preheader: `Tienes una nueva cita ${summary.bookingCode} con ${summary.clientName} (${formattedSchedule}).`,
          kicker: 'Aviso para tu agenda personal',
          title: `Hola ${summary.barberName}, tienes una nueva cita confirmada`,
          intro:
            'Un cliente agendó un servicio contigo y el turno ya quedó bloqueado automáticamente en tu calendario.',
          highlightLabel: 'Código de cita',
          highlightValue: summary.bookingCode,
          rows: staffRows,
          ctaLabel: 'Abrir mi agenda de barbero',
          ctaUrl: barberPanelUrl,
          footerNote: `Notificación directa para ${summary.barberName} · ${shop.shopName}.`,
        }),
        text: [
          `Hola ${summary.barberName}, tienes una nueva cita confirmada (${summary.bookingCode})`,
          `Cliente: ${summary.clientName} (${summary.clientPhone} / ${summary.clientEmail})`,
          `Servicio: ${summary.serviceName} (${priceDurationLabel})`,
          `Horario: ${formattedSchedule}`,
          `Panel: ${barberPanelUrl}`,
        ].join('\n'),
      }
    : null;

  const adminEmailClean = adminEmail?.trim().toLowerCase() ?? '';
  const adminPayload: EmailMessagePayload | null =
    isValidDeliverableEmail(adminEmailClean) &&
    adminEmailClean !== barberEmailClean
      ? {
          from: fromEmail,
          to: [adminEmailClean],
          subject: `Nueva cita ${summary.bookingCode} · ${summary.clientName} (${formatTime12h(summary.startTime)})`,
          html: buildStaffEmailLayout({
            shopName: shop.shopName,
            preheader: `Nueva cita ${summary.bookingCode} con ${summary.barberName} (${formattedSchedule}).`,
            kicker: 'Aviso de agenda interna',
            title: `Nueva cita confirmada: ${summary.clientName}`,
            intro:
              'Se confirmó una reserva en línea con los precios y duración validados contra el catálogo de la barbería.',
            highlightLabel: 'Código de cita',
            highlightValue: summary.bookingCode,
            rows: staffRows,
            ctaLabel: 'Abrir panel administrativo',
            ctaUrl: adminPanelUrl,
            footerNote: `Copia operativa automática de ${shop.shopName}.`,
          }),
          text: [
            `Nueva cita confirmada (${summary.bookingCode})`,
            `Cliente: ${summary.clientName} (${summary.clientPhone} / ${summary.clientEmail})`,
            `Servicio: ${summary.serviceName} (${priceDurationLabel})`,
            `Barbero: ${summary.barberName}`,
            `Horario: ${formattedSchedule}`,
            `Panel: ${adminPanelUrl}`,
          ].join('\n'),
        }
      : null;

  return { clientPayload, barberPayload, adminPayload, manageUrl };
}

export function buildCancelledPayloads(params: {
  summary: AppointmentEmailSummary;
  shop: ShopEmailContext;
  fromEmail: string;
  baseUrl: string;
  barberEmail?: string;
  adminEmail?: string;
}): {
  clientPayload: EmailMessagePayload | null;
  barberPayload: EmailMessagePayload | null;
  adminPayload: EmailMessagePayload | null;
} {
  const { summary, shop, fromEmail, baseUrl, barberEmail, adminEmail } = params;
  const rebookUrl = `${baseUrl}/reservar`;
  const barberPanelUrl = `${baseUrl}/barbero`;
  const adminPanelUrl = `${baseUrl}/admin`;

  const formattedDateReceipt = formatDateReceiptLongEs(summary.date);
  const formattedTimeRange = `${formatTime12h(summary.startTime)} – ${formatTime12h(summary.endTime)}`;
  const formattedSchedule = `${formatDateBogotaEs(summary.date)} · ${formattedTimeRange}`;
  const priceLabel = formatCurrencyCOP(summary.priceCop);
  const priceDurationLabel = `${priceLabel} · ${summary.durationMinutes} min`;

  const clientEmailClean = summary.clientEmail.trim().toLowerCase();
  const clientPayload: EmailMessagePayload | null = isValidDeliverableEmail(
    clientEmailClean
  )
    ? {
        from: fromEmail,
        to: [clientEmailClean],
        subject: `Cita cancelada (${summary.bookingCode}) — ${shop.shopName}`,
        html: buildClientReceiptEmailLayout({
          shop,
          preheader: `Tu cita ${summary.bookingCode} fue cancelada.`,
          title: `Cita cancelada — ${shop.shopName}`,
          greetingName: summary.clientName,
          subtitleLine: 'Tu cita fue cancelada en:',
          statusNote:
            'El horario quedó liberado. Puedes elegir un nuevo turno en línea cuando prefieras.',
          accentTone: 'red',
          appointmentDetails: [
            { label: 'Fecha', value: formattedDateReceipt },
            { label: 'Hora', value: formattedTimeRange },
            { label: 'Barbero', value: summary.barberName },
            { label: 'Dirección', value: `${shop.address} (${shop.city})` },
            { label: 'Teléfono', value: shop.phone },
            { label: 'Código de reserva', value: summary.bookingCode },
            { label: 'Estado', value: 'Cancelada' },
          ],
          serviceName: summary.serviceName,
          serviceDurationLabel: `${summary.durationMinutes} min`,
          serviceBarberLabel: `Barbero: ${summary.barberName}`,
          servicePriceLabel: priceLabel,
          ctaLabel: 'Agendar una nueva cita',
          ctaUrl: rebookUrl,
        }),
        text: [
          `Hola ${summary.clientName}`,
          `${shop.shopName} — Cita cancelada`,
          `Código: ${summary.bookingCode}`,
          `Servicio: ${summary.serviceName} (${priceDurationLabel})`,
          `Barbero: ${summary.barberName}`,
          `Horario cancelado: ${formattedSchedule}`,
          `Agendar nueva cita: ${rebookUrl}`,
        ].join('\n'),
        replyTo: isValidDeliverableEmail(shop.shopEmail)
          ? shop.shopEmail
          : undefined,
      }
    : null;

  const staffRows = [
    { label: 'Cliente', value: `${summary.clientName} (${summary.clientPhone})` },
    { label: 'Servicio', value: `${summary.serviceName} (${priceDurationLabel})` },
    { label: 'Barbero', value: summary.barberName },
    { label: 'Horario liberado', value: formattedSchedule },
  ];

  const barberEmailClean = barberEmail?.trim().toLowerCase() ?? '';
  const barberPayload: EmailMessagePayload | null = isValidDeliverableEmail(
    barberEmailClean
  )
    ? {
        from: fromEmail,
        to: [barberEmailClean],
        subject: `Cita cancelada ${summary.bookingCode} · ${summary.clientName}`,
        html: buildStaffEmailLayout({
          shopName: shop.shopName,
          preheader: `Se canceló la cita ${summary.bookingCode}; tu turno quedó libre.`,
          kicker: 'Cancelación en tu agenda',
          title: `Turno liberado: ${summary.clientName}`,
          intro:
            'La cita fue marcada como cancelada y ese horario vuelve a estar disponible en tu agenda.',
          highlightLabel: 'Código cancelado',
          highlightValue: summary.bookingCode,
          rows: staffRows,
          ctaLabel: 'Ver mi agenda',
          ctaUrl: barberPanelUrl,
          footerNote: `Notificación para ${summary.barberName} · ${shop.shopName}.`,
        }),
        text: [
          `Cita cancelada (${summary.bookingCode})`,
          `Cliente: ${summary.clientName} (${summary.clientPhone})`,
          `Servicio: ${summary.serviceName} (${priceDurationLabel})`,
          `Horario liberado: ${formattedSchedule}`,
        ].join('\n'),
      }
    : null;

  const adminEmailClean = adminEmail?.trim().toLowerCase() ?? '';
  const adminPayload: EmailMessagePayload | null =
    isValidDeliverableEmail(adminEmailClean) &&
    adminEmailClean !== barberEmailClean
      ? {
          from: fromEmail,
          to: [adminEmailClean],
          subject: `Cita cancelada ${summary.bookingCode} · ${summary.clientName}`,
          html: buildStaffEmailLayout({
            shopName: shop.shopName,
            preheader: `Cita ${summary.bookingCode} cancelada; el espacio quedó disponible.`,
            kicker: 'Aviso de cancelación',
            title: `Turno liberado: ${summary.clientName}`,
            intro:
              'La cita fue marcada como cancelada y el horario quedó libre nuevamente para otros clientes.',
            highlightLabel: 'Código cancelado',
            highlightValue: summary.bookingCode,
            rows: staffRows,
            ctaLabel: 'Revisar agenda',
            ctaUrl: adminPanelUrl,
            footerNote: `Copia operativa automática de ${shop.shopName}.`,
          }),
          text: [
            `Cita cancelada (${summary.bookingCode})`,
            `Cliente: ${summary.clientName} (${summary.clientPhone})`,
            `Barbero: ${summary.barberName}`,
            `Horario liberado: ${formattedSchedule}`,
          ].join('\n'),
        }
      : null;

  return { clientPayload, barberPayload, adminPayload };
}

export function buildRescheduledPayloads(params: {
  summary: AppointmentEmailSummary;
  previousDate: string;
  previousStartTime: string;
  previousEndTime: string;
  shop: ShopEmailContext;
  fromEmail: string;
  baseUrl: string;
  manageTokenSecret: string;
  barberEmail?: string;
  adminEmail?: string;
}): {
  clientPayload: EmailMessagePayload | null;
  barberPayload: EmailMessagePayload | null;
  adminPayload: EmailMessagePayload | null;
} {
  const {
    summary,
    previousDate,
    previousStartTime,
    previousEndTime,
    shop,
    fromEmail,
    baseUrl,
    manageTokenSecret,
    barberEmail,
    adminEmail,
  } = params;

  const manageToken = createBookingManageToken(
    summary.id,
    summary.clientEmail,
    manageTokenSecret
  );
  const manageUrl = `${baseUrl}/reservar?gestionar=1&token=${encodeURIComponent(manageToken)}`;
  const barberPanelUrl = `${baseUrl}/barbero`;
  const adminPanelUrl = `${baseUrl}/admin`;

  const formattedDateReceipt = formatDateReceiptLongEs(summary.date);
  const formattedTimeRange = `${formatTime12h(summary.startTime)} – ${formatTime12h(summary.endTime)}`;
  const newSchedule = `${formatDateBogotaEs(summary.date)} · ${formattedTimeRange}`;
  const prevSchedule = `${formatDateReceiptLongEs(previousDate)} · ${formatTime12h(previousStartTime)} – ${formatTime12h(previousEndTime)}`;
  const priceLabel = formatCurrencyCOP(summary.priceCop);
  const priceDurationLabel = `${priceLabel} · ${summary.durationMinutes} min`;

  const clientEmailClean = summary.clientEmail.trim().toLowerCase();
  const clientPayload: EmailMessagePayload | null = isValidDeliverableEmail(
    clientEmailClean
  )
    ? {
        from: fromEmail,
        to: [clientEmailClean],
        subject: `Cita reprogramada (${summary.bookingCode}) — ${shop.shopName}`,
        html: buildClientReceiptEmailLayout({
          shop,
          preheader: `Tu cita ${summary.bookingCode} fue reprogramada para el ${formattedDateReceipt} a las ${formatTime12h(summary.startTime)}.`,
          title: `Cita reprogramada — ${shop.shopName}`,
          greetingName: summary.clientName,
          subtitleLine: 'Tu cita fue reprogramada exitosamente en:',
          statusNote:
            'Liberamos tu horario anterior en nuestra agenda automáticamente.',
          appointmentDetails: [
            { label: 'Fecha', value: formattedDateReceipt },
            { label: 'Hora', value: formattedTimeRange },
            { label: 'Horario anterior', value: prevSchedule },
            { label: 'Barbero', value: summary.barberName },
            { label: 'Dirección', value: `${shop.address} (${shop.city})` },
            { label: 'Teléfono', value: shop.phone },
            { label: 'Código de reserva', value: summary.bookingCode },
          ],
          serviceName: summary.serviceName,
          serviceDurationLabel: `${summary.durationMinutes} min`,
          serviceBarberLabel: `Barbero: ${summary.barberName}`,
          servicePriceLabel: priceLabel,
          notes: summary.notes,
          ctaLabel: 'Ver o gestionar reserva',
          ctaUrl: manageUrl,
        }),
        text: [
          `Hola ${summary.clientName}`,
          `${shop.shopName} — Cita reprogramada`,
          `Código: ${summary.bookingCode}`,
          `Nuevo horario: ${newSchedule}`,
          `Horario anterior: ${prevSchedule}`,
          `Barbero: ${summary.barberName}`,
          `Gestionar: ${manageUrl}`,
        ].join('\n'),
        replyTo: isValidDeliverableEmail(shop.shopEmail)
          ? shop.shopEmail
          : undefined,
      }
    : null;

  const staffRows = [
    { label: 'Cliente', value: `${summary.clientName} (${summary.clientPhone})` },
    { label: 'Servicio', value: `${summary.serviceName} (${priceDurationLabel})` },
    { label: 'Barbero', value: summary.barberName },
    { label: 'Nuevo horario', value: newSchedule },
    { label: 'Horario anterior', value: prevSchedule },
  ];

  const barberEmailClean = barberEmail?.trim().toLowerCase() ?? '';
  const barberPayload: EmailMessagePayload | null = isValidDeliverableEmail(
    barberEmailClean
  )
    ? {
        from: fromEmail,
        to: [barberEmailClean],
        subject: `Cita reprogramada ${summary.bookingCode} · ${summary.clientName}`,
        html: buildStaffEmailLayout({
          shopName: shop.shopName,
          preheader: `Reprogramación de cita ${summary.bookingCode} en tu agenda.`,
          kicker: 'Cambio de horario en tu agenda',
          title: `Cita reprogramada: ${summary.clientName}`,
          intro:
            'Se actualizó el horario de esta cita y el espacio anterior quedó liberado.',
          highlightLabel: 'Código de cita',
          highlightValue: summary.bookingCode,
          rows: staffRows,
          ctaLabel: 'Ver mi agenda',
          ctaUrl: barberPanelUrl,
          footerNote: `Notificación para ${summary.barberName} · ${shop.shopName}.`,
        }),
        text: [
          `Cita reprogramada (${summary.bookingCode})`,
          `Cliente: ${summary.clientName} (${summary.clientPhone})`,
          `Nuevo horario: ${newSchedule}`,
          `Horario anterior: ${prevSchedule}`,
        ].join('\n'),
      }
    : null;

  const adminEmailClean = adminEmail?.trim().toLowerCase() ?? '';
  const adminPayload: EmailMessagePayload | null =
    isValidDeliverableEmail(adminEmailClean) &&
    adminEmailClean !== barberEmailClean
      ? {
          from: fromEmail,
          to: [adminEmailClean],
          subject: `Cita reprogramada ${summary.bookingCode} · ${summary.clientName}`,
          html: buildStaffEmailLayout({
            shopName: shop.shopName,
            preheader: `Reprogramación de cita ${summary.bookingCode}.`,
            kicker: 'Actualización de agenda',
            title: `Cita reprogramada: ${summary.clientName}`,
            intro:
              'El horario de esta reserva fue modificado y el turno anterior quedó libre.',
            highlightLabel: 'Código de cita',
            highlightValue: summary.bookingCode,
            rows: staffRows,
            ctaLabel: 'Ver agenda actualizada',
            ctaUrl: adminPanelUrl,
            footerNote: `Copia operativa automática de ${shop.shopName}.`,
          }),
          text: [
            `Cita reprogramada (${summary.bookingCode})`,
            `Cliente: ${summary.clientName} (${summary.clientPhone})`,
            `Nuevo horario: ${newSchedule}`,
            `Horario anterior: ${prevSchedule}`,
          ].join('\n'),
        }
      : null;

  return { clientPayload, barberPayload, adminPayload };
}
