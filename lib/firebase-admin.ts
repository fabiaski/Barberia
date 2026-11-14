import 'server-only';
import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseAppletConfig from '@/firebase-applet-config.json';

function normalizePrivateKey(raw?: string): string | undefined {
  if (!raw) return undefined;
  let normalized = raw.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }
  normalized = normalized.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').trim();
  return normalized || undefined;
}

/**
 * Inicialización exclusiva de servidor para Firebase Admin SDK.
 * Protegida por 'server-only' para impedir su inclusión en el bundle del navegador.
 * Utiliza las variables privadas de .env.example (FIREBASE_ADMIN_*).
 */
function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId = (
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseAppletConfig.projectId
  )?.trim();

  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY);

  const storageBucket = (
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    firebaseAppletConfig.storageBucket
  )?.trim();

  if (!projectId) {
    throw new Error(
      'Falta FIREBASE_ADMIN_PROJECT_ID para inicializar Firebase Admin SDK.'
    );
  }

  // En entornos locales y Vercel se autentica con la cuenta de servicio de .env
  if (
    clientEmail &&
    privateKey &&
    privateKey.includes('BEGIN') &&
    privateKey.includes('PRIVATE KEY')
  ) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      storageBucket,
    });
  }

  // En entornos Google Cloud (Application Default Credentials) usa el projectId directamente
  return initializeApp({
    projectId,
    storageBucket,
  });
}

export function hasAdminServiceAccount(): boolean {
  const email = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() ?? '';
  const key = normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY) ?? '';
  return Boolean(
    email.includes('@') &&
      key.includes('BEGIN') &&
      key.includes('END') &&
      key.includes('PRIVATE KEY')
  );
}

export function getFirebaseProjectConfig() {
  return {
    projectId:
      process.env.FIREBASE_ADMIN_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      firebaseAppletConfig.projectId,
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseAppletConfig.apiKey,
    databaseId:
      process.env.FIREBASE_FIRESTORE_DATABASE_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
      firebaseAppletConfig.firestoreDatabaseId ||
      '(default)',
  };
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  const adminApp = getAdminApp();
  const databaseId =
    process.env.FIREBASE_FIRESTORE_DATABASE_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
    firebaseAppletConfig.firestoreDatabaseId ||
    undefined;

  return databaseId
    ? getFirestore(adminApp, databaseId)
    : getFirestore(adminApp);
}
