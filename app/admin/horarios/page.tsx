import { SchedulesBlocksClient } from '@/components/admin/schedules-blocks-client';
import { getAdminSchedulesAndBlocks } from '@/services/admin';

export const dynamic = 'force-dynamic';

export default async function AdminHorariosPage() {
  const data = await getAdminSchedulesAndBlocks();
  return (
    <SchedulesBlocksClient
      initialSchedule={data.generalSchedule}
      initialBlocks={data.blocks}
      barbers={data.barbers}
    />
  );
}
