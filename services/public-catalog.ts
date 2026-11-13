import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  type Barber,
  type BarbershopConfig,
  type DaySchedule,
  type Service,
  type WorkSchedule,
} from '@/types';

export interface PublicCatalogData {
  config: BarbershopConfig;
  schedule: WorkSchedule;
  services: Service[];
  barbers: Barber[];
}

const DEFAULT_CONFIG: Omit<BarbershopConfig, 'updatedAt'> = {
  id: 'main',
  name: 'Barbería Estudio',
  tagline: 'Corte clásico, diseño de barba y atención sin filas en Chapinero Alto.',
  address: 'Calle 59 # 8-34, Local 2 · Chapinero Alto',
  city: 'Bogotá, Colombia',
  phone: '+57 310 458 9210',
  email: 'reservas@barberiaestudio.co',
  whatsapp: '+57 310 458 9210',
  instagram: '@barberiaestudio.co',
  timezone: 'America/Bogota',
  slotIntervalMinutes: 30,
};

const DEFAULT_DAYS: DaySchedule[] = [
  { dayOfWeek: 0, isOpen: true, openTime: '08:00', closeTime: '20:00' },
  { dayOfWeek: 1, isOpen: true, openTime: '08:00', closeTime: '20:00' },
  { dayOfWeek: 2, isOpen: true, openTime: '08:00', closeTime: '20:00' },
  { dayOfWeek: 3, isOpen: true, openTime: '08:00', closeTime: '20:00' },
  { dayOfWeek: 4, isOpen: true, openTime: '08:00', closeTime: '20:00' },
  { dayOfWeek: 5, isOpen: true, openTime: '08:00', closeTime: '20:00' },
  { dayOfWeek: 6, isOpen: true, openTime: '08:00', closeTime: '20:00' },
];

const DEFAULT_SERVICES: Omit<Service, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'corte-de-cabello',
    name: 'Corte de cabello',
    description: 'Para caballeros y niños.',
    priceCop: 20000,
    durationMinutes: 30,
    active: true,
    order: 1,
  },
  {
    id: 'corte-y-barba',
    name: 'Corte y barba',
    description: 'Servicio integral de corte de cabello y arreglo de barba.',
    priceCop: 30000,
    durationMinutes: 40,
    active: true,
    order: 2,
  },
  {
    id: 'barba',
    name: 'Barba',
    description: 'Perfilado y arreglo clásico de barba.',
    priceCop: 10000,
    durationMinutes: 20,
    active: true,
    order: 3,
  },
];

const LEGACY_SEED_SERVICE_IDS = [
  'corte-clasico',
  'fade-precision',
  'ritual-barba',
  'combo-estudio',
  'corte-ejecutivo',
];

const LEGACY_SEED_BARBER_IDS = [
  { id: 'mateo-rojas', userId: 'barber_mateo_rojas' },
  { id: 'sebastian-pardo', userId: 'barber_sebastian_pardo' },
  { id: 'andres-gomez', userId: 'barber_andres_gomez' },
];

const DEFAULT_BARBERS: Omit<Barber, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'jose',
    userId: 'barber_jose',
    name: 'José',
    specialty: 'Corte para caballeros y niños · Barba clásica',
    bio: 'Atención personalizada en corte de cabello para caballeros y niños, y perfilado clásico de barba.',
    photoUrl: '/images/barber_mateo.jpg',
    active: true,
  },
];

function serializeTimestamp(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

/**
 * Inicializa el catálogo base en Cloud Firestore si aún no existe configuracion/main,
 * o actualiza los datos iniciales anteriores (servicios, horario 8am-8pm lunes a domingo y barbero José).
 */
async function ensureInitialCatalogSeeded(): Promise<void> {
  const db = getAdminDb();
  const configRef = db.collection('configuracion').doc('main');
  const configSnap = await configRef.get();
  const now = Timestamp.now();

  if (configSnap.exists) {
    const [
      newMainServiceSnap,
      legacyServiceSnap,
      joseBarberSnap,
      legacyBarberSnap,
      generalScheduleSnap,
    ] = await Promise.all([
      db.collection('servicios').doc('corte-de-cabello').get(),
      db.collection('servicios').doc('corte-clasico').get(),
      db.collection('barberos').doc('jose').get(),
      db.collection('barberos').doc('mateo-rojas').get(),
      db.collection('horarios').doc('general').get(),
    ]);

    const needsServiceMigration =
      !newMainServiceSnap.exists && legacyServiceSnap.exists;
    const needsBarberAndHoursMigration =
      !joseBarberSnap.exists && legacyBarberSnap.exists;

    const currentConfig = configSnap.data();
    const needsIntervalUpgrade =
      currentConfig &&
      currentConfig.updatedByAdmin !== true &&
      currentConfig.slotIntervalMinutes !== 30;

    const scheduleData = generalScheduleSnap.data();
    const sundayEntry = Array.isArray(scheduleData?.days)
      ? (scheduleData.days as DaySchedule[]).find((d) => d.dayOfWeek === 0)
      : undefined;
    const needsSundayOpenMigration =
      currentConfig?.updatedByAdmin !== true &&
      (!generalScheduleSnap.exists || sundayEntry?.isOpen === false);

    if (
      needsServiceMigration ||
      needsBarberAndHoursMigration ||
      needsIntervalUpgrade ||
      needsSundayOpenMigration
    ) {
      const migrationBatch = db.batch();

      if (needsServiceMigration) {
        for (const legacyId of LEGACY_SEED_SERVICE_IDS) {
          migrationBatch.delete(db.collection('servicios').doc(legacyId));
        }
        for (const service of DEFAULT_SERVICES) {
          migrationBatch.set(db.collection('servicios').doc(service.id), {
            ...service,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      if (needsBarberAndHoursMigration) {
        for (const legacyBarber of LEGACY_SEED_BARBER_IDS) {
          migrationBatch.delete(db.collection('barberos').doc(legacyBarber.id));
          migrationBatch.delete(
            db.collection('usuarios').doc(legacyBarber.userId)
          );
        }
        for (const barber of DEFAULT_BARBERS) {
          migrationBatch.set(db.collection('usuarios').doc(barber.userId), {
            uid: barber.userId,
            email: `${barber.id}@barberiaestudio.co`,
            displayName: barber.name,
            role: 'barbero',
            barberId: barber.id,
            active: true,
            createdAt: now,
            updatedAt: now,
          });
          migrationBatch.set(db.collection('barberos').doc(barber.id), {
            ...barber,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      if (needsBarberAndHoursMigration || needsSundayOpenMigration) {
        migrationBatch.set(db.collection('horarios').doc('general'), {
          id: 'general',
          isPublic: true,
          days: DEFAULT_DAYS,
          updatedAt: now,
        });
      }

      if (needsServiceMigration || needsIntervalUpgrade) {
        migrationBatch.update(configRef, {
          slotIntervalMinutes: 30,
          updatedAt: now,
        });
      }

      await migrationBatch.commit();
    }
    return;
  }

  const batch = db.batch();

  batch.set(configRef, {
    ...DEFAULT_CONFIG,
    updatedAt: now,
  });

  batch.set(db.collection('horarios').doc('general'), {
    id: 'general',
    isPublic: true,
    days: DEFAULT_DAYS,
    updatedAt: now,
  });

  for (const service of DEFAULT_SERVICES) {
    batch.set(db.collection('servicios').doc(service.id), {
      ...service,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const barber of DEFAULT_BARBERS) {
    batch.set(db.collection('usuarios').doc(barber.userId), {
      uid: barber.userId,
      email: `${barber.id.replace('-', '.')}@barberiaestudio.co`,
      displayName: barber.name,
      role: 'barbero',
      barberId: barber.id,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    batch.set(db.collection('barberos').doc(barber.id), {
      ...barber,
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
}

function getFallbackCatalog(): PublicCatalogData {
  const nowIso = new Date().toISOString();
  return {
    config: { ...DEFAULT_CONFIG, updatedAt: nowIso },
    schedule: {
      id: 'general',
      isPublic: true,
      days: DEFAULT_DAYS,
      updatedAt: nowIso,
    },
    services: DEFAULT_SERVICES.map((s) => ({
      ...s,
      createdAt: nowIso,
      updatedAt: nowIso,
    })),
    barbers: DEFAULT_BARBERS.map((b) => ({
      ...b,
      createdAt: nowIso,
      updatedAt: nowIso,
    })),
  };
}

/**
 * Carga la configuración, horario general, servicios activos y barberos activos desde Cloud Firestore.
 */
export async function getPublicCatalog(): Promise<PublicCatalogData> {
  try {
    await ensureInitialCatalogSeeded();
    const db = getAdminDb();

    const [configDoc, scheduleDoc, servicesSnap, barbersSnap] =
      await Promise.all([
        db.collection('configuracion').doc('main').get(),
        db.collection('horarios').doc('general').get(),
        db.collection('servicios').where('active', '==', true).get(),
        db.collection('barberos').where('active', '==', true).get(),
      ]);

    const configData = configDoc.data();
    const scheduleData = scheduleDoc.data();

    const config: BarbershopConfig = configData
      ? {
          id: 'main',
          name: String(configData.name ?? DEFAULT_CONFIG.name),
          tagline: String(configData.tagline ?? DEFAULT_CONFIG.tagline),
          address: String(configData.address ?? DEFAULT_CONFIG.address),
          city: String(configData.city ?? DEFAULT_CONFIG.city),
          phone: String(configData.phone ?? DEFAULT_CONFIG.phone),
          email: String(configData.email ?? DEFAULT_CONFIG.email),
          whatsapp: configData.whatsapp ? String(configData.whatsapp) : undefined,
          instagram: configData.instagram
            ? String(configData.instagram)
            : undefined,
          timezone: 'America/Bogota',
          slotIntervalMinutes: Number(configData.slotIntervalMinutes ?? 30),
          updatedAt: serializeTimestamp(configData.updatedAt),
        }
      : { ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() };

    const schedule: WorkSchedule = scheduleData
      ? {
          id: String(scheduleData.id ?? 'general'),
          isPublic: Boolean(scheduleData.isPublic ?? true),
          days: Array.isArray(scheduleData.days)
            ? (scheduleData.days as DaySchedule[])
            : DEFAULT_DAYS,
          updatedAt: serializeTimestamp(scheduleData.updatedAt),
        }
      : {
          id: 'general',
          isPublic: true,
          days: DEFAULT_DAYS,
          updatedAt: new Date().toISOString(),
        };

    const services: Service[] = servicesSnap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          name: String(d.name),
          description: String(d.description),
          priceCop: Number(d.priceCop),
          durationMinutes: Number(d.durationMinutes),
          active: Boolean(d.active),
          order: Number(d.order ?? 0),
          createdAt: serializeTimestamp(d.createdAt),
          updatedAt: serializeTimestamp(d.updatedAt),
        };
      })
      .sort((a, b) => a.order - b.order);

    const barbers: Barber[] = barbersSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        userId: String(d.userId),
        name: String(d.name),
        specialty: String(d.specialty),
        bio: d.bio ? String(d.bio) : undefined,
        photoUrl: d.photoUrl ? String(d.photoUrl) : undefined,
        active: Boolean(d.active),
        createdAt: serializeTimestamp(d.createdAt),
        updatedAt: serializeTimestamp(d.updatedAt),
      };
    });

    return {
      config,
      schedule,
      services,
      barbers,
    };
  } catch (error) {
    console.error('Error cargando catálogo público desde Firestore:', error);
    return getFallbackCatalog();
  }
}
