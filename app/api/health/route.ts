import { NextResponse } from 'next/server';
import {
  getFirebaseProjectConfig,
  hasAdminServiceAccount,
} from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { projectId, databaseId } = getFirebaseProjectConfig();
  return NextResponse.json({
    ok: true,
    runtime: process.env.VERCEL ? 'vercel' : 'node',
    nodeVersion: process.version,
    projectId,
    databaseId,
    hasAdminServiceAccount: hasAdminServiceAccount(),
    timestamp: new Date().toISOString(),
  });
}
