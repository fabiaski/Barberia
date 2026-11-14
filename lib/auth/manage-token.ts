import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import firebaseAppletConfig from '@/firebase-applet-config.json';

interface ManageTokenPayload {
  id: string;
  email: string;
  exp: number;
}

function getManageTokenSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.FIREBASE_ADMIN_PRIVATE_KEY ||
    `${firebaseAppletConfig.projectId}:${firebaseAppletConfig.apiKey}:manage-booking-v1`
  );
}

/**
 * Genera un token HMAC-SHA256 firmado en servidor para que el cliente pueda
 * consultar, cancelar o reprogramar su reserva sin exponer permisos de Firestore.
 */
export function createBookingManageToken(
  appointmentId: string,
  clientEmail: string,
  ttlDays: number = 30
): string {
  const payload: ManageTokenPayload = {
    id: appointmentId,
    email: clientEmail.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60,
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    'utf-8'
  ).toString('base64url');
  const signature = createHmac('sha256', getManageTokenSecret())
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

export function verifyBookingManageToken(
  token: string
): { appointmentId: string; email: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return null;

    const expectedSignature = createHmac('sha256', getManageTokenSecret())
      .update(encodedPayload)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const decoded = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf-8')
    ) as Partial<ManageTokenPayload>;

    if (
      !decoded.id ||
      !decoded.email ||
      typeof decoded.exp !== 'number' ||
      decoded.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      appointmentId: decoded.id,
      email: decoded.email.trim().toLowerCase(),
    };
  } catch {
    return null;
  }
}
