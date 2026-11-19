import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import { Resend } from 'resend';
import {
  processAppointmentCreatedEvent,
  processAppointmentUpdatedEvent,
  type AuthLookupLike,
  type FirestoreLike,
  type NotificationEnvConfig,
} from './appointment-notifications';
import { cleanEnvValue, DEFAULT_FROM_EMAIL } from './email-templates';

const FIRESTORE_DATABASE_ID =
  process.env.FIREBASE_FIRESTORE_DATABASE_ID?.trim() ||
  'ai-studio-barberaestudiosi-fc169874-9958-4755-b79b-aa11fd9bffa5';

const DEFAULT_APP_URL =
  'https://ais-pre-5yvvnyojtxirbjy2bbxl6e-758035733542.us-west2.run.app';

const resendApiKeySecret = defineSecret('RESEND_API_KEY');

const app = getApps().length > 0 ? getApp() : initializeApp();
const db =
  FIRESTORE_DATABASE_ID && FIRESTORE_DATABASE_ID !== '(default)'
    ? getFirestore(app, FIRESTORE_DATABASE_ID)
    : getFirestore(app);
const adminAuth = getAuth(app);

const firestoreAdapter: FirestoreLike = {
  async getDoc(collection: string, docId: string) {
    const snap = await db.collection(collection).doc(docId).get();
    return {
      exists: snap.exists,
      data: () => snap.data() as Record<string, unknown> | undefined,
    };
  },
  async tryCreateNotificationLock(
    lockId: string,
    payload: Record<string, unknown>
  ) {
    try {
      await db.collection('notificaciones_citas').doc(lockId).create(payload);
      return true;
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === 6 || code === 'ALREADY_EXISTS' || code === 'already-exists') {
        return false;
      }
      // En caso de error transitorio distinto, no bloquear el envío
      return true;
    }
  },
};

const authAdapter: AuthLookupLike = {
  async getUserEmail(uid: string) {
    try {
      const userRecord = await adminAuth.getUser(uid);
      return userRecord.email;
    } catch {
      return undefined;
    }
  },
};

const DEFAULT_FIREBASE_API_KEY =
  cleanEnvValue(process.env.FIREBASE_WEB_API_KEY) ||
  'AIzaSyAGvMv-KZ1xk3ME2yhkrnnvjGOss0tQkf8';

function readRuntimeConfig(): NotificationEnvConfig {
  const apiKey =
    cleanEnvValue(resendApiKeySecret.value()) ||
    cleanEnvValue(process.env.RESEND_API_KEY);
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    'cogent-operator-q6gf7';

  return {
    resendApiKey: apiKey,
    fromEmail: cleanEnvValue(process.env.RESEND_FROM_EMAIL) || DEFAULT_FROM_EMAIL,
    appUrl: cleanEnvValue(process.env.APP_URL) || DEFAULT_APP_URL,
    adminNotificationEmail: cleanEnvValue(process.env.ADMIN_NOTIFICATION_EMAIL),
    manageTokenSecret:
      cleanEnvValue(process.env.SESSION_SECRET) ||
      `${projectId}:${DEFAULT_FIREBASE_API_KEY}:manage-booking-v1`,
  };
}

export const onAppointmentCreated = onDocumentCreated(
  {
    document: 'citas/{appointmentId}',
    database: FIRESTORE_DATABASE_ID,
    secrets: [resendApiKeySecret],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const appointmentId = event.params.appointmentId;
    const data = snapshot.data() as Record<string, unknown>;
    const env = readRuntimeConfig();
    const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

    const outcome = await processAppointmentCreatedEvent({
      appointmentId,
      data,
      db: firestoreAdapter,
      authLookup: authAdapter,
      resend,
      env,
    });

    if (outcome.errors.length > 0) {
      logger.warn('Notificación de creación con errores parciales', {
        appointmentId,
        outcome,
      });
    } else {
      logger.info('Resultado notificación de creación', {
        appointmentId,
        eventType: outcome.eventType,
        clientSent: outcome.clientSent,
        barberSent: outcome.barberSent,
        adminSent: outcome.adminSent,
        recipients: outcome.recipients,
      });
    }
  }
);

export const onAppointmentUpdated = onDocumentUpdated(
  {
    document: 'citas/{appointmentId}',
    database: FIRESTORE_DATABASE_ID,
    secrets: [resendApiKeySecret],
  },
  async (event) => {
    const change = event.data;
    if (!change) return;

    const appointmentId = event.params.appointmentId;
    const beforeData = change.before.data() as Record<string, unknown>;
    const afterData = change.after.data() as Record<string, unknown>;
    const env = readRuntimeConfig();
    const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

    const outcome = await processAppointmentUpdatedEvent({
      appointmentId,
      beforeData,
      afterData,
      db: firestoreAdapter,
      authLookup: authAdapter,
      resend,
      env,
    });

    if (outcome.errors.length > 0) {
      logger.warn('Notificación de actualización con errores parciales', {
        appointmentId,
        outcome,
      });
    } else if (outcome.eventType !== 'ignored') {
      logger.info('Resultado notificación de actualización', {
        appointmentId,
        eventType: outcome.eventType,
        clientSent: outcome.clientSent,
        barberSent: outcome.barberSent,
        adminSent: outcome.adminSent,
        recipients: outcome.recipients,
      });
    }
  }
);
