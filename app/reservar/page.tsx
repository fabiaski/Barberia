import { BookingWizard } from '@/components/public/booking-wizard';
import { getPublicCatalog } from '@/services/public-catalog';

export const dynamic = 'force-dynamic';

interface ReservarPageProps {
  searchParams: Promise<{
    servicio?: string;
    barbero?: string;
  }>;
}

export default async function ReservarPage({ searchParams }: ReservarPageProps) {
  const [catalog, params] = await Promise.all([
    getPublicCatalog(),
    searchParams,
  ]);

  return (
    <BookingWizard
      catalog={catalog}
      initialServiceId={params.servicio}
      initialBarberId={params.barbero}
    />
  );
}
