import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser, PermissionKey } from '@adisys/shared';
import { api, setToken, getToken, ApiRequestError } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (...anyOf: PermissionKey[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: AuthUser }>('/auth/me');
      setUser(user);
    } catch {
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A stored token, or an httpOnly refresh cookie from a previous visit.
    if (getToken()) void load();
    else {
      void api.post('/auth/refresh')
        .then((d: any) => { setToken(d.accessToken); setUser(d.user); })
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    }
  }, [load]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const data = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login',
      { identifier, password, client: 'web' });
    setToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* signing out locally is enough */ }
    setToken(null);
    setUser(null);
  }, []);

  const can = useCallback(
    (...anyOf: PermissionKey[]) => anyOf.some((k) => user?.permissions.includes(k)),
    [user]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, signOut, refreshUser: load, can }),
    [user, loading, signIn, signOut, load, can]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export { ApiRequestError };
