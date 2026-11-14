import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBookingManageToken,
  verifyBookingManageToken,
} from '@/lib/auth/manage-token';
import { generateScheduleTimeSlots } from '@/lib/utils/schedule-slots';
import { translateErrorMessageEs } from '@/lib/utils/error-es';
import {
  formatCurrencyCOP,
  formatTime12h,
  getBogotaDateString,
  getBogotaTimeString,
  minutesToTime,
  timeToMinutes,
} from '@/lib/utils/timezone';
import {
  barberCreateBlockSchema,
  barberUpdateAppointmentStatusSchema,
} from '@/lib/validators/barbero';
import { createBlockSchema, shopConfigMutationSchema } from '@/lib/validators/admin';
import {
  createBookingSchema,
  manageBookingRequestSchema,
} from '@/lib/validators/booking';
import { buildOccupancySlotKeys } from '@/services/booking';
import { AppointmentStatus, type DaySchedule } from '@/types';

test('Zona horaria America/Bogota: formatea medianoche como 00:xx (h23) y nunca 24:xx', () => {
  // 2026-11-14 05:05 UTC == 2026-11-14 00:05 America/Bogota
  const midnightBogota = new Date('2026-11-14T05:05:00.000Z');
  assert.equal(getBogotaDateString(midnightBogota), '2026-11-14');
  assert.equal(getBogotaTimeString(midnightBogota), '00:05');

  // 2026-11-15 04:30 UTC == 2026-11-14 23:30 America/Bogota
  const lateNightBogota = new Date('2026-11-15T04:30:00.000Z');
  assert.equal(getBogotaDateString(lateNightBogota), '2026-11-14');
  assert.equal(getBogotaTimeString(lateNightBogota), '23:30');
});

test('Conversiones de tiempo y formato COP', () => {
  assert.equal(timeToMinutes('08:30'), 510);
  assert.equal(minutesToTime(510), '08:30');
  assert.equal(formatTime12h('00:05'), '12:05 AM');
  assert.equal(formatTime12h('08:00'), '8:00 AM');
  assert.equal(formatTime12h('12:30'), '12:30 PM');
  assert.equal(formatTime12h('19:45'), '7:45 PM');

  const formattedCop = formatCurrencyCOP(45000);
  assert.match(formattedCop, /45[.,]000/);
});

test('Generación de franjas horarias respeta apertura, cierre, duración y pausa de almuerzo', () => {
  const daySchedule: DaySchedule = {
    dayOfWeek: 3,
    isOpen: true,
    openTime: '08:00',
    closeTime: '18:00',
    breakStart: '13:00',
    breakEnd: '14:00',
  };

  const slots45 = generateScheduleTimeSlots({
    date: '2099-05-15',
    daySchedule,
    durationMinutes: 45,
    intervalMinutes: 30,
  });

  // 12:30 + 45 min = 13:15 -> se traslapa con el almuerzo (13:00-14:00), debe excluirse
  assert.equal(slots45.includes('12:30'), false);
  assert.equal(slots45.includes('13:00'), false);
  assert.equal(slots45.includes('13:30'), false);
  // 12:00 + 45 min = 12:45 -> válido antes del almuerzo
  assert.equal(slots45.includes('12:00'), true);
  // 14:00 + 45 min = 14:45 -> válido después del almuerzo
  assert.equal(slots45.includes('14:00'), true);
  // 17:30 + 45 min = 18:15 -> supera cierre 18:00, debe excluirse
  assert.equal(slots45.includes('17:30'), false);
  assert.equal(slots45.includes('17:00'), true);

  const closedSlots = generateScheduleTimeSlots({
    date: '2099-05-15',
    daySchedule: { ...daySchedule, isOpen: false },
    durationMinutes: 30,
    intervalMinutes: 30,
  });
  assert.deepEqual(closedSlots, []);
});

test('Granularidad de candados de ocupación (5 minutos) sin falsos positivos en citas contiguas', () => {
  const firstBookingLocks = buildOccupancySlotKeys(
    'jose',
    '2099-06-10',
    '09:00',
    45
  );
  const adjacentBookingLocks = buildOccupancySlotKeys(
    'jose',
    '2099-06-10',
    '09:45',
    30
  );
  const overlappingBookingLocks = buildOccupancySlotKeys(
    'jose',
    '2099-06-10',
    '09:30',
    30
  );

  assert.equal(firstBookingLocks.length, 9); // 45 / 5 = 9 bloques
  assert.equal(firstBookingLocks[0]?.slotKey, 'jose_2099-06-10_0900');
  assert.equal(firstBookingLocks[8]?.slotKey, 'jose_2099-06-10_0940');

  const firstKeySet = new Set(firstBookingLocks.map((s) => s.slotKey));
  const adjacentCollision = adjacentBookingLocks.some((s) =>
    firstKeySet.has(s.slotKey)
  );
  const overlapCollision = overlappingBookingLocks.some((s) =>
    firstKeySet.has(s.slotKey)
  );

  assert.equal(adjacentCollision, false);
  assert.equal(overlapCollision, true);
});

test('Tokens HMAC de autogestión firman, validan y rechazan manipulación', () => {
  const token = createBookingManageToken('appt_12345', 'Cliente@Correo.CO ');
  const verified = verifyBookingManageToken(token);

  assert.deepEqual(verified, {
    appointmentId: 'appt_12345',
    email: 'cliente@correo.co',
  });

  // Alterar 1 carácter del payload o firma invalida inmediatamente el token
  const [payload, sig] = token.split('.');
  const tamperedSig = `${payload}.${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifyBookingManageToken(tamperedSig), null);

  const expiredToken = createBookingManageToken('appt_12345', 'a@b.co', -1);
  assert.equal(verifyBookingManageToken(expiredToken), null);
});

test('Validadores Zod bloquean datos inválidos en reservas, bloqueos y configuración', () => {
  const validBooking = createBookingSchema.safeParse({
    serviceId: 'corte_clasico',
    barberId: 'jose',
    date: '2099-06-15',
    startTime: '10:30',
    fullName: 'Camilo Torres',
    phone: '3104589210',
    email: 'camilo@correo.com',
    notes: 'Degradado medio',
  });
  assert.equal(validBooking.success, true);

  const invalidBooking = createBookingSchema.safeParse({
    serviceId: 'corte_clasico',
    barberId: 'jose',
    date: '15-06-2099',
    startTime: '25:99',
    fullName: 'Ca',
    phone: '123',
    email: 'correo-malo',
  });
  assert.equal(invalidBooking.success, false);

  const invalidBlock = createBlockSchema.safeParse({
    barberId: 'jose',
    date: '2099-06-15',
    allDay: false,
    startTime: '15:00',
    endTime: '14:00',
    reason: 'Cita médica',
  });
  assert.equal(invalidBlock.success, false);

  const validBarberBlock = barberCreateBlockSchema.safeParse({
    date: '2099-06-15',
    allDay: false,
    startTime: '14:00',
    endTime: '15:30',
    reason: 'Almuerzo extendido',
  });
  assert.equal(validBarberBlock.success, true);

  assert.equal(
    barberUpdateAppointmentStatusSchema.safeParse({
      status: AppointmentStatus.COMPLETED,
    }).success,
    true
  );

  assert.equal(
    manageBookingRequestSchema.safeParse({
      mode: 'reschedule',
      manageToken: 'abc1234567890.signature',
      date: '2099-06-20',
      startTime: '11:00',
      barberId: 'any',
    }).success,
    true
  );

  assert.equal(
    shopConfigMutationSchema.safeParse({
      name: 'Barbería Estudio',
      tagline: 'Cortes de precisión',
      address: 'Calle 85 # 14-32',
      city: 'Bogotá',
      phone: '3105550148',
      email: 'contacto@barberia.co',
      slotIntervalMinutes: 30,
    }).success,
    true
  );
});

test('Simulación transaccional de concurrencia (Promise.all): evita doble reserva y libera al cancelar/reprogramar', async () => {
  // Motor transaccional en memoria con la misma semántica optimista/atómica de services/booking.ts
  const ocupacion = new Map<string, { appointmentId: string; barberId: string }>();
  const citas = new Map<
    string,
    {
      id: string;
      barberId: string;
      date: string;
      startTime: string;
      endTime: string;
      durationMinutes: number;
      status: AppointmentStatus;
    }
  >();
  const bloqueos: Array<{
    barberId: string;
    date: string;
    allDay: boolean;
    startTime?: string;
    endTime?: string;
  }> = [];

  // Mutex asíncrono para serializar commits transaccionales simulando Firestore OCC
  let txChain = Promise.resolve();
  function runAtomicTx<T>(fn: () => T): Promise<T> {
    const next = txChain.then(() => fn());
    txChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  const overlaps = (aS: number, aE: number, bS: number, bE: number) =>
    aS < bE && aE > bS;

  async function tryAtomicBook(params: {
    id: string;
    candidateBarbers: string[];
    date: string;
    startTime: string;
    durationMinutes: number;
  }): Promise<{ ok: true; barberId: string } | { ok: false; code: 'CONFLICT' }> {
    // Simulamos latencia de lectura previa antes del commit transaccional
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10)));

    return runAtomicTx(() => {
      const startMin = timeToMinutes(params.startTime);
      const endMin = startMin + params.durationMinutes;

      for (const bId of params.candidateBarbers) {
        const locks = buildOccupancySlotKeys(
          bId,
          params.date,
          params.startTime,
          params.durationMinutes
        );
        if (locks.some((l) => ocupacion.has(l.slotKey))) continue;

        const hasApptOverlap = Array.from(citas.values()).some(
          (c) =>
            c.barberId === bId &&
            c.date === params.date &&
            c.status === AppointmentStatus.CONFIRMED &&
            overlaps(
              startMin,
              endMin,
              timeToMinutes(c.startTime),
              timeToMinutes(c.endTime)
            )
        );
        if (hasApptOverlap) continue;

        const hasBlockOverlap = bloqueos.some((bl) => {
          if (bl.date !== params.date) return false;
          if (bl.barberId !== 'all' && bl.barberId !== bId) return false;
          const bS = bl.allDay ? 480 : timeToMinutes(bl.startTime!);
          const bE = bl.allDay ? 1200 : timeToMinutes(bl.endTime!);
          return overlaps(startMin, endMin, bS, bE);
        });
        if (hasBlockOverlap) continue;

        for (const l of locks) {
          ocupacion.set(l.slotKey, { appointmentId: params.id, barberId: bId });
        }
        citas.set(params.id, {
          id: params.id,
          barberId: bId,
          date: params.date,
          startTime: params.startTime,
          endTime: minutesToTime(endMin),
          durationMinutes: params.durationMinutes,
          status: AppointmentStatus.CONFIRMED,
        });
        return { ok: true as const, barberId: bId };
      }

      return { ok: false as const, code: 'CONFLICT' as const };
    });
  }

  // 1. 10 peticiones simultáneas al mismo barbero y franja traslapada (09:00, 09:15, 09:30)
  const raceAttempts = Array.from({ length: 10 }, (_, idx) =>
    tryAtomicBook({
      id: `race_${idx}`,
      candidateBarbers: ['jose'],
      date: '2099-07-01',
      startTime: idx % 2 === 0 ? '09:00' : '09:30',
      durationMinutes: 45,
    })
  );

  const raceResults = await Promise.all(raceAttempts);
  const winners = raceResults.filter((r) => r.ok);
  const conflicts = raceResults.filter((r) => !r.ok);

  assert.equal(winners.length, 1);
  assert.equal(conflicts.length, 9);
  assert.equal(ocupacion.size, 9); // exactamente 45 min = 9 bloques de 5 min

  // 2. "Primer disponible" con 2 barberos bajo 5 peticiones simultáneas -> máximo 2 ganan
  const anyAttempts = Array.from({ length: 5 }, (_, idx) =>
    tryAtomicBook({
      id: `any_${idx}`,
      candidateBarbers: ['mateo', 'carlos'],
      date: '2099-07-01',
      startTime: '11:00',
      durationMinutes: 30,
    })
  );
  const anyResults = await Promise.all(anyAttempts);
  const anyWinners = anyResults.filter((r) => r.ok);
  assert.equal(anyWinners.length, 2);
  assert.deepEqual(
    anyWinners.map((w) => (w.ok ? w.barberId : '')).sort(),
    ['carlos', 'mateo']
  );

  // 3. Bloqueo administrativo impide reserva sobre el horario bloqueado
  bloqueos.push({
    barberId: 'jose',
    date: '2099-07-01',
    allDay: false,
    startTime: '15:00',
    endTime: '16:00',
  });
  const blockedRes = await tryAtomicBook({
    id: 'blocked_try',
    candidateBarbers: ['jose'],
    date: '2099-07-01',
    startTime: '15:30',
    durationMinutes: 30,
  });
  assert.equal(blockedRes.ok, false);

  // 4. Cancelación libera los candados de ocupación y permite volver a reservar
  const winnerAppt = Array.from(citas.values()).find(
    (c) => c.barberId === 'jose' && c.date === '2099-07-01'
  )!;
  await runAtomicTx(() => {
    winnerAppt.status = AppointmentStatus.CANCELLED;
    for (const [key, val] of ocupacion.entries()) {
      if (val.appointmentId === winnerAppt.id) {
        ocupacion.delete(key);
      }
    }
  });

  const rebookAfterCancel = await tryAtomicBook({
    id: 'rebook_after_cancel',
    candidateBarbers: ['jose'],
    date: '2099-07-01',
    startTime: winnerAppt.startTime,
    durationMinutes: 45,
  });
  assert.equal(rebookAfterCancel.ok, true);
});

test('Traductor de errores translateErrorMessageEs convierte mensajes técnicos en inglés a español sin alterar reglas de negocio', () => {
  assert.equal(
    translateErrorMessageEs({ code: 'auth/invalid-credential', message: 'Firebase: Error (auth/invalid-credential).' }),
    'Correo electrónico o contraseña incorrectos.'
  );
  assert.equal(
    translateErrorMessageEs('EMAIL_EXISTS'),
    'Ese correo electrónico ya está registrado en Firebase Authentication.'
  );
  assert.equal(
    translateErrorMessageEs('Missing or insufficient permissions.'),
    'No tienes permisos suficientes para completar esta operación o los datos no cumplen las validaciones de seguridad.'
  );
  assert.equal(
    translateErrorMessageEs("false for 'create' @ L270"),
    'No tienes permisos suficientes para completar esta operación o los datos no cumplen las validaciones de seguridad.'
  );
  assert.equal(
    translateErrorMessageEs('Failed to fetch'),
    'No pudimos conectarnos con el servidor. Verifica tu conexión a internet e intenta nuevamente.'
  );
  assert.equal(
    translateErrorMessageEs('Unexpected end of JSON input'),
    'La respuesta del servidor no pudo leerse correctamente. Intenta nuevamente.'
  );
  assert.equal(
    translateErrorMessageEs('You can only send testing emails to your own email address'),
    'En el modo de prueba de Resend solo se pueden enviar correos a tu dirección verificada o desde un dominio propio configurado en RESEND_FROM_EMAIL.'
  );
  assert.equal(
    translateErrorMessageEs('Quota exceeded.'),
    'Se alcanzó el límite temporal de solicitudes en la base de datos. Intenta más tarde.'
  );

  // Mensajes de negocio en español deben conservarse intactos
  assert.equal(
    translateErrorMessageEs('Ese horario ya no está disponible para el barbero seleccionado.'),
    'Ese horario ya no está disponible para el barbero seleccionado.'
  );
});
