import { AdminMonthlyCalendar } from '@/components/admin/monthly-calendar-client';
import {
  getAdminAppointmentsAndReport,
  listAdminBarbers,
} from '@/services/admin';

export const dynamic = 'force-dynamic';

export default async function AdminCalendarPage() {
  const [reportData, barbers] = await Promise.all([
    getAdminAppointmentsAndReport(),
    listAdminBarbers(),
  ]);

  return (
    <AdminMonthlyCalendar
      initialAppointments={reportData.appointments}
      barbers={barbers}
      todayBogota={reportData.todayBogota}
    />
  );
}
