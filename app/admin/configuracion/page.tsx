import { ShopConfigClient } from '@/components/admin/shop-config-client';
import { getAdminShopConfig } from '@/services/admin';

export const dynamic = 'force-dynamic';

export default async function AdminConfiguracionPage() {
  const config = await getAdminShopConfig();
  return <ShopConfigClient initialConfig={config} />;
}
