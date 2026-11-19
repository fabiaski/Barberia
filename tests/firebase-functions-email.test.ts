import assert from 'node:assert/strict';
import test from 'node:test';
import {
  processAppointmentCreatedEvent,
  processAppointmentUpdatedEvent,
  type AuthLookupLike,
  type FirestoreLike,
  type NotificationEnvConfig,
  type ResendLikeClient,
} from '@/functions/src/appointment-notifications';
import { sendBookingConfirmationEmails } from '@/services/email';
import { AppointmentStatus } from '@/types';

function createMemoryFirestore(
  initial: Record<string, Record<string, Record<string, unknown>>>
): FirestoreLike {
  const locks = new Set<string>();
  return {
    async getDoc(collection: string, docId: string) {
      const data = initial[collection]?.[docId];
      return {
        exists: Boolean(data),
        data: () => data,
      };
    },
    async tryCreateNotificationLock(lockId: string) {
      if (locks.has(lockId)) return false;
      locks.add(lockId);
      return true;
    },
  };
}

const DEFAULT_ENV: NotificationEnvConfig = {
  resendApiKey: 're_test_functions_key',
  fromEmail: 'Barbería Estudio <reservas@barberiaestudio.co>',
  appUrl: 'https://barberiaestudio.co',
  adminNotificationEmail: 'admin@barberiaestudio.co',
  manageTokenSecret: 'test-secret',
};

test('Cloud Function onAppointmentCreated envía notificación a cliente, barbero y admin validando precio y duración del catálogo', async () => {
  const db = createMemoryFirestore({
    servicios: {
      'corte-de-cabello': {
        id: 'corte-de-cabello',
        name: 'Corte de cabello',
        priceCop: 20000,
        durationMinutes: 30,
      },
    },
    barberos: {
      mateo: {
        id: 'mateo',
        userId: 'uid_mateo',
        name: 'Mateo Rojas',
      },
    },
    usuarios: {
      uid_mateo: {
        uid: 'uid_mateo',
        email: 'mateo.barbero@correo.co',
      },
    },
    configuracion: {
      main: {
        name: 'Barbería Estudio',
        address: 'Calle 59 # 8-34',
        city: 'Bogotá, Colombia',
        phone: '+57 310 458 9210',
        email: 'contacto@barberiaestudio.co',
        adminNotificationEmail: 'admin@barberiaestudio.co',
      },
    },
  });

  const sentPayloads: Array<{
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
  }> = [];

  const resend: ResendLikeClient = {
    emails: {
      async send(payload) {
        sentPayloads.push(payload);
        return { data: { id: `msg_${sentPayloads.length}` }, error: null };
      },
    },
  };

  // Simular documento de cita con precio/duración desactualizados para verificar corrección desde catálogo
  const rawCita = {
    id: 'cita_fn_001',
    bookingCode: 'BE-FN01',
    serviceId: 'corte-de-cabello',
    serviceName: 'Corte desactualizado',
    priceCop: 35000,
    durationMinutes: 45,
    barberId: 'mateo',
    barberUid: '',
    barberName: 'Mateo',
    date: '2026-11-22',
    startTime: '15:00',
    endTime: '15:45',
    status: 'confirmada',
    clientName: 'Fabián González',
    clientPhone: '3133449833',
    clientEmail: 'cliente@correo.co',
  };

  const outcome = await processAppointmentCreatedEvent({
    appointmentId: 'cita_fn_001',
    data: rawCita,
    db,
    resend,
    env: DEFAULT_ENV,
  });

  assert.equal(outcome.eventType, 'created');
  assert.equal(outcome.clientSent, true);
  assert.equal(outcome.barberSent, true);
  assert.equal(outcome.adminSent, true);
  assert.deepEqual(outcome.recipients, [
    'cliente@correo.co',
    'mateo.barbero@correo.co',
    'admin@barberiaestudio.co',
  ]);
  assert.equal(outcome.resolvedSummary?.serviceName, 'Corte de cabello');
  assert.equal(outcome.resolvedSummary?.priceCop, 20000);
  assert.equal(outcome.resolvedSummary?.durationMinutes, 30);
  assert.equal(outcome.resolvedSummary?.endTime, '15:30');
  assert.equal(outcome.resolvedSummary?.barberName, 'Mateo Rojas');

  assert.equal(sentPayloads.length, 3);
  const clientMsg = sentPayloads[0]!;
  const barberMsg = sentPayloads[1]!;
  const adminMsg = sentPayloads[2]!;

  assert.deepEqual(clientMsg.to, ['cliente@correo.co']);
  assert.match(clientMsg.html, /20[.,]000/);
  assert.doesNotMatch(clientMsg.html, /35[.,]000/);
  assert.match(clientMsg.html, /30 min/);
  assert.match(clientMsg.html, /3:00 PM – 3:30 PM/);
  assert.match(clientMsg.html, /Mateo Rojas/);

  assert.deepEqual(barberMsg.to, ['mateo.barbero@correo.co']);
  assert.match(barberMsg.subject, /Nueva cita asignada BE-FN01/);
  assert.match(barberMsg.html, /Hola Mateo Rojas/);
  assert.match(barberMsg.html, /20[.,]000/);

  assert.deepEqual(adminMsg.to, ['admin@barberiaestudio.co']);
  assert.match(adminMsg.subject, /Nueva cita BE-FN01/);

  // Reintento idempotente no debe duplicar correos
  const retryOutcome = await processAppointmentCreatedEvent({
    appointmentId: 'cita_fn_001',
    data: rawCita,
    db,
    resend,
    env: DEFAULT_ENV,
  });
  assert.equal(retryOutcome.skipped, true);
  assert.equal(sentPayloads.length, 3);
});

test('Cloud Function onAppointmentUpdated despacha confirmación (pendiente->confirmada), cancelación y respaldo Auth para correo del barbero', async () => {
  const db = createMemoryFirestore({
    servicios: {
      'corte-y-barba': {
        id: 'corte-y-barba',
        name: 'Corte y barba',
        priceCop: 30000,
        durationMinutes: 40,
      },
    },
    barberos: {
      carlos: {
        id: 'carlos',
        userId: 'uid_carlos',
        name: 'Carlos Gómez',
      },
    },
    usuarios: {}, // Sin documento en usuarios -> debe resolver correo desde Auth fallback
    configuracion: {
      main: {
        name: 'Barbería Estudio',
        address: 'Calle 59 # 8-34',
        city: 'Bogotá, Colombia',
        phone: '+57 310 458 9210',
        adminNotificationEmail: 'carlos.barbero@correo.co', // Igual al barbero: no duplica envío admin
      },
    },
  });

  const authLookup: AuthLookupLike = {
    async getUserEmail(uid: string) {
      return uid === 'uid_carlos' ? 'carlos.barbero@correo.co' : undefined;
    },
  };

  const sentPayloads: Array<{ to: string | string[]; subject: string; html: string }> =
    [];
  const resend: ResendLikeClient = {
    emails: {
      async send(payload) {
        sentPayloads.push(payload);
        return { data: { id: `upd_${sentPayloads.length}` }, error: null };
      },
    },
  };

  const baseCita = {
    id: 'cita_fn_002',
    bookingCode: 'BE-FN02',
    serviceId: 'corte-y-barba',
    serviceName: 'Corte y barba',
    priceCop: 30000,
    durationMinutes: 40,
    barberId: 'carlos',
    barberUid: 'uid_carlos',
    barberName: 'Carlos Gómez',
    date: '2026-11-23',
    startTime: '10:00',
    endTime: '10:40',
    clientName: 'Andrés López',
    clientPhone: '3001112233',
    clientEmail: 'andres@correo.co',
  };

  // Transición pendiente -> confirmada
  const confirmOutcome = await processAppointmentUpdatedEvent({
    appointmentId: 'cita_fn_002',
    beforeData: { ...baseCita, status: 'pendiente' },
    afterData: { ...baseCita, status: 'confirmada' },
    db,
    authLookup,
    resend,
    env: DEFAULT_ENV,
  });

  assert.equal(confirmOutcome.eventType, 'confirmed');
  assert.equal(confirmOutcome.clientSent, true);
  assert.equal(confirmOutcome.barberSent, true);
  assert.equal(confirmOutcome.adminSent, false); // Mismo correo que barbero -> dedupado
  assert.equal(sentPayloads.length, 2);
  assert.match(sentPayloads[0]!.html, /30[.,]000/);
  assert.match(sentPayloads[1]!.html, /Carlos Gómez/);

  // Transición confirmada -> cancelada
  const cancelOutcome = await processAppointmentUpdatedEvent({
    appointmentId: 'cita_fn_002',
    beforeData: { ...baseCita, status: 'confirmada' },
    afterData: { ...baseCita, status: 'cancelada' },
    db,
    authLookup,
    resend,
    env: DEFAULT_ENV,
  });

  assert.equal(cancelOutcome.eventType, 'cancelled');
  assert.equal(cancelOutcome.clientSent, true);
  assert.equal(cancelOutcome.barberSent, true);
  assert.equal(sentPayloads.length, 4);
  assert.match(sentPayloads[2]!.subject, /Cita cancelada \(BE-FN02\)/);
  assert.match(sentPayloads[3]!.subject, /Cita cancelada BE-FN02/);

  // Reprogramación de horario (confirmada -> confirmada con nueva hora)
  const rescheduleOutcome = await processAppointmentUpdatedEvent({
    appointmentId: 'cita_fn_002',
    beforeData: { ...baseCita, status: 'confirmada', startTime: '10:00', endTime: '10:40' },
    afterData: { ...baseCita, status: 'confirmada', startTime: '11:00', endTime: '11:40' },
    db,
    authLookup,
    resend,
    env: DEFAULT_ENV,
  });

  assert.equal(rescheduleOutcome.eventType, 'rescheduled');
  assert.equal(rescheduleOutcome.clientSent, true);
  assert.equal(rescheduleOutcome.barberSent, true);
  assert.equal(sentPayloads.length, 6);
  assert.match(sentPayloads[4]!.subject, /Cita reprogramada \(BE-FN02\)/);
});

test('Next.js delega envío a Cloud Functions cuando EMAIL_DISPATCH_VIA_FUNCTIONS=true sin duplicar correos', async () => {
  const prevDelegated = process.env.EMAIL_DISPATCH_VIA_FUNCTIONS;
  process.env.EMAIL_DISPATCH_VIA_FUNCTIONS = 'true';

  try {
    const res = await sendBookingConfirmationEmails({
      summary: {
        id: 'cita_del_1',
        bookingCode: 'BE-DEL1',
        serviceId: 'barba',
        serviceName: 'Barba',
        priceCop: 10000,
        durationMinutes: 20,
        barberId: 'mateo',
        barberName: 'Mateo',
        date: '2026-11-24',
        startTime: '09:00',
        endTime: '09:20',
        status: AppointmentStatus.CONFIRMED,
        clientName: 'Cliente Prueba',
        clientPhone: '3001234567',
        clientEmail: 'cliente@correo.co',
        canModify: true,
        manageToken: 'tok',
      },
      skipShopLookup: true,
    });

    assert.equal(res.skipped, true);
    assert.equal(res.delegatedToFunctions, true);
    assert.equal(res.sent, false);
  } finally {
    if (prevDelegated === undefined) delete process.env.EMAIL_DISPATCH_VIA_FUNCTIONS;
    else process.env.EMAIL_DISPATCH_VIA_FUNCTIONS = prevDelegated;
  }
});
