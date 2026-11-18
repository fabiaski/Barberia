import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCancelledEmailPayloads,
  buildConfirmationEmailPayloads,
  buildRescheduledEmailPayloads,
  DEFAULT_SHOP_EMAIL_CONTEXT,
  escapeHtml,
  resolveAppBaseUrl,
} from '@/lib/utils/email-templates';
import type { PublicBookingSummary } from '@/services/booking';
import {
  getEmailServiceStatus,
  sendBookingCancelledEmails,
  sendBookingConfirmationEmails,
  sendBookingRescheduledEmails,
  sendTestNotificationEmail,
  type ResendLikeClient,
} from '@/services/email';
import { AppointmentStatus } from '@/types';

const SAMPLE_SUMMARY: PublicBookingSummary = {
  id: 'cita_test_001',
  bookingCode: 'BE-9X4K2M',
  serviceId: 'corte-y-barba',
  serviceName: 'Corte & Barba <Clásico>',
  priceCop: 45000,
  durationMinutes: 45,
  barberId: 'jose',
  barberName: 'José Ramírez',
  date: '2026-11-20',
  startTime: '14:30',
  endTime: '15:15',
  status: AppointmentStatus.CONFIRMED,
  notes: 'Degradado medio "sin navaja"',
  clientName: 'Camilo <script>alert(1)</script> Torres',
  clientPhone: '3104589210',
  clientEmail: 'Camilo.Torres@Correo.CO ',
  canModify: true,
  manageToken: 'tok_test_abc.sig_xyz',
};

test('Resend helpers: resolveAppBaseUrl, escapeHtml y estado sin RESEND_API_KEY', () => {
  const prevAppUrl = process.env.APP_URL;
  const prevResendKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.RESEND_FROM_EMAIL;

  try {
    process.env.APP_URL = ' "https://barberiaestudio.co/" ';
    assert.equal(resolveAppBaseUrl('http://localhost:3000'), 'https://barberiaestudio.co');

    delete process.env.APP_URL;
    assert.equal(resolveAppBaseUrl('https://preview.example.com/'), 'https://preview.example.com');

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    const status = getEmailServiceStatus();
    assert.equal(status.resendConfigured, false);
    assert.equal(status.fromEmail, 'Barbería Estudio <onboarding@resend.dev>');

    assert.equal(
      escapeHtml('<script>"hola" & \'chau\'</script>'),
      '&lt;script&gt;&quot;hola&quot; &amp; &#39;chau&#39;&lt;/script&gt;'
    );
  } finally {
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
    if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResendKey;
    if (prevFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = prevFrom;
  }
});

test('Plantillas HTML/texto de confirmación, reprogramación y cancelación escapan XSS y formatean en español (America/Bogota)', () => {
  const { clientPayload, staffPayload, manageUrl } = buildConfirmationEmailPayloads({
    summary: SAMPLE_SUMMARY,
    shop: DEFAULT_SHOP_EMAIL_CONTEXT,
    fromEmail: 'Barbería Estudio <reservas@barberiaestudio.co>',
    baseUrl: 'https://barberia.test',
    staffRecipients: ['admin@barberia.test'],
  });

  assert.ok(clientPayload);
  assert.ok(staffPayload);
  assert.deepEqual(clientPayload.to, ['camilo.torres@correo.co']);
  assert.equal(
    clientPayload.subject,
    'Cita confirmada (BE-9X4K2M) — Barbería Estudio'
  );
  assert.match(manageUrl, /^https:\/\/barberia\.test\/reservar\?gestionar=1&token=/);
  assert.doesNotMatch(clientPayload.html, /<script>/);
  assert.match(clientPayload.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(clientPayload.html, /Tu reserva fue recibida exitosamente en:/);
  assert.match(clientPayload.html, /DATOS DE TU CITA/);
  assert.match(clientPayload.html, /RESUMEN DE SERVICIOS/);
  assert.match(clientPayload.html, /20 de noviembre del 2026/);
  assert.match(clientPayload.html, /BE-9X4K2M/);
  assert.match(clientPayload.html, /2:30 PM/);
  assert.match(clientPayload.html, /3:15 PM/);
  assert.match(clientPayload.html, /45[.,]000/);
  assert.match(clientPayload.text, /Código: BE-9X4K2M/);

  const cancelledByBarber = buildCancelledEmailPayloads({
    summary: { ...SAMPLE_SUMMARY, status: AppointmentStatus.CANCELLED },
    cancelledBy: 'barbero',
    shop: DEFAULT_SHOP_EMAIL_CONTEXT,
    fromEmail: 'Barbería Estudio <reservas@barberiaestudio.co>',
    baseUrl: 'https://barberia.test',
    staffRecipients: ['admin@barberia.test'],
  });

  assert.ok(cancelledByBarber.clientPayload);
  assert.ok(cancelledByBarber.staffPayload);
  assert.equal(
    cancelledByBarber.clientPayload.subject,
    'Cita cancelada (BE-9X4K2M) — Barbería Estudio'
  );
  assert.match(cancelledByBarber.clientPayload.html, /cancelada por el equipo/i);
  assert.match(cancelledByBarber.clientPayload.html, /https:\/\/barberia\.test\/reservar/);
  assert.match(cancelledByBarber.staffPayload.html, /Cancelada por el barbero/);

  const rescheduled = buildRescheduledEmailPayloads({
    summary: { ...SAMPLE_SUMMARY, date: '2026-11-21', startTime: '16:00', endTime: '16:45' },
    previousDate: '2026-11-20',
    previousStartTime: '14:30',
    previousEndTime: '15:15',
    shop: DEFAULT_SHOP_EMAIL_CONTEXT,
    fromEmail: 'Barbería Estudio <reservas@barberiaestudio.co>',
    baseUrl: 'https://barberia.test',
    staffRecipients: [],
  });
  assert.ok(rescheduled.clientPayload);
  assert.equal(rescheduled.staffPayload, null);
  assert.match(rescheduled.clientPayload.html, /4:00 PM/);
  assert.match(rescheduled.clientPayload.html, /2:30 PM/);
});

test('Envío con Resend omite de forma segura si falta RESEND_API_KEY sin interrumpir la cita', async () => {
  const prevResendKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  try {
    const confirmRes = await sendBookingConfirmationEmails({
      summary: SAMPLE_SUMMARY,
      skipShopLookup: true,
    });
    assert.equal(confirmRes.sent, false);
    assert.equal(confirmRes.clientSent, false);
    assert.equal(confirmRes.skipped, true);
    assert.equal(confirmRes.reason, 'RESEND_API_KEY no configurada');

    const cancelRes = await sendBookingCancelledEmails({
      summary: SAMPLE_SUMMARY,
      cancelledBy: 'cliente',
      skipShopLookup: true,
    });
    assert.equal(cancelRes.sent, false);
    assert.equal(cancelRes.clientSent, false);
    assert.equal(cancelRes.skipped, true);
    assert.equal(cancelRes.reason, 'RESEND_API_KEY no configurada');
  } finally {
    if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResendKey;
  }
});

test('Integración Resend envía confirmación y cancelación al cliente y al equipo, y separa clientSent en fallos parciales', async () => {
  const sentPayloads: Array<{
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }> = [];

  const successClient: ResendLikeClient = {
    emails: {
      async send(payload) {
        sentPayloads.push(payload);
        return { data: { id: `email_${sentPayloads.length}` }, error: null };
      },
    },
  };

  const confirmResult = await sendBookingConfirmationEmails({
    summary: SAMPLE_SUMMARY,
    requestOrigin: 'https://barberiaestudio.co',
    resendClient: successClient,
    skipShopLookup: true,
    shopOverride: {
      shopName: 'Barbería Estudio',
      adminNotificationEmail: 'admin@barberiaestudio.co',
      shopEmail: 'contacto@barberiaestudio.co',
    },
  });

  assert.equal(confirmResult.sent, true);
  assert.equal(confirmResult.clientSent, true);
  assert.equal(confirmResult.staffSent, true);
  assert.deepEqual(confirmResult.recipients, [
    'camilo.torres@correo.co',
    'admin@barberiaestudio.co',
  ]);
  assert.equal(sentPayloads.length, 2);
  assert.deepEqual(sentPayloads[0]?.to, ['camilo.torres@correo.co']);
  assert.equal(sentPayloads[0]?.replyTo, 'contacto@barberiaestudio.co');
  assert.match(sentPayloads[0]?.subject ?? '', /Cita confirmada \(BE-9X4K2M\)/);

  // Cancelación por administración
  const cancelResult = await sendBookingCancelledEmails({
    summary: { ...SAMPLE_SUMMARY, status: AppointmentStatus.CANCELLED },
    cancelledBy: 'admin',
    requestOrigin: 'https://barberiaestudio.co',
    resendClient: successClient,
    skipShopLookup: true,
    shopOverride: {
      adminNotificationEmail: 'admin@barberiaestudio.co',
    },
  });
  assert.equal(cancelResult.sent, true);
  assert.equal(cancelResult.clientSent, true);
  assert.equal(cancelResult.staffSent, true);
  assert.equal(sentPayloads.length, 4);
  assert.match(sentPayloads[2]?.subject ?? '', /Cita cancelada \(BE-9X4K2M\)/);
  assert.match(sentPayloads[2]?.html ?? '', /equipo de la barbería/);

  // Prueba con mismo correo para cliente y barbero/admin: ambos correos deben despacharse
  const sameEmailPayloads: Array<{ to: string | string[]; subject: string }> = [];
  const sameEmailClient: ResendLikeClient = {
    emails: {
      async send(payload) {
        sameEmailPayloads.push({ to: payload.to, subject: payload.subject });
        return { data: { id: `same_${sameEmailPayloads.length}` }, error: null };
      },
    },
  };
  const sameEmailConfirm = await sendBookingConfirmationEmails({
    summary: { ...SAMPLE_SUMMARY, clientEmail: 'dueno@barberiaestudio.co' },
    resendClient: sameEmailClient,
    skipShopLookup: true,
    shopOverride: {
      adminNotificationEmail: 'dueno@barberiaestudio.co',
    },
  });
  assert.equal(sameEmailConfirm.clientSent, true);
  assert.equal(sameEmailConfirm.staffSent, true);
  assert.equal(sameEmailPayloads.length, 2);

  // Reprogramación
  const rescheduleResult = await sendBookingRescheduledEmails({
    summary: { ...SAMPLE_SUMMARY, startTime: '16:00', endTime: '16:45' },
    previousDate: '2026-11-20',
    previousStartTime: '14:30',
    previousEndTime: '15:15',
    resendClient: successClient,
    skipShopLookup: true,
  });
  assert.equal(rescheduleResult.clientSent, true);

  // Prueba de entrega con Resend sandbox rechazando al cliente pero aceptando al admin
  const sandboxPartialClient: ResendLikeClient = {
    emails: {
      async send(payload) {
        const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
        if (recipients.includes('camilo.torres@correo.co')) {
          return {
            data: null,
            error: {
              message:
                'You can only send testing emails to your own email address (admin@barberiaestudio.co).',
            },
          };
        }
        return { data: { id: 'email_staff_ok' }, error: null };
      },
    },
  };

  const partialResult = await sendBookingConfirmationEmails({
    summary: SAMPLE_SUMMARY,
    resendClient: sandboxPartialClient,
    skipShopLookup: true,
    shopOverride: {
      adminNotificationEmail: 'admin@barberiaestudio.co',
    },
  });

  assert.equal(partialResult.sent, true);
  assert.equal(partialResult.clientSent, false);
  assert.equal(partialResult.staffSent, true);
  assert.deepEqual(partialResult.recipients, ['admin@barberiaestudio.co']);
  assert.match(partialResult.clientError ?? '', /modo de prueba de Resend/i);

  // Prueba de manejo seguro cuando Resend lanza una excepción de red
  const throwingClient: ResendLikeClient = {
    emails: {
      async send() {
        throw new Error('Failed to fetch');
      },
    },
  };

  const failedResult = await sendTestNotificationEmail({
    toEmail: 'admin@barberiaestudio.co',
    resendClient: throwingClient,
    skipShopLookup: true,
  });
  assert.equal(failedResult.sent, false);
  assert.equal(failedResult.clientSent, false);
  assert.match(failedResult.error ?? '', /No pudimos conectarnos con el servidor/);
});
