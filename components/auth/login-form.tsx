'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  MailCheck,
  Scissors,
} from 'lucide-react';
import { auth } from '@/lib/firebase-client';
import {
  emailPasswordLoginSchema,
  type EmailPasswordLoginInput,
} from '@/lib/validators/auth';
import { useFirebase } from '@/components/shared/firebase-provider';
import { UserRole } from '@/types';

interface LoginFormProps {
  nextPath?: string;
}

class EmailVerificationPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailVerificationPendingError';
  }
}

function mapFirebaseAuthError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code?: unknown }).code);
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Correo o contraseña incorrectos.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentar.';
      case 'auth/operation-not-allowed':
        return 'El acceso con correo y contraseña aún no está habilitado en Firebase Authentication.';
      case 'auth/user-disabled':
        return 'Esta cuenta ha sido deshabilitada por el administrador.';
      default:
        return 'No fue posible iniciar sesión. Verifica tus credenciales e intenta de nuevo.';
    }
  }
  return error instanceof Error
    ? error.message
    : 'Error inesperado al iniciar sesión.';
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const { refreshSession } = useFirebase();
  const [authError, setAuthError] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [unverifiedUser, setUnverifiedUser] = useState<User | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string>('');
  const [sendingVerification, setSendingVerification] = useState(false);
  const [recheckingVerification, setRecheckingVerification] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailPasswordLoginInput>({
    resolver: zodResolver(emailPasswordLoginSchema),
    mode: 'onBlur',
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const exchangeTokenAndRedirect = async (
    idToken: string,
    firebaseUser: User
  ) => {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ idToken }),
    });

    const payload = (await response.json()) as {
      authenticated?: boolean;
      user?: { role: UserRole };
      error?: string;
      code?: string;
    };

    if (response.status === 403 && payload.code === 'EMAIL_NOT_VERIFIED') {
      setUnverifiedUser(firebaseUser);
      throw new EmailVerificationPendingError(
        payload.error ||
          'Tu correo electrónico aún no está verificado en Firebase.'
      );
    }

    if (!response.ok || !payload.authenticated || !payload.user) {
      await signOut(auth);
      throw new Error(
        payload.error ||
          'Tu cuenta no está autorizada para acceder al sistema interno.'
      );
    }

    setUnverifiedUser(null);
    await refreshSession();

    const defaultDestination =
      payload.user.role === UserRole.ADMIN ? '/admin' : '/barbero';
    const isSafeNext =
      nextPath &&
      ((payload.user.role === UserRole.ADMIN &&
        (nextPath.startsWith('/admin') || nextPath.startsWith('/barbero'))) ||
        (payload.user.role === UserRole.BARBER &&
          nextPath.startsWith('/barbero')));

    router.replace(isSafeNext ? nextPath : defaultDestination);
    router.refresh();
  };

  const onEmailSubmit = async (data: EmailPasswordLoginInput) => {
    setAuthError('');
    setVerificationNotice('');
    setUnverifiedUser(null);
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        data.email,
        data.password
      );
      const idToken = await credential.user.getIdToken(true);
      await exchangeTokenAndRedirect(idToken, credential.user);
    } catch (error) {
      if (error instanceof EmailVerificationPendingError) {
        setAuthError(error.message);
      } else {
        setAuthError(mapFirebaseAuthError(error));
      }
    }
  };

  const handleSendVerification = async () => {
    if (!unverifiedUser) return;
    setSendingVerification(true);
    setAuthError('');
    setVerificationNotice('');
    try {
      await sendEmailVerification(unverifiedUser);
      setVerificationNotice(
        `Enviamos un enlace de verificación a ${unverifiedUser.email}. Ábrelo desde tu bandeja (revisa Spam si no aparece) y luego presiona «Ya verifiqué mi correo».`
      );
    } catch (error) {
      setAuthError(mapFirebaseAuthError(error));
    } finally {
      setSendingVerification(false);
    }
  };

  const handleRecheckVerification = async () => {
    if (!unverifiedUser) return;
    setRecheckingVerification(true);
    setAuthError('');
    try {
      await unverifiedUser.reload();
      if (!unverifiedUser.emailVerified) {
        setAuthError(
          'Tu correo todavía figura sin verificar. Abre el enlace que llegó a tu correo y vuelve a presionar este botón.'
        );
        return;
      }
      const freshToken = await unverifiedUser.getIdToken(true);
      await exchangeTokenAndRedirect(freshToken, unverifiedUser);
    } catch (error) {
      setAuthError(mapFirebaseAuthError(error));
    } finally {
      setRecheckingVerification(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-8 px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 font-[var(--font-playfair)] text-xl font-semibold tracking-tight text-stone-900"
          >
            <Scissors className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <span>Barbería Estudio</span>
          </Link>

          <Link
            href="/"
            className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap shrink-0 text-sm font-medium text-stone-600 transition-colors hover:text-stone-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Volver al sitio público</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl items-center justify-center px-6 py-16 lg:py-24">
        <section className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 sm:p-10">
          <h1 className="font-[var(--font-playfair)] text-2xl font-semibold text-stone-900">
            Iniciar sesión
          </h1>
          <p className="mt-1.5 text-sm text-stone-600">
            Los clientes no necesitan iniciar sesión para reservar en{' '}
            <Link
              href="/reservar"
              className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-900"
            >
              /reservar
            </Link>
            .
          </p>

          {authError && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-800"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                aria-hidden="true"
              />
              <span>{authError}</span>
            </div>
          )}

          {verificationNotice && (
            <div
              role="status"
              className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-relaxed text-emerald-800"
            >
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              <span>{verificationNotice}</span>
            </div>
          )}

          {unverifiedUser && (
            <div className="mt-4 space-y-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-medium text-amber-900">
                Cuenta pendiente de verificación: {unverifiedUser.email}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleSendVerification}
                  disabled={sendingVerification || recheckingVerification}
                  className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-60"
                >
                  {sendingVerification ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MailCheck className="h-3.5 w-3.5" />
                  )}
                  <span>Enviar enlace de verificación</span>
                </button>
                <button
                  type="button"
                  onClick={handleRecheckVerification}
                  disabled={sendingVerification || recheckingVerification}
                  className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-50 disabled:opacity-60"
                >
                  {recheckingVerification && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <span>Ya verifiqué mi correo</span>
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={handleSubmit(onEmailSubmit)}
            noValidate
            className="mt-6 space-y-4"
          >
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-semibold text-stone-700"
              >
                Correo electrónico
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="correo@barberiaestudio.co"
                disabled={isSubmitting}
                {...register('email')}
                className="mt-1.5 min-h-[46px] w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/20 disabled:bg-stone-100"
              />
              {errors.email && (
                <p className="mt-1.5 text-xs text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-stone-700"
              >
                Contraseña
              </label>
              <div className="relative mt-1.5">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  {...register('password')}
                  className="min-h-[46px] w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-4 pr-11 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/20 disabled:bg-stone-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                  }
                  className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1.5 text-xs text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 text-sm font-semibold text-stone-50 transition-colors hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Lock className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Ingresar al panel</span>
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
