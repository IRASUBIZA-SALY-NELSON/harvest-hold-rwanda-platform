'use client';

import { useCallback, useEffect, useState } from 'react';

import { CSRF_HEADER } from './session';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public details?: Record<string, unknown>
  ) {
    super(code);
  }
}

/** Where a sign-in problem sends the browser. */
function redirectFor(code: string): string | null {
  if (code === 'signedOut') return '/login';
  if (code === 'passwordChangeRequired') return '/login/password';
  return null;
}

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; form?: FormData; redirectOnAuth?: boolean };

/** Calls the API through the portal's own server (/api/admin/...). */
export async function api<T = any>(path: string, { method = 'GET', body, form, redirectOnAuth = true }: Options = {}): Promise<T> {
  const res = await fetch(`/api/admin/${path.replace(/^\//, '')}`, {
    method,
    headers: {
      Accept: 'application/json',
      [CSRF_HEADER]: '1',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = typeof json?.error === 'string' ? json.error : 'unknown';
    const to = redirectFor(code);
    if (to && redirectOnAuth && typeof window !== 'undefined' && !window.location.pathname.startsWith(to)) window.location.href = to;
    throw new ApiError(code, res.status, json?.details);
  }
  return json as T;
}

export interface Query<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (fn: (d: T | undefined) => T | undefined) => void;
}

interface State<T> {
  /** The path these results belong to (results of an older path are never shown). */
  path: string | null;
  data?: T;
  error: ApiError | null;
}

const asApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError('unknown', 0));

/**
 * Loads `path` and keeps it fresh: on mount, when `path` changes, when the window regains focus,
 * and every `refreshMs` if given. Pass null to wait.
 */
export function useQuery<T = any>(path: string | null, { refreshMs }: { refreshMs?: number } = {}): Query<T> {
  const [state, setState] = useState<State<T>>({ path: null, error: null });

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const run = () =>
      api<T>(path).then(
        (data) => !cancelled && setState({ path, data, error: null }),
        (e) => !cancelled && setState((s) => ({ path, data: s.path === path ? s.data : undefined, error: asApiError(e) }))
      );
    void run();
    window.addEventListener('focus', run);
    const timer = refreshMs ? setInterval(run, refreshMs) : undefined;
    return () => {
      cancelled = true;
      window.removeEventListener('focus', run);
      if (timer) clearInterval(timer);
    };
  }, [path, refreshMs]);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api<T>(path);
      setState({ path, data, error: null });
    } catch (e) {
      setState((s) => ({ ...s, path, error: asApiError(e) }));
    }
  }, [path]);

  const setData = useCallback((fn: (d: T | undefined) => T | undefined) => setState((s) => ({ ...s, data: fn(s.data) })), []);
  const current = state.path === path;
  return { data: current ? state.data : undefined, error: current ? state.error : null, loading: !!path && !current, reload, setData };
}
