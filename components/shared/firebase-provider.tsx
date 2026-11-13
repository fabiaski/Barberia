'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth, testFirestoreConnection } from '@/lib/firebase-client';
import type { UserRole } from '@/types';

export interface ClientSessionUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  barberId?: string;
  active: boolean;
  emailVerified: boolean;
}

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  firestoreOnline: boolean;
  sessionUser: ClientSessionUser | null;
  sessionLoading: boolean;
  refreshSession: () => Promise<ClientSessionUser | null>;
  signOutUser: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue>({
  user: null,
  authReady: false,
  firestoreOnline: true,
  sessionUser: null,
  sessionLoading: true,
  refreshSession: async () => null,
  signOutUser: async () => {},
});

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreOnline, setFirestoreOnline] = useState(true);
  const [sessionUser, setSessionUser] = useState<ClientSessionUser | null>(
    null
  );
  const [sessionLoading, setSessionLoading] = useState(true);

  const refreshSession = useCallback(async (): Promise<ClientSessionUser | null> => {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        setSessionUser(null);
        return null;
      }
      const data = (await response.json()) as {
        authenticated?: boolean;
        user?: ClientSessionUser | null;
      };
      const resolved = data.authenticated && data.user ? data.user : null;
      setSessionUser(resolved);
      return resolved;
    } catch {
      setSessionUser(null);
      return null;
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await Promise.allSettled([
      signOut(auth),
      fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'include',
      }),
    ]);
    setSessionUser(null);
  }, []);

  useEffect(() => {
    let active = true;

    testFirestoreConnection().then((online) => {
      if (active) setFirestoreOnline(online);
    });

    fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as {
          authenticated?: boolean;
          user?: ClientSessionUser | null;
        };
        return data.authenticated && data.user ? data.user : null;
      })
      .then((resolved) => {
        if (!active) return;
        setSessionUser(resolved);
        setSessionLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSessionUser(null);
        setSessionLoading(false);
      });

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!active) return;
      setUser(firebaseUser);
      setAuthReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshSession]);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        firestoreOnline,
        sessionUser,
        sessionLoading,
        refreshSession,
        signOutUser,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  return useContext(FirebaseContext);
}
