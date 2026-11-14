import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import {
  serverGetDoc,
  serverQueryCollection,
} from '@/lib/firestore-server';
import { getBogotaDateString } from '@/lib/utils/timezone';
import {
  AppointmentStatus,
  type Appointment,
  type Barber,
  type BarbershopConfig,
  type Client,
  type DaySchedule,
  type ScheduleBlock,
  type Service,
  type WorkSchedule,
} from '@/types';

export interface AdminBarberRecord extends Barber {
  email: string;
  phone?: string;
}

export interface AdminReportSummary {
  totalAppointments: number;
  confirmedCount: number;
  completedCount: number;
  cancelledOrNoShowCount: number;
  completedRevenueCop: number;
  projectedRevenueCop: number;
  byBarber: Array<{
    barberId: string;
    barberName: string;
    total: number;
    completed: number;
    revenueCop: number;
  }>;
  byService: Array<{
    serviceId: string;
    serviceName: string;
    total: number;
    revenueCop: number;
  }>;
}

export function serializeTimestamp(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

export function slugifyFirestoreId(raw: string): string {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return cleaned || `item-${Date.now()}`;
}

export async function generateUniqueDocId(
  collectionName: string,
  baseText: string,
  idToken?: string
): Promise<string> {
  const baseId = slugifyFirestoreId(baseText);
  let candidate = baseId;
  let counter = 2;

  while (true) {
    const snap = await serverGetDoc(collectionName, candidate, idToken);
    if (!snap.exists) {
      return candidate;
    }
    candidate = `${baseId}-${counter}`.slice(0, 120);
    counter += 1;
  }
}

export async function listAdminBarbers(
  idToken?: string
): Promise<AdminBarberRecord[]> {
  const [barbersDocs, usersDocs] = await Promise.all([
    serverQueryCollection('barberos', {}, idToken),
    serverQueryCollection(
      'usuarios',
      { filters: [{ field: 'role', op: '==', value: 'barbero' }] },
      idToken
    ),
  ]);

  const userByUid = new Map<string, { email: string; phone?: string }>();
  for (const doc of usersDocs) {
    const d = doc.data ?? {};
    userByUid.set(doc.id, {
      email: String(d.email ?? ''),
      phone: d.phone ? String(d.phone) : undefined,
    });
  }

  return barbersDocs
    .map((doc) => {
      const d = doc.data ?? {};
      const userId = String(d.userId ?? '');
      const linkedUser = userByUid.get(userId);
      return {
        id: doc.id,
        userId,
        name: String(d.name ?? ''),
        specialty: String(d.specialty ?? ''),
        bio: d.bio ? String(d.bio) : undefined,
        photoUrl: d.photoUrl ? String(d.photoUrl) : undefined,
        active: Boolean(d.active),
        email: linkedUser?.email ?? `${doc.id}@barberiaestudio.co`,
        phone: linkedUser?.phone,
        createdAt: serializeTimestamp(d.createdAt),
        updatedAt: serializeTimestamp(d.updatedAt),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function listAdminServices(idToken?: string): Promise<Service[]> {
  const docs = await serverQueryCollection('servicios', {}, idToken);

  return docs
    .map((doc) => {
      const d = doc.data ?? {};
      return {
        id: doc.id,
        name: String(d.name ?? ''),
        description: String(d.description ?? ''),
        priceCop: Number(d.priceCop ?? 0),
        durationMinutes: Number(d.durationMinutes ?? 30),
        active: Boolean(d.active),
        order: Number(d.order ?? 0),
        createdAt: serializeTimestamp(d.createdAt),
        updatedAt: serializeTimestamp(d.updatedAt),
      };
    })
    .sort((a, b) => a.order - b.order);
}

export async function listAdminClients(
  searchQuery?: string,
  idToken?: string
): Promise<Client[]> {
  const [docs, citaDocs] = await Promise.all([
    serverQueryCollection('clientes', {}, idToken),
    serverQueryCollection('citas', {}, idToken).catch(() => []),
  ]);
  const normalizedQuery = searchQuery?.trim().toLowerCase() ?? '';

  const clientMap = new Map<string, Client>();
  for (const doc of docs) {
    const d = doc.data ?? {};
    const email = String(d.email ?? '').trim().toLowerCase();
    const key = email || doc.id;
    clientMap.set(key, {
      id: doc.id,
      fullName: String(d.fullName ?? ''),
      phone: String(d.phone ?? ''),
      email: String(d.email ?? ''),
      totalAppointments: Number(d.totalAppointments ?? 0),
      lastAppointmentAt: d.lastAppointmentAt
        ? serializeTimestamp(d.lastAppointmentAt)
        : undefined,
      createdAt: serializeTimestamp(d.createdAt),
      updatedAt: serializeTimestamp(d.updatedAt),
    });
  }

  const apptCountsByEmail = new Map<string, number>();
  for (const cDoc of citaDocs) {
    const cd = cDoc.data ?? {};
    const email = String(cd.clientEmail ?? '').trim().toLowerCase();
    if (!email) continue;
    apptCountsByEmail.set(email, (apptCountsByEmail.get(email) ?? 0) + 1);

    const createdIso = serializeTimestamp(cd.createdAt);
    const updatedIso = serializeTimestamp(cd.updatedAt);
    const existing = clientMap.get(email);
    if (!existing) {
      clientMap.set(email, {
        id: String(cd.clientId ?? cDoc.id),
        fullName: String(cd.clientName ?? ''),
        phone: String(cd.clientPhone ?? ''),
        email,
        totalAppointments: 1,
        lastAppointmentAt: createdIso,
        createdAt: createdIso,
        updatedAt: updatedIso,
      });
    } else {
      const totalCitas = apptCountsByEmail.get(email) ?? existing.totalAppointments;
      if (totalCitas > existing.totalAppointments) {
        existing.totalAppointments = totalCitas;
      }
      if (updatedIso > existing.updatedAt) {
        existing.updatedAt = updatedIso;
        existing.lastAppointmentAt = createdIso;
      }
    }
  }

  return Array.from(clientMap.values())
    .filter((client) => {
      if (!normalizedQuery) return true;
      return (
        client.fullName.toLowerCase().includes(normalizedQuery) ||
        client.phone.toLowerCase().includes(normalizedQuery) ||
        client.email.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAdminSchedulesAndBlocks(idToken?: string): Promise<{
  generalSchedule: WorkSchedule;
  blocks: ScheduleBlock[];
  barbers: AdminBarberRecord[];
}> {
  const [generalDoc, blocksDocs, barbers] = await Promise.all([
    serverGetDoc('horarios', 'general', idToken),
    serverQueryCollection('bloqueos', {}, idToken),
    listAdminBarbers(idToken),
  ]);

  const defaultDays: DaySchedule[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isOpen: true,
    openTime: '08:00',
    closeTime: '20:00',
  }));

  const scheduleData = generalDoc.data;
  const generalSchedule: WorkSchedule = {
    id: 'general',
    isPublic: true,
    days: Array.isArray(scheduleData?.days)
      ? (scheduleData.days as DaySchedule[])
      : defaultDays,
    updatedAt: serializeTimestamp(scheduleData?.updatedAt),
  };

  const blocks: ScheduleBlock[] = blocksDocs
    .map((doc) => {
      const d = doc.data ?? {};
      return {
        id: doc.id,
        barberId: String(d.barberId ?? 'all'),
        barberUid: d.barberUid ? String(d.barberUid) : undefined,
        date: String(d.date ?? ''),
        allDay: Boolean(d.allDay),
        startTime: d.startTime ? String(d.startTime) : undefined,
        endTime: d.endTime ? String(d.endTime) : undefined,
        reason: String(d.reason ?? ''),
        createdBy: String(d.createdBy ?? ''),
        createdAt: serializeTimestamp(d.createdAt),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    generalSchedule,
    blocks,
    barbers,
  };
}

export async function getAdminShopConfig(
  idToken?: string
): Promise<BarbershopConfig> {
  const doc = await serverGetDoc('configuracion', 'main', idToken);
  const d = doc.data;

  return {
    id: 'main',
    name: String(d?.name ?? 'Barbería Estudio'),
    tagline: String(
      d?.tagline ??
        'Corte clásico, diseño de barba y atención sin filas en Chapinero Alto.'
    ),
    address: String(d?.address ?? 'Calle 59 # 8-34, Local 2 · Chapinero Alto'),
    city: String(d?.city ?? 'Bogotá, Colombia'),
    phone: String(d?.phone ?? '+57 310 458 9210'),
    email: String(d?.email ?? 'reservas@barberiaestudio.co'),
    whatsapp: d?.whatsapp ? String(d.whatsapp) : '',
    instagram: d?.instagram ? String(d.instagram) : '',
    adminNotificationEmail: d?.adminNotificationEmail
      ? String(d.adminNotificationEmail)
      : '',
    timezone: 'America/Bogota',
    slotIntervalMinutes: Number(d?.slotIntervalMinutes ?? 30),
    updatedByAdmin: Boolean(d?.updatedByAdmin),
    updatedAt: serializeTimestamp(d?.updatedAt),
  };
}

export async function getAdminAppointmentsAndReport(
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    barberId?: string;
    status?: string;
  },
  idToken?: string
): Promise<{
  appointments: Appointment[];
  summary: AdminReportSummary;
  todayBogota: string;
}> {
  const todayBogota = getBogotaDateString(new Date());
  const docs = await serverQueryCollection('citas', {}, idToken);

  const allAppointments: Appointment[] = docs.map((doc) => {
    const d = doc.data ?? {};
    return {
      id: doc.id,
      clientId: String(d.clientId ?? ''),
      clientName: String(d.clientName ?? ''),
      clientPhone: String(d.clientPhone ?? ''),
      clientEmail: String(d.clientEmail ?? ''),
      barberId: String(d.barberId ?? ''),
      barberUid: String(d.barberUid ?? ''),
      barberName: String(d.barberName ?? ''),
      serviceId: String(d.serviceId ?? ''),
      serviceName: String(d.serviceName ?? ''),
      priceCop: Number(d.priceCop ?? 0),
      durationMinutes: Number(d.durationMinutes ?? 30),
      date: String(d.date ?? ''),
      startTime: String(d.startTime ?? ''),
      endTime: String(d.endTime ?? ''),
      status: String(d.status ?? AppointmentStatus.CONFIRMED) as AppointmentStatus,
      notes: d.notes ? String(d.notes) : undefined,
      createdAt: serializeTimestamp(d.createdAt),
      updatedAt: serializeTimestamp(d.updatedAt),
    };
  });

  const filtered = allAppointments
    .filter((appt) => {
      if (filters?.dateFrom && appt.date < filters.dateFrom) return false;
      if (filters?.dateTo && appt.date > filters.dateTo) return false;
      if (
        filters?.barberId &&
        filters.barberId !== 'all' &&
        appt.barberId !== filters.barberId
      ) {
        return false;
      }
      if (
        filters?.status &&
        filters.status !== 'all' &&
        appt.status !== filters.status
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return a.startTime.localeCompare(b.startTime);
    });

  let confirmedCount = 0;
  let completedCount = 0;
  let cancelledOrNoShowCount = 0;
  let completedRevenueCop = 0;
  let projectedRevenueCop = 0;

  const barberAgg = new Map<
    string,
    {
      barberId: string;
      barberName: string;
      total: number;
      completed: number;
      revenueCop: number;
    }
  >();
  const serviceAgg = new Map<
    string,
    {
      serviceId: string;
      serviceName: string;
      total: number;
      revenueCop: number;
    }
  >();

  for (const appt of filtered) {
    if (
      appt.status === AppointmentStatus.CONFIRMED ||
      appt.status === AppointmentStatus.IN_PROGRESS
    ) {
      confirmedCount += 1;
      projectedRevenueCop += appt.priceCop;
    } else if (appt.status === AppointmentStatus.COMPLETED) {
      completedCount += 1;
      completedRevenueCop += appt.priceCop;
      projectedRevenueCop += appt.priceCop;
    } else {
      cancelledOrNoShowCount += 1;
    }

    const currentBarber = barberAgg.get(appt.barberId) ?? {
      barberId: appt.barberId,
      barberName: appt.barberName,
      total: 0,
      completed: 0,
      revenueCop: 0,
    };
    currentBarber.total += 1;
    if (appt.status === AppointmentStatus.COMPLETED) {
      currentBarber.completed += 1;
      currentBarber.revenueCop += appt.priceCop;
    }
    barberAgg.set(appt.barberId, currentBarber);

    const currentService = serviceAgg.get(appt.serviceId) ?? {
      serviceId: appt.serviceId,
      serviceName: appt.serviceName,
      total: 0,
      revenueCop: 0,
    };
    currentService.total += 1;
    if (
      appt.status === AppointmentStatus.COMPLETED ||
      appt.status === AppointmentStatus.CONFIRMED ||
      appt.status === AppointmentStatus.IN_PROGRESS
    ) {
      currentService.revenueCop += appt.priceCop;
    }
    serviceAgg.set(appt.serviceId, currentService);
  }

  return {
    appointments: filtered,
    todayBogota,
    summary: {
      totalAppointments: filtered.length,
      confirmedCount,
      completedCount,
      cancelledOrNoShowCount,
      completedRevenueCop,
      projectedRevenueCop,
      byBarber: Array.from(barberAgg.values()).sort((a, b) => b.total - a.total),
      byService: Array.from(serviceAgg.values()).sort(
        (a, b) => b.total - a.total
      ),
    },
  };
}
