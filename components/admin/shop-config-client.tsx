'use client';

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  Save,
  Send,
} from 'lucide-react';
import {
  parseJsonResponseSafe,
  translateErrorMessageEs,
} from '@/lib/utils/error-es';
import type { EmailServiceStatus } from '@/services/email';
import type { BarbershopConfig } from '@/types';

interface ShopConfigClientProps {
  initialConfig: BarbershopConfig;
  emailStatus: EmailServiceStatus;
}

export function ShopConfigClient({
  initialConfig,
  emailStatus,
}: ShopConfigClientProps) {
  const [name, setName] = useState(initialConfig.name);
  const [tagline, setTagline] = useState(initialConfig.tagline);
  const [address, setAddress] = useState(initialConfig.address);
  const [city, setCity] = useState(initialConfig.city);
  const [phone, setPhone] = useState(initialConfig.phone);
  const [email, setEmail] = useState(initialConfig.email);
  const [whatsapp, setWhatsapp] = useState(initialConfig.whatsapp ?? '');
  const [instagram, setInstagram] = useState(initialConfig.instagram ?? '');
  const [adminNotificationEmail, setAdminNotificationEmail] = useState(
    initialConfig.adminNotificationEmail ?? ''
  );
  const [slotIntervalMinutes, setSlotIntervalMinutes] = useState(
    String(initialConfig.slotIntervalMinutes || 30)
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [testEmail, setTestEmail] = useState(
    initialConfig.adminNotificationEmail ||
      emailStatus.envAdminNotificationEmail ||
      ''
  );
  const [sendingTest, setSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testError, setTestError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const res = await fetch('/api/admin/configuracion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          tagline,
          address,
          city,
          phone,
          email,
          whatsapp,
          instagram,
          adminNotificationEmail,
          slotIntervalMinutes: Number(slotIntervalMinutes),
        }),
      });
      const data =
        (await parseJsonResponseSafe<{ message?: string; error?: string }>(
          res
        )) ?? {};
      if (!res.ok) {
        throw new Error(
          translateErrorMessageEs(
            data.error,
            'Error al guardar la configuración.'
          )
        );
      }
      setMessage(
        data.message || 'Configuración actualizada en Cloud Firestore.'
      );
    } catch (err) {
      setError(
        translateErrorMessageEs(err, 'No fue posible guardar la configuración.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendingTest(true);
    setTestMessage('');
    setTestError('');

    try {
      const res = await fetch('/api/admin/notificaciones/prueba', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: testEmail.trim() }),
      });
      const data =
        (await parseJsonResponseSafe<{ message?: string; error?: string }>(
          res
        )) ?? {};
      if (!res.ok) {
        throw new Error(
          translateErrorMessageEs(
            data.error,
            'No fue posible enviar el correo de prueba.'
          )
        );
      }
      setTestMessage(data.message || 'Correo de prueba enviado correctamente.');
    } catch (err) {
      setTestError(
        translateErrorMessageEs(err, 'Error al probar el envío con Resend.')
      );
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[var(--font-playfair)] text-3xl font-semibold text-stone-900 [text-wrap:balance]">
          Configuración de la barbería
        </h1>
        <p className="mt-1.5 text-sm text-stone-600">
          Información institucional visible en la página pública y parámetros de
          agendamiento (`America/Bogota`).
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
        onSubmit={handleSubmit}
        className="rounded-xl border border-stone-200 bg-white p-6"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="cfg-name"
              className="block text-xs font-semibold text-stone-700"
            >
              Nombre de la barbería
            </label>
            <input
              id="cfg-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cfg-city"
              className="block text-xs font-semibold text-stone-700"
            >
              Ciudad
            </label>
            <input
              id="cfg-city"
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="cfg-tagline"
              className="block text-xs font-semibold text-stone-700"
            >
              Eslogan principal
            </label>
            <input
              id="cfg-tagline"
              type="text"
              required
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="cfg-address"
              className="block text-xs font-semibold text-stone-700"
            >
              Dirección física
            </label>
            <input
              id="cfg-address"
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cfg-phone"
              className="block text-xs font-semibold text-stone-700"
            >
              Teléfono público
            </label>
            <input
              id="cfg-phone"
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cfg-email"
              className="block text-xs font-semibold text-stone-700"
            >
              Correo público de contacto
            </label>
            <input
              id="cfg-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cfg-wa"
              className="block text-xs font-semibold text-stone-700"
            >
              WhatsApp
            </label>
            <input
              id="cfg-wa"
              type="text"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cfg-ig"
              className="block text-xs font-semibold text-stone-700"
            >
              Instagram
            </label>
            <input
              id="cfg-ig"
              type="text"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cfg-admin-mail"
              className="block text-xs font-semibold text-stone-700"
            >
              Correo copia de nuevas citas (opcional)
            </label>
            <input
              id="cfg-admin-mail"
              type="email"
              value={adminNotificationEmail}
              onChange={(e) => setAdminNotificationEmail(e.target.value)}
              placeholder="fabiaski13@gmail.com"
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cfg-interval"
              className="block text-xs font-semibold text-stone-700"
            >
              Intervalo entre turnos en agenda
            </label>
            <select
              id="cfg-interval"
              value={slotIntervalMinutes}
              onChange={(e) => setSlotIntervalMinutes(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            >
              <option value="30">Cada 30 minutos (Recomendado)</option>
              <option value="15">Cada 15 minutos</option>
              <option value="10">Cada 10 minutos</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-stone-100 pt-5">
          <span className="font-mono text-xs text-stone-500">
            Zona horaria fija: {initialConfig.timezone}
          </span>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-stone-900 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Guardar configuración</span>
          </button>
        </div>
      </form>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <h2 className="font-[var(--font-playfair)] text-xl font-semibold text-stone-900">
                Notificaciones por correo (Resend)
              </h2>
            </div>
            <p className="mt-1 text-xs text-stone-600">
              Envío automático al confirmar, reprogramar o cancelar citas para
              cliente, barbero asignado y correo copia de administración.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium">
            {emailStatus.resendConfigured ? (
              <>
                <CheckCircle2
                  className="h-4 w-4 text-emerald-700"
                  aria-hidden="true"
                />
                <span className="text-emerald-800">
                  API de Resend activa
                </span>
              </>
            ) : (
              <>
                <AlertCircle
                  className="h-4 w-4 text-amber-700"
                  aria-hidden="true"
                />
                <span className="text-amber-800">
                  Pendiente variable RESEND_API_KEY
                </span>
              </>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-3 text-xs text-stone-600 sm:grid-cols-3">
          <div>
            <dt className="text-stone-500">Remitente configurado</dt>
            <dd className="mt-0.5 truncate font-mono font-medium text-stone-900">
              {emailStatus.fromEmail}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">URL para enlaces de gestión</dt>
            <dd className="mt-0.5 truncate font-mono font-medium text-stone-900">
              {emailStatus.appUrl}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Copia respaldo (.env)</dt>
            <dd className="mt-0.5 truncate font-mono font-medium text-stone-900">
              {emailStatus.envAdminNotificationEmail || 'Sin definir'}
            </dd>
          </div>
        </dl>

        {testMessage && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-emerald-700"
              aria-hidden="true"
            />
            <span>{testMessage}</span>
          </div>
        )}

        {testError && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
            <AlertCircle
              className="h-4 w-4 shrink-0 text-red-700"
              aria-hidden="true"
            />
            <span>{testError}</span>
          </div>
        )}

        <form
          onSubmit={handleSendTestEmail}
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label
              htmlFor="cfg-test-email"
              className="block text-xs font-semibold text-stone-700"
            >
              Correo destino para prueba de entrega
            </label>
            <input
              id="cfg-test-email"
              type="email"
              required
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="fabiaski13@gmail.com"
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={sendingTest}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-xs font-semibold text-stone-900 transition-colors hover:border-stone-400 hover:bg-stone-100 disabled:opacity-60"
          >
            {sendingTest ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Enviar correo de prueba</span>
          </button>
        </form>
      </section>
    </div>
  );
}
