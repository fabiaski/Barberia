/**
 * Traductor centralizado de errores técnicos (Firebase Auth, Firestore REST/Admin SDK,
 * Resend, Zod y red) hacia mensajes claros en español para usuarios y administradores.
 */

const AUTH_CODE_TRANSLATIONS: Record<string, string> = {
  'auth/invalid-credential': 'Correo electrónico o contraseña incorrectos.',
  'auth/user-not-found': 'No existe una cuenta registrada con ese correo.',
  'auth/wrong-password': 'Correo electrónico o contraseña incorrectos.',
  'auth/invalid-email': 'El formato del correo electrónico no es válido.',
  'auth/email-already-in-use':
    'Ese correo electrónico ya está registrado en Firebase Authentication.',
  'auth/email-already-exists':
    'Ese correo electrónico ya está registrado en Firebase Authentication.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/missing-password': 'Ingresa tu contraseña para continuar.',
  'auth/too-many-requests':
    'Demasiados intentos seguidos. Espera unos minutos antes de volver a intentar.',
  'auth/operation-not-allowed':
    'El acceso con correo y contraseña no está habilitado en Firebase Authentication.',
  'auth/user-disabled':
    'Esta cuenta ha sido deshabilitada por el administrador.',
  'auth/network-request-failed':
    'Error de red al conectar con el servicio de autenticación. Verifica tu conexión.',
  'auth/requires-recent-login':
    'Por seguridad, cierra sesión e inicia nuevamente para completar este cambio.',
  'auth/id-token-expired':
    'Tu sesión venció. Inicia sesión nuevamente para continuar.',
  'auth/invalid-id-token':
    'Tu sesión ya no es válida. Inicia sesión nuevamente.',
  'auth/argument-error':
    'Los datos de autenticación no son válidos. Inicia sesión nuevamente.',
  'auth/quota-exceeded':
    'Se superó el límite temporal de solicitudes de acceso. Intenta más tarde.',
  EMAIL_EXISTS:
    'Ese correo electrónico ya está registrado en Firebase Authentication.',
  INVALID_EMAIL: 'El formato del correo electrónico no es válido.',
  INVALID_PASSWORD: 'Correo electrónico o contraseña incorrectos.',
  INVALID_LOGIN_CREDENTIALS: 'Correo electrónico o contraseña incorrectos.',
  EMAIL_NOT_FOUND: 'No existe una cuenta registrada con ese correo.',
  WEAK_PASSWORD: 'La contraseña debe tener al menos 6 caracteres.',
  TOO_MANY_ATTEMPTS_TRY_LATER:
    'Demasiados intentos seguidos. Espera unos minutos antes de intentar de nuevo.',
  OPERATION_NOT_ALLOWED:
    'Esta operación no está habilitada en Firebase Authentication.',
  ADMIN_ONLY_OPERATION:
    'Esta acción solo está permitida desde un entorno autorizado.',
  USER_DISABLED: 'Esta cuenta ha sido deshabilitada por el administrador.',
  TOKEN_EXPIRED: 'Tu sesión venció. Inicia sesión nuevamente.',
  INVALID_ID_TOKEN: 'Tu sesión no es válida. Inicia sesión nuevamente.',
};

const LIKELY_ENGLISH_ERROR_RE =
  /^(Error:|TypeError:|SyntaxError:|ReferenceError:|RangeError:|Firebase:|FirebaseError:|Cannot |Could not |Unable to |Invalid |Missing |Failed |Unexpected |Request |The string )/i;

const ENGLISH_SYSTEM_TOKEN_RE =
  /\b(missing or insufficient permissions|permission_denied|already_exists|failed_precondition|resource_exhausted|deadline_exceeded|unauthenticated|failed to fetch|load failed|networkerror|fetch failed|econnrefused|etimedout|enotfound|unexpected token|unexpected end of json|is not valid json|internal server error|quota exceeded|the client is offline|no document to update|document already exists|invalid input|expected string|expected number|invalid enum value|invalid url|invalid email|false for '(?:create|update|get|list|delete)'|api key is invalid|testing emails to your own email)\b/i;

function extractErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const raw = (error as { code?: unknown }).code;
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return '';
}

function extractRawMessage(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg.trim();
  }
  return '';
}

/**
 * Convierte cualquier error (Firebase, red, JSON, Zod o excepción interna) a un mensaje
 * comprensible en español. Mantiene intactos los mensajes de negocio ya escritos en español.
 */
export function translateErrorMessageEs(
  error: unknown,
  fallback: string = 'Ocurrió un error inesperado. Intenta nuevamente.'
): string {
  const code = extractErrorCode(error);
  if (code && AUTH_CODE_TRANSLATIONS[code]) {
    return AUTH_CODE_TRANSLATIONS[code];
  }

  const raw = extractRawMessage(error);
  if (!raw) {
    return fallback;
  }

  // Códigos de Firebase Auth embebidos en el mensaje
  for (const [key, translated] of Object.entries(AUTH_CODE_TRANSLATIONS)) {
    if (raw === key || raw.includes(key)) {
      return translated;
    }
  }

  const lower = raw.toLowerCase();

  // Errores de permisos y reglas de Cloud Firestore
  if (
    lower.includes('missing or insufficient permissions') ||
    lower.includes('permission_denied') ||
    /false for '(?:create|update|get|list|delete)'/.test(lower)
  ) {
    return 'No tienes permisos suficientes para completar esta operación o los datos no cumplen las validaciones de seguridad.';
  }

  if (
    lower.includes('already_exists') ||
    lower.includes('document already exists')
  ) {
    return 'Este registro o franja horaria ya existe.';
  }

  if (
    lower.includes('failed_precondition') ||
    lower.includes('the stored version')
  ) {
    return 'La disponibilidad cambió mientras se procesaba tu solicitud. Actualiza los horarios e intenta nuevamente.';
  }

  if (
    lower.includes('not_found') ||
    lower.includes('no document to update')
  ) {
    return 'El registro solicitado no existe o ya fue eliminado.';
  }

  if (
    lower.includes('resource_exhausted') ||
    lower.includes('quota exceeded')
  ) {
    return 'Se alcanzó el límite temporal de solicitudes en la base de datos. Intenta más tarde.';
  }

  if (
    lower.includes('unauthenticated') ||
    lower.includes('invalid authentication credentials')
  ) {
    return 'Tu sesión expiró o no es válida. Inicia sesión nuevamente.';
  }

  if (
    lower.includes('deadline_exceeded') ||
    lower.includes('unavailable') ||
    lower.includes('the client is offline')
  ) {
    return 'No fue posible establecer comunicación estable con la base de datos. Intenta de nuevo en unos segundos.';
  }

  // Errores de Resend / correo
  if (lower.includes('you can only send testing emails')) {
    return 'En el modo de prueba de Resend solo se pueden enviar correos a tu dirección verificada o desde un dominio propio configurado en RESEND_FROM_EMAIL.';
  }
  if (lower.includes('api key is invalid') || lower.includes('invalid api key')) {
    return 'La clave de envío de correo (RESEND_API_KEY) no es válida.';
  }
  if (lower.includes('rate_limit_exceeded') || lower.includes('too many requests')) {
    return 'Se enviaron demasiadas solicitudes seguidas. Espera un momento antes de volver a intentar.';
  }

  // Errores de red / JSON / navegador
  if (
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound')
  ) {
    return 'No pudimos conectarnos con el servidor. Verifica tu conexión a internet e intenta nuevamente.';
  }

  if (
    lower.includes('unexpected token') ||
    lower.includes('unexpected end of json') ||
    lower.includes('is not valid json') ||
    lower.includes('invalid json')
  ) {
    return 'La respuesta del servidor no pudo leerse correctamente. Intenta nuevamente.';
  }

  if (lower.includes('the string did not match the expected pattern')) {
    return 'El formato de uno de los datos ingresados no es válido.';
  }

  if (lower === 'internal server error') {
    return 'Ocurrió un error interno en el servidor. Intenta nuevamente.';
  }

  // Mensajes por defecto de Zod si alguno quedara en inglés
  if (
    lower === 'required' ||
    lower.startsWith('invalid input') ||
    lower.startsWith('expected ') ||
    lower.startsWith('invalid enum value') ||
    lower.startsWith('too small:') ||
    lower.startsWith('too big:') ||
    lower.startsWith('invalid format')
  ) {
    return 'Verifica que los campos ingresados cumplan el formato requerido.';
  }

  // Guardián anti-inglés: si aún parece una excepción técnica en inglés sin signos de español, usar respaldo
  const hasSpanishSignal = /[áéíóúüñ¡¿]/i.test(raw);
  if (
    !hasSpanishSignal &&
    (LIKELY_ENGLISH_ERROR_RE.test(raw) || ENGLISH_SYSTEM_TOKEN_RE.test(raw))
  ) {
    return fallback;
  }

  return raw;
}

/**
 * Lee de forma segura la respuesta JSON de fetch sin arrojar excepciones SyntaxError
 * en inglés si el servidor devuelve HTML o un cuerpo vacío.
 */
export async function parseJsonResponseSafe<T>(
  response: Response
): Promise<T | null> {
  const rawText = await response.text().catch(() => '');
  if (!rawText) return null;
  try {
    return JSON.parse(rawText) as T;
  } catch {
    return null;
  }
}
