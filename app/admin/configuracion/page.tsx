import { ShopConfigClient } from '@/components/admin/shop-config-client';
import { getAdminShopConfig } from '@/services/admin';
import { getEmailServiceStatus } from '@/services/email';

export const dynamic = 'force-dynamic';

export default async function AdminConfiguracionPage() {
  const config = await getAdminShopConfig();
  const emailStatus = getEmailServiceStatus();
  return <ShopConfigClient initialConfig={config} emailStatus={emailStatus} />;
}
