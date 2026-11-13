'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { AdminBarberRecord } from '@/services/admin';

interface BarbersManagerClientProps {
  initialBarbers: AdminBarberRecord[];
}

const STUDIO_PORTRAITS = [
  { label: 'Retrato estudio 1', url: '/images/barber_mateo.jpg' },
  { label: 'Retrato estudio 2', url: '/images/barber_sebastian.jpg' },
  { label: 'Retrato estudio 3', url: '/images/barber_andres.jpg' },
] as const;

export function BarbersManagerClient({
  initialBarbers,
}: BarbersManagerClientProps) {
  const [barbers, setBarbers] = useState<AdminBarberRecord[]>(initialBarbers);
  const [editingBarber, setEditingBarber] = useState<AdminBarberRecord | null>(
    null
  );
  const [isCreating, setIsCreating] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [bio, setBio] = useState('');
  const [photoUrl, setPhotoUrl] = useState('/images/barber_mateo.jpg');
  const [active, setActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reloadBarbers = async () => {
    const res = await fetch('/api/admin/barberos', { credentials: 'include' });
    const data = (await res.json()) as { barbers?: AdminBarberRecord[] };
    if (res.ok && data.barbers) {
      setBarbers(data.barbers);
    }
  };

  const openCreateForm = () => {
    setEditingBarber(null);
    setIsCreating(true);
    setName('');
    setEmail('');
    setPassword('');
    setPhone('');
    setSpecialty('');
    setBio('');
    setPhotoUrl('/images/barber_sebastian.jpg');
    setActive(true);
    setError('');
    setMessage('');
  };

  const openEditForm = (barber: AdminBarberRecord) => {
    setIsCreating(false);
    setEditingBarber(barber);
    setName(barber.name);
    setEmail(barber.email);
    setPassword('');
    setPhone(barber.phone ?? '');
    setSpecialty(barber.specialty);
    setBio(barber.bio ?? '');
    setPhotoUrl(barber.photoUrl || '/images/barber_mateo.jpg');
    setActive(barber.active);
    setError('');
    setMessage('');
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingBarber(null);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    try {
      if (isCreating) {
        const res = await fetch('/api/admin/barberos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name,
            email,
            password,
            phone,
            specialty,
            bio,
            photoUrl,
            active,
          }),
        });
        const data = (await res.json()) as { message?: string; error?: string };
        if (!res.ok) throw new Error(data.error || 'Error al crear barbero.');
        setMessage(data.message || 'Barbero creado correctamente.');
      } else if (editingBarber) {
        const res = await fetch(`/api/admin/barberos/${editingBarber.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name,
            specialty,
            bio,
            photoUrl,
            phone,
            active,
            ...(password.trim() ? { newPassword: password } : {}),
          }),
        });
        const data = (await res.json()) as { message?: string; error?: string };
        if (!res.ok)
          throw new Error(data.error || 'Error al actualizar barbero.');
        setMessage(data.message || 'Barbero actualizado correctamente.');
      }

      await reloadBarbers();
      closeForm();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No fue posible guardar los cambios.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrDeactivate = async (barber: AdminBarberRecord) => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/barberos/${barber.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Error al eliminar barbero.');
      setMessage(data.message || 'Operación completada.');
      await reloadBarbers();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No fue posible completar la acción.'
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
            Gestión de barberos
          </h1>
          <p className="mt-1.5 text-sm text-stone-600">
            Administra el equipo visible para reservas y sus credenciales de
            acceso al panel `/barbero`.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex min-h-[42px] items-center gap-2 whitespace-nowrap rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-800"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Nuevo barbero</span>
        </button>
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span>{message}</span>
        </div>
      )}

      {error && !isCreating && !editingBarber && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {error}
        </div>
      )}

      {(isCreating || editingBarber) && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-stone-200 bg-white p-6"
        >
          <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4">
            <h2 className="text-base font-semibold text-stone-900">
              {isCreating
                ? 'Registrar nuevo barbero'
                : `Editar a ${editingBarber?.name}`}
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
                htmlFor="barber-name"
                className="block text-xs font-semibold text-stone-700"
              >
                Nombre completo
              </label>
              <input
                id="barber-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. José Ramírez"
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="barber-email"
                className="block text-xs font-semibold text-stone-700"
              >
                Correo de acceso
              </label>
              <input
                id="barber-email"
                type="email"
                required
                disabled={!isCreating}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="barbero@barberiaestudio.co"
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none disabled:bg-stone-100 disabled:text-stone-500"
              />
            </div>

            <div>
              <label
                htmlFor="barber-password"
                className="block text-xs font-semibold text-stone-700"
              >
                {isCreating
                  ? 'Contraseña inicial (mín. 6 caracteres)'
                  : 'Nueva contraseña (opcional para asignar o cambiar)'}
              </label>
              <input
                id="barber-password"
                type="password"
                required={isCreating}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isCreating ? 'Mínimo 6 caracteres' : 'Dejar vacío para mantener'}
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="barber-phone"
                className="block text-xs font-semibold text-stone-700"
              >
                Teléfono / WhatsApp (opcional)
              </label>
              <input
                id="barber-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="310 000 0000"
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="barber-specialty"
                className="block text-xs font-semibold text-stone-700"
              >
                Especialidad
              </label>
              <input
                id="barber-specialty"
                type="text"
                required
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="Corte para caballeros y niños · Barba clásica"
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="barber-bio"
                className="block text-xs font-semibold text-stone-700"
              >
                Descripción breve
              </label>
              <textarea
                id="barber-bio"
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="barber-photo"
                className="block text-xs font-semibold text-stone-700"
              >
                Fotografía (ruta local o URL)
              </label>
              <input
                id="barber-photo"
                type="text"
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {STUDIO_PORTRAITS.map((preset) => (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => setPhotoUrl(preset.url)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      photoUrl === preset.url
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : 'border-stone-300 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center pt-5">
              <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-medium text-stone-800">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 text-stone-900"
                />
                <span>Barbero activo (visible para reservas y acceso)</span>
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
              <span>{isCreating ? 'Crear barbero' : 'Guardar cambios'}</span>
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs font-medium text-stone-500">
                <th className="px-5 py-3">Barbero</th>
                <th className="px-5 py-3">Especialidad</th>
                <th className="px-5 py-3">Correo de acceso</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {barbers.map((barber) => (
                <tr key={barber.id} className="hover:bg-stone-50">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
                        {barber.photoUrl ? (
                          <Image
                            src={barber.photoUrl}
                            alt={barber.name}
                            fill
                            sizes="40px"
                            referrerPolicy="no-referrer"
                            className="object-cover"
                          />
                        ) : (
                          <User className="h-4 w-4 text-stone-500" aria-hidden="true" />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-stone-900">
                          {barber.name}
                        </p>
                        <p className="font-mono text-xs text-stone-500">
                          {barber.id}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-stone-700">
                    {barber.specialty}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-stone-600">
                    {barber.email}
                  </td>
                  <td className="px-5 py-3.5 text-xs font-medium">
                    <span
                      className={
                        barber.active ? 'text-emerald-700' : 'text-stone-500'
                      }
                    >
                      {barber.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEditForm(barber)}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-800 hover:bg-stone-100"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleDeleteOrDeactivate(barber)}
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
