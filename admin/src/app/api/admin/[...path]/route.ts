import { cookies, headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import { CSRF_HEADER, SESSION_COOKIE } from '@/lib/session';

const API = (process.env.ADMIN_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

/**
 * The portal's only door to the API. The browser talks to this route (same origin); this server
 * adds the session token from the httpOnly cookie and calls /admin/* on the API. Responses are
 * streamed through unchanged, so live events, files and CSV exports work too.
 */
async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = `${API}/admin/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const isLogin = path.join('/') === 'auth/login';
  const isLogout = path.join('/') === 'auth/logout';

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.get(CSRF_HEADER) !== '1') {
    return NextResponse.json({ error: 'csrf' }, { status: 403 });
  }

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const h = await headers();
  const outHeaders: Record<string, string> = {
    'x-admin-client-ip': (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim(),
    'user-agent': h.get('user-agent') ?? '',
  };
  if (token) outHeaders.authorization = `Bearer ${token}`;
  const contentType = req.headers.get('content-type');
  if (contentType) outHeaders['content-type'] = contentType;
  if (req.headers.get('accept')) outHeaders.accept = req.headers.get('accept')!;

  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers: outHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      // @ts-expect-error: Node fetch needs this to stream a request body
      duplex: 'half',
      cache: 'no-store',
      signal: req.signal,
    });
  } catch {
    return NextResponse.json({ error: 'apiUnreachable' }, { status: 502 });
  }

  // Login: keep the token in an httpOnly cookie, never hand it to page scripts.
  if (isLogin && res.ok) {
    const body = await res.json();
    const out = NextResponse.json({ next: body.next });
    out.cookies.set(SESSION_COOKIE, body.token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 3600 });
    return out;
  }

  const passHeaders = new Headers();
  for (const k of ['content-type', 'content-disposition', 'cache-control', 'content-length']) {
    const v = res.headers.get(k);
    if (v) passHeaders.set(k, v);
  }
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    passHeaders.set('cache-control', 'no-cache, no-transform');
    passHeaders.set('x-accel-buffering', 'no');
  }
  if (res.status === 401 || isLogout) {
    // Signed out or session gone: drop the cookie. (Wrong code or password during sign-in also
    // answer 401, with another error: keep the cookie then.)
    const text = await res.text();
    const error = (() => {
      try {
        return JSON.parse(text).error;
      } catch {
        return undefined;
      }
    })();
    const out = new NextResponse(text, { status: res.status, headers: passHeaders });
    if (isLogout || error === 'signedOut') out.cookies.delete(SESSION_COOKIE);
    return out;
  }
  const out = new NextResponse(res.body, { status: res.status, headers: passHeaders });
  return out;
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
