import { type NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/session';

/** Without a session cookie, every page goes to sign-in. (The API still checks the session itself.) */
export function proxy(req: NextRequest) {
  const signedIn = req.cookies.has(SESSION_COOKIE);
  const onLogin = req.nextUrl.pathname.startsWith('/login');
  if (!signedIn && !onLogin) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico).*)'],
};
