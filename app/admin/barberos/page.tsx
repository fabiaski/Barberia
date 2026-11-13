import { BarbersManagerClient } from '@/components/admin/barbers-manager-client';
import { listAdminBarbers } from '@/services/admin';

export const dynamic = 'force-dynamic';

export default async function AdminBarberosPage() {
  const barbers = await listAdminBarbers();
  return <BarbersManagerClient initialBarbers={barbers} />;
}
