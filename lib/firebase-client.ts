import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import firebaseAppletConfig from '@/firebase-applet-config.json';

/**
 * Configuración del SDK de Firebase para el entorno cliente (navegador).
 * Lee las variables públicas NEXT_PUBLIC_FIREBASE_* definidas en .env.example
 * y utiliza firebase-applet-config.json como respaldo automático en AI Studio.
 */
const firebaseClientConfig: FirebaseOptions = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseAppletConfig.apiKey,
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    firebaseAppletConfig.authDomain,
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseAppletConfig.projectId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    firebaseAppletConfig.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    firebaseAppletConfig.messagingSenderId,
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID || firebaseAppletConfig.appId,
};

const firestoreDatabaseId =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
  firebaseAppletConfig.firestoreDatabaseId ||
  undefined;

function validateClientConfig(config: FirebaseOptions): void {
  const missing: string[] = [];
  if (!config.apiKey) missing.push('NEXT_PUBLIC_FIREBASE_API_KEY');
  if (!config.authDomain) missing.push('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN');
  if (!config.projectId) missing.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  if (!config.appId) missing.push('NEXT_PUBLIC_FIREBASE_APP_ID');

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de configuración de Firebase Cliente: ${missing.join(', ')}`
    );
  }
}

function getClientApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp();
  }
  validateClientConfig(firebaseClientConfig);
  return initializeApp(firebaseClientConfig);
}

export const firebaseApp: FirebaseApp = getClientApp();
export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = firestoreDatabaseId
  ? getFirestore(firebaseApp, firestoreDatabaseId)
  : getFirestore(firebaseApp);
export const storage: FirebaseStorage = getStorage(firebaseApp);

let connectionChecked = false;

/**
 * Verifica al iniciar la aplicación que exista conectividad real con Cloud Firestore.
 */
export async function testFirestoreConnection(): Promise<boolean> {
  if (connectionChecked) return true;
  connectionChecked = true;
  try {
    await getDocFromServer(doc(db, 'configuracion', 'main'));
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error(
        'No fue posible conectar con Cloud Firestore: verifica la configuración de red y Firebase.'
      );
      return false;
    }
    return true;
  }
}
