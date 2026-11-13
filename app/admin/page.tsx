import { DashboardReportsClient } from '@/components/admin/dashboard-reports-client';
import {
  getAdminAppointmentsAndReport,
  listAdminBarbers,
  listAdminClients,
  listAdminServices,
} from '@/services/admin';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const [reportData, barbers, services, clients] = await Promise.all([
    getAdminAppointmentsAndReport(),
    listAdminBarbers(),
    listAdminServices(),
    listAdminClients(),
  ]);

  return (
    <DashboardReportsClient
      initialAppointments={reportData.appointments}
      initialSummary={reportData.summary}
      barbers={barbers}
      todayBogota={reportData.todayBogota}
      totalActiveBarbers={barbers.filter((b) => b.active).length}
      totalActiveServices={services.filter((s) => s.active).length}
      totalClients={clients.length}
    />
  );
}
