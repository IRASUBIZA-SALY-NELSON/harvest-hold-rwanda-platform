/** HTTP client for the Harvest Hold API. */

/** Errors carry a code that the UI translates with `errors.<code>`. */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 0
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

let token: string | null = null;
let onSignedOut: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
}

/** Called when the server says the session is no longer valid. */
export function onSessionExpired(fn: () => void) {
  onSignedOut = fn;
}

// Screens reload when something changes (after any successful write).
const listeners = new Set<() => void>();
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const changed = () => listeners.forEach((l) => l());

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  return send<T>(method, path, body === undefined ? undefined : JSON.stringify(body), body !== undefined ? 'application/json' : undefined, 15_000);
}

/** Multipart upload (photos). Slow mobile networks get a longer timeout. */
export function upload<T>(path: string, form: FormData): Promise<T> {
  // No Content-Type: fetch sets the multipart boundary itself.
  return send<T>('POST', path, form, undefined, 90_000);
}

async function send<T>(method: Method, path: string, body: BodyInit | undefined, contentType: string | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(contentType && { 'Content-Type': contentType }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('network');
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = typeof json?.error === 'string' ? json.error : res.status === 413 ? 'imageTooLarge' : 'unknown';
    if (code === 'signedOut' && token) onSignedOut?.();
    throw new ApiError(code, res.status);
  }
  if (method !== 'GET') changed();
  return json as T;
}
