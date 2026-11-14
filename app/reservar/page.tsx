import { BookingWizard } from '@/components/public/booking-wizard';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import { getServerIdToken } from '@/lib/firestore-server';
import { lookupPublicBooking } from '@/services/booking';
import { getPublicCatalog } from '@/services/public-catalog';

export const dynamic = 'force-dynamic';

interface ReservarPageProps {
  searchParams: Promise<{
    servicio?: string;
    barbero?: string;
    gestionar?: string;
    token?: string;
  }>;
}

export default async function ReservarPage({ searchParams }: ReservarPageProps) {
  const [catalog, params] = await Promise.all([
    getPublicCatalog(),
    searchParams,
  ]);

  let initialManageSummary = null;
  if (params.token) {
    const idToken = hasAdminServiceAccount()
      ? undefined
      : await getServerIdToken();
    initialManageSummary = await lookupPublicBooking(
      { manageToken: params.token },
      idToken
    ).catch(() => null);
  }

  return (
    <BookingWizard
      catalog={catalog}
      initialServiceId={params.servicio}
      initialBarberId={params.barbero}
      initialMode={
        params.gestionar === '1' || Boolean(params.token) ? 'manage' : 'book'
      }
      initialManageSummary={initialManageSummary}
    />
  );
}
