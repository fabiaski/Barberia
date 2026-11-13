import { ClientsDirectoryClient } from '@/components/admin/clients-directory-client';
import { listAdminClients } from '@/services/admin';

export const dynamic = 'force-dynamic';

export default async function AdminClientesPage() {
  const clients = await listAdminClients();
  return <ClientsDirectoryClient initialClients={clients} />;
}
