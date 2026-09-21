import type { ApiError } from '@adisys/shared';

const BASE = '/api';
const ACCESS_KEY = 'adisys.field.accessToken';

// A phone is a personal device and field staff lose connectivity often, so
// the session persists across app restarts rather than dying with the tab.
let accessToken: string | null = localStorage.getItem(ACCESS_KEY);
let refreshToken: string | null = localStorage.getItem(`${ACCESS_KEY}.refresh`);
let refreshPromise: Promise<string | null> | null = null;
const listeners = new Set<(token: string | null) => void>();

export const getToken = () => accessToken;
export const onTokenChange = (fn: (t: string | null) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export function setRefreshToken(token: string | null) {
  refreshToken = token;
  if (token) localStorage.setItem(`${ACCESS_KEY}.refresh`, token);
  else localStorage.removeItem(`${ACCESS_KEY}.refresh`);
}

export function setToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem(ACCESS_KEY, token);
  else { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(`${ACCESS_KEY}.refresh`); }
  listeners.forEach((fn) => fn(token));
}

/** A failed request carries the server's code and per-field messages. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
    readonly requestId?: string,
  ) { super(message); this.name = 'ApiRequestError'; }

  /** The first message for a given form field, for inline validation. */
  fieldError(field: string): string | undefined { return this.details?.[field]?.[0]; }
}

async function refreshAccessToken(): Promise<string | null> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Native wrappers have no cookie jar, so the refresh token is sent
        // explicitly from secure storage.
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      setToken(data.accessToken);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      return data.accessToken as string;
    } catch { return null; }
    finally { refreshPromise = null; }
  })();
  return refreshPromise;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Set for multipart uploads — the body is passed through untouched. */
  form?: FormData;
  raw?: boolean;
}

export async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, form, raw, headers, ...rest } = options;

  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const send = async (token: string | null): Promise<Response> =>
    fetch(url.toString(), {
      ...rest,
      credentials: 'include',
      headers: {
        ...(form ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

  let res = await send(accessToken);

  // One transparent refresh-and-retry on expiry.
  if (res.status === 401 && accessToken) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
    else setToken(null);
  }

  if (raw) {
    if (!res.ok) throw new ApiRequestError(res.status, 'REQUEST_FAILED', 'The request failed.');
    return res as unknown as T;
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (payload as ApiError | null)?.error;
    throw new ApiRequestError(
      res.status,
      err?.code ?? 'REQUEST_FAILED',
      err?.message ?? friendlyStatus(res.status),
      err?.details,
      err?.requestId,
    );
  }
  return payload as T;
}

const friendlyStatus = (status: number): string => {
  if (!navigator.onLine) return 'You are offline. This will be sent once you have a signal again.';
  if (status === 0 || status >= 502) return 'Cannot reach the ADISYS server. Check your connection and try again.';
  if (status === 403) return 'You do not have access to this.';
  if (status === 404) return 'That record no longer exists.';
  if (status === 429) return 'Too many requests. Please wait a moment.';
  return 'Something went wrong. Please try again.';
};

export const api = {
  get:   <T = any>(path: string, query?: RequestOptions['query']) => request<T>(path, { method: 'GET', query }),
  post:  <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put:   <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del:   <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload:<T = any>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
};

/** Streams a CSV export straight to the browser's downloads. */
export async function downloadCsv(path: string, query: Record<string, any>, filename: string) {
  const res = await request<Response>(path, { method: 'GET', query: { ...query, format: 'csv' }, raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Authorised receipt/attachment URL — files are never public. */
export async function fileObjectUrl(fileId: string): Promise<string> {
  const res = await request<Response>(`/files/${fileId}`, { method: 'GET', raw: true });
  return URL.createObjectURL(await res.blob());
}
