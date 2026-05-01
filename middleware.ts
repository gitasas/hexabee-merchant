import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.MERCHANT_JWT_SECRET ?? 'hexabee-merchant-secret-change-in-prod'
);

const PUBLIC_MERCHANT_PATHS = ['/merchant/login', '/merchant/register'];

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
