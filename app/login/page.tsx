import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { getDefaultPanelPath } from '@/lib/auth/guards';
import { getServerSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{
    next?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, params] = await Promise.all([
    getServerSession(),
    searchParams,
  ]);

  if (session) {
    redirect(getDefaultPanelPath(session.role));
  }

  return <LoginForm nextPath={params.next} />;
}
