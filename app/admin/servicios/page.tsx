import { ServicesManagerClient } from '@/components/admin/services-manager-client';
import { listAdminServices } from '@/services/admin';

export const dynamic = 'force-dynamic';

export default async function AdminServiciosPage() {
  const services = await listAdminServices();
  return <ServicesManagerClient initialServices={services} />;
}
