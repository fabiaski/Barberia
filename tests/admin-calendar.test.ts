import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMonthlyCalendarGrid,
  formatMonthTitleEs,
  getBogotaYearMonth,
  getShortStatusLabelEs,
  groupAppointmentsByDate,
  shiftYearMonth,
  summarizeMonthAppointments,
} from '@/lib/utils/admin-calendar';
import { AppointmentStatus, type Appointment } from '@/types';

function makeAppointment(
  overrides: Partial<Appointment> & { id: string; date: string; startTime: string }
): Appointment {
  return {
    clientId: 'cli_1',
    clientName: 'Cliente Prueba',
    clientPhone: '3100000000',
    clientEmail: 'cliente@correo.co',
    barberId: 'jose',
    barberUid: 'uid_jose',
    barberName: 'José Ramírez',
    serviceId: 'corte',
    serviceName: 'Corte de cabello',
    priceCop: 20000,
    durationMinutes: 30,
    endTime: '10:30',
    status: AppointmentStatus.CONFIRMED,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...overrides,
  };
}

test('Calendario mensual: navegación de meses y grilla lunes-domingo en America/Bogota', () => {
  assert.equal(getBogotaYearMonth('2026-11-19'), '2026-11');
  assert.equal(shiftYearMonth('2026-01', -1), '2025-12');
  assert.equal(shiftYearMonth('2026-12', 1), '2027-01');
  assert.equal(formatMonthTitleEs('2026-11'), 'Noviembre 2026');

  // Noviembre 2026 empieza domingo (1 de nov): lunes previo es 2026-10-26
  const novGrid = buildMonthlyCalendarGrid('2026-11', '2026-11-19');
  assert.equal(novGrid.cells.length % 7, 0);
  assert.equal(novGrid.gridStartDate, '2026-10-26');
  assert.equal(novGrid.monthStartDate, '2026-11-01');
  assert.equal(novGrid.monthEndDate, '2026-11-30');
  assert.equal(novGrid.gridEndDate, '2026-12-06');

  const todayCell = novGrid.cells.find((c) => c.date === '2026-11-19');
  assert.ok(todayCell);
  assert.equal(todayCell.isToday, true);
  assert.equal(todayCell.inCurrentMonth, true);

  const prevMonthCell = novGrid.cells.find((c) => c.date === '2026-10-26');
  assert.ok(prevMonthCell);
  assert.equal(prevMonthCell.inCurrentMonth, false);
  assert.equal(prevMonthCell.isToday, false);

  // Febrero 2024 (bisiesto) tiene 29 días
  const febLeapGrid = buildMonthlyCalendarGrid('2024-02', '2024-02-10');
  assert.equal(febLeapGrid.monthEndDate, '2024-02-29');
});

test('Agrupación por fecha, orden cronológico y resumen financiero mensual', () => {
  const appointments: Appointment[] = [
    makeAppointment({
      id: 'a2',
      date: '2026-11-19',
      startTime: '15:00',
      priceCop: 30000,
      status: AppointmentStatus.COMPLETED,
    }),
    makeAppointment({
      id: 'a1',
      date: '2026-11-19',
      startTime: '09:00',
      priceCop: 20000,
      status: AppointmentStatus.CONFIRMED,
    }),
    makeAppointment({
      id: 'a3',
      date: '2026-11-20',
      startTime: '11:30',
      priceCop: 10000,
      status: AppointmentStatus.IN_PROGRESS,
    }),
    makeAppointment({
      id: 'a4',
      date: '2026-11-21',
      startTime: '16:00',
      priceCop: 20000,
      status: AppointmentStatus.CANCELLED,
    }),
    makeAppointment({
      id: 'a_next_month',
      date: '2026-12-02',
      startTime: '10:00',
      priceCop: 50000,
      status: AppointmentStatus.CONFIRMED,
    }),
  ];

  const grouped = groupAppointmentsByDate(appointments);
  assert.deepEqual(
    grouped['2026-11-19']?.map((a) => a.id),
    ['a1', 'a2']
  );

  const summary = summarizeMonthAppointments(appointments, '2026-11');
  assert.equal(summary.total, 4);
  assert.equal(summary.active, 2);
  assert.equal(summary.completed, 1);
  assert.equal(summary.cancelledOrNoShow, 1);
  assert.equal(summary.completedRevenueCop, 30000);
  assert.equal(summary.projectedRevenueCop, 60000);

  assert.equal(getShortStatusLabelEs(AppointmentStatus.IN_PROGRESS), 'En curso');
  assert.equal(getShortStatusLabelEs(AppointmentStatus.CANCELLED), 'Cancelada');
});
