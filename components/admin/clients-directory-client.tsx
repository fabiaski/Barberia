'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Client } from '@/types';

interface ClientsDirectoryClientProps {
  initialClients: Client[];
}

export function ClientsDirectoryClient({
  initialClients,
}: ClientsDirectoryClientProps) {
  const [search, setSearch] = useState('');

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialClients;
    return initialClients.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [initialClients, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[var(--font-playfair)] text-3xl font-semibold text-stone-900 [text-wrap:balance]">
            Directorio de clientes
          </h1>
          <p className="mt-1.5 text-sm text-stone-600">
            Registro histórico de personas que han reservado en la barbería.
          </p>
        </div>

        <div className="relative w-full sm:w-80">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono o correo..."
            className="min-h-[42px] w-full rounded-lg border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-700 focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {filteredClients.length === 0 ? (
          <div className="p-8 text-center text-sm text-stone-500">
            {initialClients.length === 0
              ? 'Todavía no hay clientes registrados en Cloud Firestore. Se crearán automáticamente al confirmar reservas en la Etapa 6.'
              : 'No hay clientes que coincidan con tu búsqueda.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs font-medium text-stone-500">
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Teléfono</th>
                  <th className="px-5 py-3">Correo electrónico</th>
                  <th className="px-5 py-3 text-right">Citas totales</th>
                  <th className="px-5 py-3 text-right">Última actividad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredClients.map((client) => (
                  <tr key={client.id} className="hover:bg-stone-50">
                    <td className="px-5 py-3.5 font-medium text-stone-900">
                      {client.fullName}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-stone-700 tabular-nums">
                      {client.phone}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-stone-600">
                      {client.email}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold text-stone-900 tabular-nums">
                      {client.totalAppointments}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-xs text-stone-500 tabular-nums">
                      {client.lastAppointmentAt
                        ? client.lastAppointmentAt.slice(0, 10)
                        : client.updatedAt.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
