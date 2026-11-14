'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  parseJsonResponseSafe,
  translateErrorMessageEs,
} from '@/lib/utils/error-es';
import { formatCurrencyCOP } from '@/lib/utils/timezone';
import type { Service } from '@/types';

interface ServicesManagerClientProps {
  initialServices: Service[];
}

export function ServicesManagerClient({
  initialServices,
}: ServicesManagerClientProps) {
  const [services, setServices] = useState<Service[]>(initialServices);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceCop, setPriceCop] = useState('20000');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [order, setOrder] = useState('1');
  const [active, setActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reloadServices = async () => {
    const res = await fetch('/api/admin/servicios', { credentials: 'include' });
    const data = await parseJsonResponseSafe<{ services?: Service[] }>(res);
    if (res.ok && data?.services) {
      setServices(data.services);
    }
  };

  const openCreateForm = () => {
    setEditingService(null);
    setIsCreating(true);
    setName('');
    setDescription('');
    setPriceCop('20000');
    setDurationMinutes('30');
    setOrder(String(services.length + 1));
    setActive(true);
    setError('');
    setMessage('');
  };

  const openEditForm = (service: Service) => {
    setIsCreating(false);
    setEditingService(service);
    setName(service.name);
    setDescription(service.description);
    setPriceCop(String(service.priceCop));
    setDurationMinutes(String(service.durationMinutes));
    setOrder(String(service.order));
    setActive(service.active);
    setError('');
    setMessage('');
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingService(null);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    const payload = {
      name,
      description,
      priceCop: Number(priceCop),
      durationMinutes: Number(durationMinutes),
      order: Number(order),
      active,
    };

    try {
      const url = isCreating
        ? '/api/admin/servicios'
        : `/api/admin/servicios/${editingService?.id}`;
      const method = isCreating ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data =
        (await parseJsonResponseSafe<{ message?: string; error?: string }>(
          res
        )) ?? {};
      if (!res.ok) {
        throw new Error(
          translateErrorMessageEs(data.error, 'Error al guardar el servicio.')
        );
      }

      setMessage(data.message || 'Servicio guardado correctamente.');
      await reloadServices();
      closeForm();
    } catch (err) {
      setError(
        translateErrorMessageEs(err, 'No fue posible guardar el servicio.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (service: Service) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/admin/servicios/${service.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data =
        (await parseJsonResponseSafe<{ message?: string; error?: string }>(
          res
        )) ?? {};
      if (!res.ok) {
        throw new Error(
          translateErrorMessageEs(data.error, 'Error al eliminar el servicio.')
        );
      }
      setMessage(data.message || 'Operación completada.');
      await reloadServices();
    } catch (err) {
      setError(
        translateErrorMessageEs(err, 'No fue posible eliminar el servicio.')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[var(--font-playfair)] text-3xl font-semibold text-stone-900 [text-wrap:balance]">
            Catálogo de servicios
          </h1>
          <p className="mt-1.5 text-sm text-stone-600">
            Define los servicios visibles en el sitio público, su valor en COP y
            su duración en minutos.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex min-h-[42px] items-center gap-2 whitespace-nowrap rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-800"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Nuevo servicio</span>
        </button>
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span>{message}</span>
        </div>
      )}

      {error && !isCreating && !editingService && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {error}
        </div>
      )}

      {(isCreating || editingService) && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-stone-200 bg-white p-6"
        >
          <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4">
            <h2 className="text-base font-semibold text-stone-900">
              {isCreating
                ? 'Crear nuevo servicio'
                : `Editar ${editingService?.name}`}
            </h2>
            <button
              type="button"
              onClick={closeForm}
              aria-label="Cerrar formulario"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="srv-name"
                className="block text-xs font-semibold text-stone-700"
              >
                Nombre del servicio
              </label>
              <input
                id="srv-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="srv-price"
                  className="block text-xs font-semibold text-stone-700"
                >
                  Precio (COP)
                </label>
                <input
                  id="srv-price"
                  type="number"
                  min={1000}
                  step={500}
                  required
                  value={priceCop}
                  onChange={(e) => setPriceCop(e.target.value)}
                  className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900 tabular-nums focus:border-amber-700 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="srv-duration"
                  className="block text-xs font-semibold text-stone-700"
                >
                  Duración (min)
                </label>
                <input
                  id="srv-duration"
                  type="number"
                  min={10}
                  max={360}
                  step={5}
                  required
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900 tabular-nums focus:border-amber-700 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="srv-order"
                  className="block text-xs font-semibold text-stone-700"
                >
                  Orden
                </label>
                <input
                  id="srv-order"
                  type="number"
                  min={0}
                  required
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                  className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900 tabular-nums focus:border-amber-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="srv-desc"
                className="block text-xs font-semibold text-stone-700"
              >
                Descripción
              </label>
              <textarea
                id="srv-desc"
                rows={2}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-medium text-stone-800">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 text-stone-900"
                />
                <span>Servicio activo (visible para reservar)</span>
              </label>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-stone-100 pt-4">
            <button
              type="button"
              onClick={closeForm}
              className="min-h-[40px] rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
            >
              {saving && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              <span>{isCreating ? 'Crear servicio' : 'Guardar cambios'}</span>
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs font-medium text-stone-500">
                <th className="px-5 py-3">Orden</th>
                <th className="px-5 py-3">Servicio</th>
                <th className="px-5 py-3 text-right">Duración</th>
                <th className="px-5 py-3 text-right">Valor</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {services.map((service) => (
                <tr key={service.id} className="hover:bg-stone-50">
                  <td className="px-5 py-3.5 font-mono text-xs text-stone-500 tabular-nums">
                    {String(service.order).padStart(2, '0')}
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-stone-900">
                      {service.name}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {service.description}
                    </p>
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-xs text-stone-700 tabular-nums">
                    {service.durationMinutes} min
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold text-stone-900 tabular-nums">
                    {formatCurrencyCOP(service.priceCop)}
                  </td>
                  <td className="px-5 py-3.5 text-xs font-medium">
                    <span
                      className={
                        service.active ? 'text-emerald-700' : 'text-stone-500'
                      }
                    >
                      {service.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEditForm(service)}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-800 hover:bg-stone-100"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleDelete(service)}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
