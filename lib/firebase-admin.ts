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

/**
 * Inicialización exclusiva de servidor para Firebase Admin SDK.
 * Protegida por 'server-only' para impedir su inclusión en el bundle del navegador.
 * Utiliza las variables privadas de .env.example (FIREBASE_ADMIN_*).
 */
function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseAppletConfig.projectId;

  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  const privateKey = rawPrivateKey
    ? rawPrivateKey.replace(/\\n/g, '\n')
    : undefined;

  const storageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    firebaseAppletConfig.storageBucket;

  if (!projectId) {
    throw new Error(
      'Falta FIREBASE_ADMIN_PROJECT_ID para inicializar Firebase Admin SDK.'
    );
  }

  // En entornos locales y Vercel se autentica con la cuenta de servicio de .env
  if (clientEmail && privateKey) {
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
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim() ?? '';
  return Boolean(email && key.includes('PRIVATE KEY'));
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
