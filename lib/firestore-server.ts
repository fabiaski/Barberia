import 'server-only';
import { cookies } from 'next/headers';
import { Timestamp } from 'firebase-admin/firestore';
import firebaseAppletConfig from '@/firebase-applet-config.json';
import {
  getAdminDb,
  hasAdminServiceAccount,
} from '@/lib/firebase-admin';
import { translateErrorMessageEs } from '@/lib/utils/error-es';

export const ID_TOKEN_COOKIE_NAME = 'barberia_id_token';

export interface ServerDocSnapshot {
  id: string;
  exists: boolean;
  data: Record<string, unknown> | undefined;
}

export interface ServerQueryFilter {
  field: string;
  op: '==' | '<' | '<=' | '>' | '>=';
  value: unknown;
}

export interface ServerQueryOptions {
  filters?: ServerQueryFilter[];
  limit?: number;
}

export type ServerBatchOperation =
  | {
      type: 'set';
      collection: string;
      docId: string;
      data: Record<string, unknown>;
      merge?: boolean;
      preconditionExists?: boolean;
      serverTimestampFields?: string[];
    }
  | {
      type: 'update';
      collection: string;
      docId: string;
      data: Record<string, unknown>;
      serverTimestampFields?: string[];
    }
  | {
      type: 'delete';
      collection: string;
      docId: string;
    };

function getProjectAndDbConfig() {
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseAppletConfig.projectId;
  const databaseId =
    process.env.FIREBASE_FIRESTORE_DATABASE_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
    firebaseAppletConfig.firestoreDatabaseId ||
    '(default)';
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseAppletConfig.apiKey;

  return { projectId, databaseId, apiKey };
}

function getFirestoreRestBase(): string {
  const { projectId, databaseId } = getProjectAndDbConfig();
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents`;
}

function getFirestoreDatabaseRoot(): string {
  const { projectId, databaseId } = getProjectAndDbConfig();
  return `projects/${projectId}/databases/${databaseId}/documents`;
}

export async function getServerIdToken(): Promise<string | undefined> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(ID_TOKEN_COOKIE_NAME)?.value || undefined;
  } catch {
    return undefined;
  }
}

type FirestoreRestValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreRestValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreRestValue> } };

function toFirestoreRestValue(value: unknown): FirestoreRestValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (value instanceof Timestamp) {
    return { timestampValue: value.toDate().toISOString() };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value
          .filter((item) => item !== undefined)
          .map((item) => toFirestoreRestValue(item)),
      },
    };
  }
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreRestValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreRestValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreRestValue(value: FirestoreRestValue): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values ?? []).map((item) =>
      fromFirestoreRestValue(item)
    );
  }
  if ('mapValue' in value) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value.mapValue.fields ?? {})) {
      out[k] = fromFirestoreRestValue(v);
    }
    return out;
  }
  return null;
}

function toFirestoreFields(
  data: Record<string, unknown>,
  excludeKeys: Set<string> = new Set()
): Record<string, FirestoreRestValue> {
  const fields: Record<string, FirestoreRestValue> = {};
  for (const [key, val] of Object.entries(data)) {
    if (val === undefined || excludeKeys.has(key)) continue;
    fields[key] = toFirestoreRestValue(val);
  }
  return fields;
}

function fromFirestoreDocument(doc: {
  name: string;
  fields?: Record<string, FirestoreRestValue>;
}): ServerDocSnapshot {
  const parts = doc.name.split('/');
  const id = parts[parts.length - 1] ?? '';
  const data: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(doc.fields ?? {})) {
    data[key] = fromFirestoreRestValue(val);
  }
  return { id, exists: true, data };
}

async function resolveAuthHeaders(
  explicitIdToken?: string
): Promise<{ headers: Record<string, string>; querySuffix: string }> {
  const token = explicitIdToken ?? (await getServerIdToken());
  const { apiKey } = getProjectAndDbConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const querySuffix = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
  return { headers, querySuffix };
}

function mapRestOp(op: ServerQueryFilter['op']): string {
  switch (op) {
    case '==':
      return 'EQUAL';
    case '<':
      return 'LESS_THAN';
    case '<=':
      return 'LESS_THAN_OR_EQUAL';
    case '>':
      return 'GREATER_THAN';
    case '>=':
      return 'GREATER_THAN_OR_EQUAL';
  }
}

export class FirestoreRestPermissionError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseRestError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '');
  let rawMessage = text || `Error de Firestore (${response.status})`;
  let rawCode: string | undefined;
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; status?: string };
    };
    if (parsed.error?.status) {
      rawCode = parsed.error.status;
    }
    if (parsed.error?.message) {
      rawMessage = parsed.error.message;
    }
  } catch {
    // conservar texto sin formato
  }
  const localized = translateErrorMessageEs(
    { code: rawCode, message: rawMessage },
    'No fue posible completar la operación en la base de datos.'
  );
  return new FirestoreRestPermissionError(response.status, localized, rawCode);
}

function buildRestWriteOperation(op: ServerBatchOperation): Record<string, unknown> {
  const dbRoot = getFirestoreDatabaseRoot();
  const name = `${dbRoot}/${op.collection}/${op.docId}`;

  if (op.type === 'delete') {
    return { delete: name };
  }

  const serverTimestampFields = op.serverTimestampFields ?? [];
  const serverFieldSet = new Set(serverTimestampFields);
  const fields = toFirestoreFields(op.data, serverFieldSet);
  const fieldPaths = Object.keys(fields);

  const writeObj: Record<string, unknown> = {
    update: {
      name,
      fields,
    },
  };

  if (op.type === 'update' || op.merge) {
    writeObj.updateMask = { fieldPaths };
  }

  if (op.type === 'update') {
    writeObj.currentDocument = { exists: true };
  } else if (typeof op.preconditionExists === 'boolean') {
    writeObj.currentDocument = { exists: op.preconditionExists };
  }

  if (serverTimestampFields.length > 0) {
    writeObj.updateTransforms = serverTimestampFields.map((fieldPath) => ({
      fieldPath,
      setToServerValue: 'REQUEST_TIME',
    }));
  }

  return writeObj;
}

function normalizeAdminData(
  data: Record<string, unknown>,
  serverTimestampFields: string[] = []
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const now = Timestamp.now();
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  for (const field of serverTimestampFields) {
    out[field] = now;
  }
  return out;
}

export async function serverGetDoc(
  collectionName: string,
  docId: string,
  idToken?: string
): Promise<ServerDocSnapshot> {
  if (hasAdminServiceAccount()) {
    const snap = await getAdminDb().collection(collectionName).doc(docId).get();
    return {
      id: snap.id,
      exists: snap.exists,
      data: snap.data() as Record<string, unknown> | undefined,
    };
  }

  const baseUrl = getFirestoreRestBase();
  const { headers, querySuffix } = await resolveAuthHeaders(idToken);
  const response = await fetch(
    `${baseUrl}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}${querySuffix}`,
    {
      method: 'GET',
      headers,
      cache: 'no-store',
    }
  );

  if (response.status === 404) {
    return { id: docId, exists: false, data: undefined };
  }

  if (!response.ok) {
    throw await parseRestError(response);
  }

  const json = (await response.json()) as {
    name: string;
    fields?: Record<string, FirestoreRestValue>;
  };
  return fromFirestoreDocument(json);
}

export async function serverQueryCollection(
  collectionName: string,
  options: ServerQueryOptions = {},
  idToken?: string
): Promise<ServerDocSnapshot[]> {
  if (hasAdminServiceAccount()) {
    let ref: FirebaseFirestore.Query = getAdminDb().collection(collectionName);
    for (const filter of options.filters ?? []) {
      ref = ref.where(filter.field, filter.op, filter.value);
    }
    if (options.limit && options.limit > 0) {
      ref = ref.limit(options.limit);
    }
    const snap = await ref.get();
    return snap.docs.map((doc) => ({
      id: doc.id,
      exists: true,
      data: doc.data() as Record<string, unknown>,
    }));
  }

  const baseUrl = getFirestoreRestBase();
  const { headers, querySuffix } = await resolveAuthHeaders(idToken);

  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: collectionName }],
  };

  const filters = options.filters ?? [];
  if (filters.length === 1) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: filters[0].field },
        op: mapRestOp(filters[0].op),
        value: toFirestoreRestValue(filters[0].value),
      },
    };
  } else if (filters.length > 1) {
    structuredQuery.where = {
      compositeFilter: {
        op: 'AND',
        filters: filters.map((f) => ({
          fieldFilter: {
            field: { fieldPath: f.field },
            op: mapRestOp(f.op),
            value: toFirestoreRestValue(f.value),
          },
        })),
      },
    };
  }

  if (options.limit && options.limit > 0) {
    structuredQuery.limit = options.limit;
  }

  const response = await fetch(`${baseUrl}:runQuery${querySuffix}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw await parseRestError(response);
  }

  const rows = (await response.json()) as Array<{
    document?: {
      name: string;
      fields?: Record<string, FirestoreRestValue>;
    };
  }>;

  return rows
    .filter((row) => Boolean(row.document))
    .map((row) => fromFirestoreDocument(row.document!));
}

export async function serverCommitWrites(
  operations: ServerBatchOperation[],
  idToken?: string
): Promise<void> {
  if (operations.length === 0) return;

  if (hasAdminServiceAccount()) {
    const db = getAdminDb();
    const batch = db.batch();

    for (const op of operations) {
      const ref = db.collection(op.collection).doc(op.docId);
      if (op.type === 'delete') {
        batch.delete(ref);
      } else if (op.type === 'update') {
        batch.update(
          ref,
          normalizeAdminData(op.data, op.serverTimestampFields)
        );
      } else if (op.preconditionExists === false) {
        batch.create(
          ref,
          normalizeAdminData(op.data, op.serverTimestampFields)
        );
      } else {
        batch.set(
          ref,
          normalizeAdminData(op.data, op.serverTimestampFields),
          { merge: Boolean(op.merge) }
        );
      }
    }

    await batch.commit();
    return;
  }

  const baseUrl = getFirestoreRestBase();
  const { headers, querySuffix } = await resolveAuthHeaders(idToken);
  const writes = operations.map(buildRestWriteOperation);

  const response = await fetch(`${baseUrl}:commit${querySuffix}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ writes }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw await parseRestError(response);
  }
}

export async function serverSetDoc(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options: { merge?: boolean; serverTimestampFields?: string[] } = {},
  idToken?: string
): Promise<void> {
  await serverCommitWrites(
    [
      {
        type: 'set',
        collection: collectionName,
        docId,
        data,
        merge: options.merge,
        serverTimestampFields: options.serverTimestampFields,
      },
    ],
    idToken
  );
}

export async function serverUpdateDoc(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options: { serverTimestampFields?: string[] } = {},
  idToken?: string
): Promise<void> {
  await serverCommitWrites(
    [
      {
        type: 'update',
        collection: collectionName,
        docId,
        data,
        serverTimestampFields: options.serverTimestampFields,
      },
    ],
    idToken
  );
}

export async function serverDeleteDoc(
  collectionName: string,
  docId: string,
  idToken?: string
): Promise<void> {
  await serverCommitWrites(
    [{ type: 'delete', collection: collectionName, docId }],
    idToken
  );
}

export function generateFirestoreAutoId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}
