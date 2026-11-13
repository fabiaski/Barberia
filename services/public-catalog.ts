import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { hasAdminServiceAccount } from '@/lib/firebase-admin';
import {
  serverCommitWrites,
  serverGetDoc,
  serverQueryCollection,
  serverSetDoc,
  type ServerBatchOperation,
} from '@/lib/firestore-server';
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
  tagline:
    'Corte clásico, diseño de barba y atención sin filas en Chapinero Alto.',
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
 * En modo vista previa sin Service Account solo escribe si se pasa un idToken de administrador.
 */
export async function ensureInitialCatalogSeeded(
  idToken?: string
): Promise<void> {
  if (!hasAdminServiceAccount() && !idToken) {
    return;
  }

  const configSnap = await serverGetDoc('configuracion', 'main', idToken);

  if (configSnap.exists) {
    const [
      corteCabelloDoc,
      corteBarbaDoc,
      barbaDoc,
      joseDoc,
      legacyBarberDoc,
      generalScheduleDoc,
    ] = await Promise.all([
      serverGetDoc('servicios', 'corte-de-cabello', idToken),
      serverGetDoc('servicios', 'corte-y-barba', idToken),
      serverGetDoc('servicios', 'barba', idToken),
      serverGetDoc('barberos', 'jose', idToken),
      serverGetDoc('barberos', 'mateo-rojas', idToken),
      serverGetDoc('horarios', 'general', idToken),
    ]);

    const configData = configSnap.data;
    const isAdminEdited = Boolean(configData?.updatedByAdmin);

    const scheduleDays = Array.isArray(generalScheduleDoc.data?.days)
      ? (generalScheduleDoc.data?.days as DaySchedule[])
      : [];
    const sundaySchedule = scheduleDays.find((d) => d.dayOfWeek === 0);
    const needsSundayOpenMigration =
      !isAdminEdited &&
      (!sundaySchedule ||
        !sundaySchedule.isOpen ||
        sundaySchedule.openTime !== '08:00' ||
        sundaySchedule.closeTime !== '20:00');

    const needsServiceMigration =
      !isAdminEdited &&
      (!corteCabelloDoc.exists || !corteBarbaDoc.exists || !barbaDoc.exists);
    const needsBarberMigration =
      !isAdminEdited && (!joseDoc.exists || legacyBarberDoc.exists);

    if (
      !needsServiceMigration &&
      !needsBarberMigration &&
      !needsSundayOpenMigration
    ) {
      return;
    }

    if (needsBarberMigration) {
      for (const barber of DEFAULT_BARBERS) {
        await serverSetDoc(
          'usuarios',
          barber.userId,
          {
            uid: barber.userId,
            email: `${barber.id}@barberiaestudio.co`,
            displayName: barber.name,
            role: 'barbero',
            barberId: barber.id,
            active: true,
          },
          { serverTimestampFields: ['createdAt', 'updatedAt'] },
          idToken
        );
      }
    }

    const ops: ServerBatchOperation[] = [];

    if (needsSundayOpenMigration) {
      ops.push({
        type: 'set',
        collection: 'horarios',
        docId: 'general',
        data: {
          id: 'general',
          isPublic: true,
          days: DEFAULT_DAYS,
        },
        serverTimestampFields: ['updatedAt'],
      });
    }

    if (needsServiceMigration) {
      for (const legacyId of LEGACY_SEED_SERVICE_IDS) {
        ops.push({
          type: 'delete',
          collection: 'servicios',
          docId: legacyId,
        });
      }
      for (const svc of DEFAULT_SERVICES) {
        ops.push({
          type: 'set',
          collection: 'servicios',
          docId: svc.id,
          data: svc,
          serverTimestampFields: ['createdAt', 'updatedAt'],
        });
      }
    }

    if (needsBarberMigration) {
      for (const legacyBarber of LEGACY_SEED_BARBER_IDS) {
        ops.push({
          type: 'delete',
          collection: 'barberos',
          docId: legacyBarber.id,
        });
        ops.push({
          type: 'delete',
          collection: 'usuarios',
          docId: legacyBarber.userId,
        });
      }
      for (const barber of DEFAULT_BARBERS) {
        ops.push({
          type: 'set',
          collection: 'barberos',
          docId: barber.id,
          data: barber,
          serverTimestampFields: ['createdAt', 'updatedAt'],
        });
      }
    }

    await serverCommitWrites(ops, idToken);
    return;
  }

  // Crear usuarios de barberos antes de crear documentos en `barberos` (requisito `exists()` en rules)
  for (const barber of DEFAULT_BARBERS) {
    await serverSetDoc(
      'usuarios',
      barber.userId,
      {
        uid: barber.userId,
        email: `${barber.id}@barberiaestudio.co`,
        displayName: barber.name,
        role: 'barbero',
        barberId: barber.id,
        active: true,
      },
      { serverTimestampFields: ['createdAt', 'updatedAt'] },
      idToken
    );
  }

  const initialOps: ServerBatchOperation[] = [
    {
      type: 'set',
      collection: 'configuracion',
      docId: 'main',
      data: DEFAULT_CONFIG,
      serverTimestampFields: ['updatedAt'],
    },
    {
      type: 'set',
      collection: 'horarios',
      docId: 'general',
      data: {
        id: 'general',
        isPublic: true,
        days: DEFAULT_DAYS,
      },
      serverTimestampFields: ['updatedAt'],
    },
    ...DEFAULT_SERVICES.map((svc) => ({
      type: 'set' as const,
      collection: 'servicios',
      docId: svc.id,
      data: svc,
      serverTimestampFields: ['createdAt', 'updatedAt'],
    })),
    ...DEFAULT_BARBERS.map((barber) => ({
      type: 'set' as const,
      collection: 'barberos',
      docId: barber.id,
      data: barber,
      serverTimestampFields: ['createdAt', 'updatedAt'],
    })),
  ];

  await serverCommitWrites(initialOps, idToken);
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

    const [configDoc, scheduleDoc, servicesDocs, barbersDocs] =
      await Promise.all([
        serverGetDoc('configuracion', 'main').catch(() => ({
          id: 'main',
          exists: false,
          data: undefined,
        })),
        serverGetDoc('horarios', 'general').catch(() => ({
          id: 'general',
          exists: false,
          data: undefined,
        })),
        serverQueryCollection('servicios', {
          filters: [{ field: 'active', op: '==', value: true }],
        }).catch(() => []),
        serverQueryCollection('barberos', {
          filters: [{ field: 'active', op: '==', value: true }],
        }).catch(() => []),
      ]);

    const configData = configDoc.data;
    const scheduleData = scheduleDoc.data;

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

    const services: Service[] =
      servicesDocs.length > 0
        ? servicesDocs
            .map((doc) => {
              const d = doc.data ?? {};
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
            .sort((a, b) => a.order - b.order)
        : getFallbackCatalog().services;

    const barbers: Barber[] =
      barbersDocs.length > 0
        ? barbersDocs.map((doc) => {
            const d = doc.data ?? {};
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
          })
        : getFallbackCatalog().barbers;

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
