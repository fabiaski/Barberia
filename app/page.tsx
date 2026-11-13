import { Navbar } from '@/components/public/navbar';
import { HeroSection } from '@/components/public/hero-section';
import { ServicesSection } from '@/components/public/services-section';
import { GallerySection } from '@/components/public/gallery-section';
import { BarbersSection } from '@/components/public/barbers-section';
import { InfoFooter } from '@/components/public/info-footer';
import { getPublicCatalog } from '@/services/public-catalog';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const catalog = await getPublicCatalog();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Navbar brandName={catalog.config.name} />
      <main>
        <HeroSection
          config={catalog.config}
          scheduleDays={catalog.schedule.days}
        />
        <ServicesSection services={catalog.services} />
        <GallerySection />
        <BarbersSection barbers={catalog.barbers} />
      </main>
      <InfoFooter
        config={catalog.config}
        scheduleDays={catalog.schedule.days}
      />
    </div>
  );
}
