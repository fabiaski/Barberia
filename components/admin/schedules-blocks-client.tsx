'use client';

import { useState } from 'react';
import {
  CalendarOff,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { DAYS_OF_WEEK_ES } from '@/lib/constants/config';
import { formatTime12h } from '@/lib/utils/timezone';
import type { AdminBarberRecord } from '@/services/admin';
import type { DaySchedule, ScheduleBlock, WorkSchedule } from '@/types';

interface SchedulesBlocksClientProps {
  initialSchedule: WorkSchedule;
  initialBlocks: ScheduleBlock[];
  barbers: AdminBarberRecord[];
}

const ORDERED_DAY_VALUES = [1, 2, 3, 4, 5, 6, 0];

export function SchedulesBlocksClient({
  initialSchedule,
  initialBlocks,
  barbers,
}: SchedulesBlocksClientProps) {
  const [days, setDays] = useState<DaySchedule[]>(initialSchedule.days);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(initialBlocks);

  const [blockBarberId, setBlockBarberId] = useState<string>('all');
  const [blockDate, setBlockDate] = useState<string>('');
  const [blockAllDay, setBlockAllDay] = useState<boolean>(true);
  const [blockStart, setBlockStart] = useState<string>('12:00');
  const [blockEnd, setBlockEnd] = useState<string>('14:00');
  const [blockReason, setBlockReason] = useState<string>('');

  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingBlock, setSavingBlock] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const updateDayField = (
    dayOfWeek: number,
    patch: Partial<DaySchedule>
  ) => {
    setDays((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
    );
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSchedule(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/horarios', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          scheduleId: 'general',
          days,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Error al guardar horario.');
      setMessage(
        data.message || 'Horario general actualizado correctamente.'
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No fue posible guardar el horario.'
      );
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBlock(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/bloqueos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          barberId: blockBarberId,
          date: blockDate,
          allDay: blockAllDay,
          startTime: blockAllDay ? '' : blockStart,
          endTime: blockAllDay ? '' : blockEnd,
          reason: blockReason,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Error al crear bloqueo.');

      const listRes = await fetch('/api/admin/bloqueos', {
        credentials: 'include',
      });
      const listData = (await listRes.json()) as { blocks?: ScheduleBlock[] };
      if (listRes.ok && listData.blocks) {
        setBlocks(listData.blocks);
      }

      setBlockDate('');
      setBlockReason('');
      setMessage(data.message || 'Bloqueo agregado.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No fue posible crear el bloqueo.'
      );
    } finally {
      setSavingBlock(false);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    setSavingBlock(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch(`/api/admin/bloqueos/${blockId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Error al eliminar bloqueo.');
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      setMessage(data.message || 'Bloqueo eliminado.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No fue posible eliminar el bloqueo.'
      );
    } finally {
      setSavingBlock(false);
    }
  };

  const resolveBarberName = (barberId: string) => {
    if (barberId === 'all') return 'Toda la barbería';
    return barbers.find((b) => b.id === barberId)?.name ?? barberId;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[var(--font-playfair)] text-3xl font-semibold text-stone-900 [text-wrap:balance]">
          Horarios generales y bloqueos
        </h1>
        <p className="mt-1.5 text-sm text-stone-600">
          Configura la jornada semanal de lunes a domingo y bloquea fechas u
          horas puntuales por festivos o novedades.
        </p>
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSaveSchedule}
        className="rounded-xl border border-stone-200 bg-white p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Horario general de atención (Lunes a Domingo)
            </h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Aplica al sitio público y como base para todos los barberos.
            </p>
          </div>
          <button
            type="submit"
            disabled={savingSchedule}
            className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
          >
            {savingSchedule ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Guardar horario</span>
          </button>
        </div>

        <div className="mt-4 divide-y divide-stone-100">
          {ORDERED_DAY_VALUES.map((dayValue) => {
            const label =
              DAYS_OF_WEEK_ES.find((d) => d.value === dayValue)?.label ?? '';
            const day = days.find((d) => d.dayOfWeek === dayValue) ?? {
              dayOfWeek: dayValue,
              isOpen: true,
              openTime: '08:00',
              closeTime: '20:00',
            };

            return (
              <div
                key={dayValue}
                className="grid gap-3 py-3 sm:grid-cols-12 sm:items-center"
              >
                <div className="sm:col-span-3">
                  <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-stone-900">
                    <input
                      type="checkbox"
                      checked={day.isOpen}
                      onChange={(e) =>
                        updateDayField(dayValue, { isOpen: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-stone-300 text-stone-900"
                    />
                    <span>{label}</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:col-span-5">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-500">
                      Apertura
                    </label>
                    <input
                      type="time"
                      disabled={!day.isOpen}
                      value={day.openTime}
                      onChange={(e) =>
                        updateDayField(dayValue, { openTime: e.target.value })
                      }
                      className="mt-1 min-h-[38px] w-full rounded-lg border border-stone-300 px-2.5 py-1 font-mono text-xs text-stone-900 disabled:bg-stone-100 disabled:text-stone-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-500">
                      Cierre
                    </label>
                    <input
                      type="time"
                      disabled={!day.isOpen}
                      value={day.closeTime}
                      onChange={(e) =>
                        updateDayField(dayValue, { closeTime: e.target.value })
                      }
                      className="mt-1 min-h-[38px] w-full rounded-lg border border-stone-300 px-2.5 py-1 font-mono text-xs text-stone-900 disabled:bg-stone-100 disabled:text-stone-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:col-span-4">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-500">
                      Descanso inicio (opc.)
                    </label>
                    <input
                      type="time"
                      disabled={!day.isOpen}
                      value={day.breakStart ?? ''}
                      onChange={(e) =>
                        updateDayField(dayValue, {
                          breakStart: e.target.value,
                        })
                      }
                      className="mt-1 min-h-[38px] w-full rounded-lg border border-stone-300 px-2.5 py-1 font-mono text-xs text-stone-900 disabled:bg-stone-100 disabled:text-stone-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-500">
                      Descanso fin (opc.)
                    </label>
                    <input
                      type="time"
                      disabled={!day.isOpen}
                      value={day.breakEnd ?? ''}
                      onChange={(e) =>
                        updateDayField(dayValue, { breakEnd: e.target.value })
                      }
                      className="mt-1 min-h-[38px] w-full rounded-lg border border-stone-300 px-2.5 py-1 font-mono text-xs text-stone-900 disabled:bg-stone-100 disabled:text-stone-400"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </form>

      <div className="grid gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleCreateBlock}
          className="rounded-xl border border-stone-200 bg-white p-6 lg:col-span-5"
        >
          <div className="flex items-center gap-2">
            <CalendarOff className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-stone-900">
              Bloquear fecha u horario
            </h2>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="blk-barber"
                className="block text-xs font-semibold text-stone-700"
              >
                Aplica a
              </label>
              <select
                id="blk-barber"
                value={blockBarberId}
                onChange={(e) => setBlockBarberId(e.target.value)}
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
              >
                <option value="all">Toda la barbería</option>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="blk-date"
                className="block text-xs font-semibold text-stone-700"
              >
                Fecha
              </label>
              <input
                id="blk-date"
                type="date"
                required
                value={blockDate}
                onChange={(e) => setBlockDate(e.target.value)}
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900"
              />
            </div>

            <div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-800">
                <input
                  type="checkbox"
                  checked={blockAllDay}
                  onChange={(e) => setBlockAllDay(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300"
                />
                <span>Bloquear todo el día</span>
              </label>
            </div>

            {!blockAllDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="blk-start"
                    className="block text-xs font-semibold text-stone-700"
                  >
                    Hora inicio
                  </label>
                  <input
                    id="blk-start"
                    type="time"
                    required
                    value={blockStart}
                    onChange={(e) => setBlockStart(e.target.value)}
                    className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="blk-end"
                    className="block text-xs font-semibold text-stone-700"
                  >
                    Hora fin
                  </label>
                  <input
                    id="blk-end"
                    type="time"
                    required
                    value={blockEnd}
                    onChange={(e) => setBlockEnd(e.target.value)}
                    className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="blk-reason"
                className="block text-xs font-semibold text-stone-700"
              >
                Motivo del bloqueo
              </label>
              <input
                id="blk-reason"
                type="text"
                required
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Ej. Día festivo, mantenimiento o descanso"
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900"
              />
            </div>

            <button
              type="submit"
              disabled={savingBlock}
              className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
            >
              {savingBlock ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Registrar bloqueo</span>
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-stone-200 bg-white p-6 lg:col-span-7">
          <h2 className="text-base font-semibold text-stone-900">
            Bloqueos programados ({blocks.length})
          </h2>

          {blocks.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">
              No hay fechas ni franjas bloqueadas actualmente.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-stone-100">
              {blocks.map((block) => (
                <div
                  key={block.id}
                  className="flex items-center justify-between gap-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900">
                      <span className="font-mono tabular-nums">{block.date}</span>{' '}
                      · {resolveBarberName(block.barberId)}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {block.allDay
                        ? 'Todo el día'
                        : `${formatTime12h(block.startTime ?? '')} – ${formatTime12h(block.endTime ?? '')}`}{' '}
                      · {block.reason}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={savingBlock}
                    onClick={() => handleDeleteBlock(block.id)}
                    aria-label={`Eliminar bloqueo ${block.date}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
