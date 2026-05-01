import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${req.nextUrl.protocol}//${req.headers.get('host')}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/merchant/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
}
