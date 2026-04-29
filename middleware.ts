import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const pathname = req.nextUrl.pathname;

  // On merchant.hexabee.buzz root → redirect to /merchant/login
  if (host.includes('merchant.hexabee.buzz') && pathname === '/') {
    return NextResponse.redirect(new URL('/merchant/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/merchant/:path*'],
};
