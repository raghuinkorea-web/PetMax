import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser, PermissionKey } from '@adisys/shared';
import { api, setToken, setRefreshToken, getToken, ApiRequestError } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (...anyOf: PermissionKey[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/** A readable label for the device, recorded against the session and every acknowledgement. */
const deviceLabel = (): string => {
  const ua = navigator.userAgent;
  const android = /Android\s([\d.]+)/.exec(ua);
  const model = /;\s([^;)]+)\sBuild\//.exec(ua)?.[1];
  if (android) return `Android ${android[1]}${model ? ` · ${model}` : ''}`;
  return `${/iPhone|iPad/.test(ua) ? 'iOS' : 'Mobile web'} · ADISYS FieldOps`;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: AuthUser }>('/auth/me');
      setUser(user);
    } catch (err) {
      // Offline at launch: keep the cached identity rather than throwing the
      // employee out to the login screen on a weak signal.
      if (err instanceof ApiRequestError && err.status === 0 && getToken()) {
        const cached = localStorage.getItem('adisys.field.user');
        if (cached) { setUser(JSON.parse(cached)); return; }
      }
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (getToken()) void load();
    else {
      void api.post('/auth/refresh')
        .then((d: any) => { setToken(d.accessToken); setRefreshToken(d.refreshToken ?? null); setUser(d.user); })
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    }
  }, [load]);

  useEffect(() => {
    if (user) localStorage.setItem('adisys.field.user', JSON.stringify(user));
  }, [user]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const data = await api.post<{ accessToken: string; refreshToken: string; user: AuthUser }>(
      '/auth/login', { identifier, password, client: 'android', deviceLabel: deviceLabel() });
    setToken(data.accessToken);
    setRefreshToken(data.refreshToken ?? null);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* signing out locally is enough */ }
    setToken(null);
    setUser(null);
    localStorage.removeItem('adisys.field.user');
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

export { ApiRequestError, deviceLabel };
