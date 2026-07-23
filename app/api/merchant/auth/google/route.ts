import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';

const STATE_COOKIE = 'google_oauth_state';

function resolveAppUrl(req: NextRequest): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  // Only trust the request host outside production
  if (process.env.NODE_ENV !== 'production') {
    return `${req.nextUrl.protocol}//${req.headers.get('host')}`;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  const appUrl = resolveAppUrl(req);
  if (!appUrl) {
    console.error('NEXT_PUBLIC_APP_URL must be set in production for Google OAuth');
    return NextResponse.json({ error: 'OAuth not configured' }, { status: 500 });
  }

  // CSRF protection: random state, echoed back by Google and verified in the callback
  const state = randomBytes(32).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/merchant/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    state,
  });

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
  res.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  });
  return res;
}
