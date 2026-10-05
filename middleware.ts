import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

if (!process.env.MERCHANT_JWT_SECRET) {
  throw new Error('MERCHANT_JWT_SECRET must be set');
}
const SECRET = new TextEncoder().encode(process.env.MERCHANT_JWT_SECRET);

// Reachable without a session, because every one of them is a way IN. Leaving
// the password-reset pages out of this list sent them to /merchant/login -
// which is precisely the page the person cannot get past, so the whole feature
// was dead on arrival and nothing but opening the URL would have shown it
// (2026-10-05).
const PUBLIC_MERCHANT_PATHS = [
  '/merchant/login',
  '/merchant/register',
  '/merchant/forgot',
  '/merchant/reset',
];

export async function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const pathname = req.nextUrl.pathname;

  // Forward pathname to server components via header
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', pathname);

  // Root redirect on merchant domain
  if (host.includes('merchant.hexabee.buzz') && pathname === '/') {
    return NextResponse.redirect(new URL('/merchant/login', req.url));
  }

  // Protect /merchant/* page routes (not public paths, not API routes)
  if (
    pathname.startsWith('/merchant/') &&
    !pathname.startsWith('/api/') &&
    !PUBLIC_MERCHANT_PATHS.some(p => pathname.startsWith(p))
  ) {
    const token = req.cookies.get('merchant_session')?.value;

    if (!token) {
      return NextResponse.redirect(new URL('/merchant/login', req.url));
    }

    try {
      await jwtVerify(token, SECRET);
    } catch {
      return NextResponse.redirect(new URL('/merchant/login', req.url));
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/', '/merchant/:path*'],
};
