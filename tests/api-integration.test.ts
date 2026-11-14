import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3000').replace(
  /\/+$/,
  ''
);

async function fetchStatus(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    ...init,
  });
  return res;
}

test('Salud del sistema y páginas públicas responden 200 OK', async () => {
  const healthRes = await fetchStatus('/api/health');
  assert.equal(healthRes.status, 200);
  const health = (await healthRes.json()) as {
    ok: boolean;
    projectId: string;
    databaseId: string;
    hasAdminServiceAccount: boolean;
  };
  assert.equal(health.ok, true);
  assert.equal(health.projectId, 'cogent-operator-q6gf7');
  assert.ok(health.databaseId.length > 0);

  for (const publicPath of ['/', '/reservar', '/reservar?gestionar=1', '/login']) {
    const res = await fetchStatus(publicPath);
    assert.equal(
      res.status,
      200,
      `Se esperaba 200 OK en ruta pública ${publicPath}, llegó ${res.status}`
    );
  }
});

test('Middleware y guardas RBAC protegen rutas privadas y APIs sin sesión', async () => {
  const protectedPages = [
    '/admin',
    '/admin/citas',
    '/admin/barberos',
    '/admin/servicios',
    '/admin/horarios',
    '/admin/configuracion',
    '/barbero',
  ];

  for (const pagePath of protectedPages) {
    const res = await fetchStatus(pagePath);
    assert.equal(
      res.status,
      307,
      `Se esperaba redirección 307 en ${pagePath} sin cookie`
    );
    const location = res.headers.get('location') ?? '';
    assert.match(location, /\/login/);
  }

  const protectedGets = [
    '/api/admin/citas',
    '/api/admin/barberos',
    '/api/admin/servicios',
    '/api/admin/horarios',
    '/api/admin/bloqueos',
    '/api/admin/configuracion',
    '/api/barbero/agenda',
  ];

  for (const apiPath of protectedGets) {
    const res = await fetchStatus(apiPath);
    assert.equal(
      res.status,
      401,
      `Se esperaba 401 Unauthorized en GET ${apiPath}, llegó ${res.status}`
    );
  }

  const barberScheduleRes = await fetchStatus('/api/barbero/horario', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: [] }),
  });
  assert.equal(barberScheduleRes.status, 401);

  const barberBlockRes = await fetchStatus('/api/barbero/bloqueos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2099-06-15',
      allDay: true,
      reason: 'Descanso',
    }),
  });
  assert.equal(barberBlockRes.status, 401);

  const testEmailRes = await fetchStatus('/api/admin/notificaciones/prueba', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'prueba@correo.co' }),
  });
  assert.equal(testEmailRes.status, 401);

  const barberPatchRes = await fetchStatus('/api/barbero/citas/cita_inexistente', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelada' }),
  });
  assert.equal(barberPatchRes.status, 401);
});

test('API de disponibilidad valida parámetros, fechas pasadas y franjas abiertas', async () => {
  const missingParams = await fetchStatus('/api/disponibilidad');
  assert.equal(missingParams.status, 400);

  const pastDateRes = await fetchStatus(
    '/api/disponibilidad?barberId=any&date=2020-01-15'
  );
  assert.equal(pastDateRes.status, 200);
  const pastPayload = (await pastDateRes.json()) as {
    isOpen: boolean;
    availableSlots: string[];
  };
  assert.equal(pastPayload.isOpen, false);
  assert.deepEqual(pastPayload.availableSlots, []);

  // Fecha futura válida (primer lunes posterior a hoy + 14 días)
  const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const futureStr = future.toISOString().slice(0, 10);
  const futureRes = await fetchStatus(
    `/api/disponibilidad?barberId=any&date=${futureStr}`
  );
  assert.equal(futureRes.status, 200);
  const futurePayload = (await futureRes.json()) as {
    date: string;
    availableSlots: string[];
    slotIntervalMinutes: number;
  };
  assert.equal(futurePayload.date, futureStr);
  assert.ok(Array.isArray(futurePayload.availableSlots));
  assert.ok([10, 15, 30].includes(futurePayload.slotIntervalMinutes));
});

test('Validación estricta de payloads en POST /api/citas y /api/citas/gestionar', async () => {
  const badBooking = await fetchStatus('/api/citas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceId: 'corte',
      barberId: 'jose',
      date: '2099-05-15',
      startTime: '99:99',
      fullName: 'A',
      phone: '1',
      email: 'no-es-correo',
    }),
  });
  assert.equal(badBooking.status, 400);

  const badManage = await fetchStatus('/api/citas/gestionar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'lookup',
    }),
  });
  assert.equal(badManage.status, 400);
});

test('Prueba en vivo de carrera concurrente (Promise.all) cuando Firebase Admin está activo', async (t) => {
  const healthRes = await fetchStatus('/api/health');
  const health = (await healthRes.json()) as { hasAdminServiceAccount: boolean };

  if (!health.hasAdminServiceAccount && process.env.RUN_LIVE_BOOKING_RACE !== '1') {
    t.skip(
      'Omitido en vista previa sin FIREBASE_ADMIN_PRIVATE_KEY (se ejecuta en entorno con Service Account).'
    );
    return;
  }

  // Buscar un día futuro abierto con al menos 2 slots disponibles y un barbero activo
  let targetDate = '';
  let slots: Array<{ startTime: string; availableBarberIds: string[] }> = [];
  for (let offset = 10; offset <= 25; offset++) {
    const d = new Date(Date.now() + offset * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const avRes = await fetchStatus(
      `/api/disponibilidad?barberId=any&date=${d}&serviceId=corte-de-cabello`
    );
    if (!avRes.ok) continue;
    const av = (await avRes.json()) as {
      isOpen: boolean;
      slots: Array<{ startTime: string; availableBarberIds: string[] }>;
    };
    if (
      av.isOpen &&
      Array.isArray(av.slots) &&
      av.slots.length >= 2 &&
      av.slots[0].availableBarberIds.length > 0
    ) {
      targetDate = d;
      slots = av.slots;
      break;
    }
  }

  if (!targetDate || slots.length < 2) {
    t.skip(
      'No hay barberos activos con franjas disponibles para la prueba en vivo.'
    );
    return;
  }

  const targetBarberId = slots[0].availableBarberIds[0];
  const slotA = slots[0].startTime;
  const slotB = slots[slots.length - 1].startTime;

  // Lanzar 5 reservas simultáneas contra el MISMO barbero, fecha y hora
  const racePayloads = Array.from({ length: 5 }, (_, idx) =>
    fetchStatus('/api/citas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: 'corte-de-cabello',
        barberId: targetBarberId,
        date: targetDate,
        startTime: slotA,
        fullName: `Prueba Concurrencia ${idx + 1}`,
        phone: '3105550199',
        email: `prueba-concurrencia-${idx + 1}@example.com`,
      }),
    })
  );

  const raceResponses = await Promise.all(racePayloads);
  const statuses = raceResponses.map((r) => r.status);
  const createdCount = statuses.filter((s) => s === 201).length;
  const conflictCount = statuses.filter((s) => s === 409).length;

  assert.equal(createdCount, 1, `Solo debe crearse 1 cita: ${statuses.join(',')}`);
  assert.equal(conflictCount, 4, `Las demás deben retornar 409: ${statuses.join(',')}`);

  const winnerRes = raceResponses.find((r) => r.status === 201)!;
  const winnerJson = (await winnerRes.json()) as {
    manageToken: string;
    summary: { bookingCode: string; clientEmail: string };
  };

  // Verificar lookup por código + correo
  const lookupRes = await fetchStatus('/api/citas/gestionar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'lookup',
      bookingCode: winnerJson.summary.bookingCode,
      email: winnerJson.summary.clientEmail,
    }),
  });
  assert.equal(lookupRes.status, 200);

  // Verificar reprogramación a slotB
  const rescheduleRes = await fetchStatus('/api/citas/gestionar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'reschedule',
      manageToken: winnerJson.manageToken,
      date: targetDate,
      startTime: slotB,
      barberId: targetBarberId,
    }),
  });
  assert.equal(rescheduleRes.status, 200);

  // Cancelar la cita de prueba para dejar limpia la agenda real
  const cancelRes = await fetchStatus('/api/citas/gestionar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'cancel',
      manageToken: winnerJson.manageToken,
    }),
  });
  assert.equal(cancelRes.status, 200);
});
