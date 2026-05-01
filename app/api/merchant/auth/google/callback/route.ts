import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { createSession, sessionCookieOptions } from '@/lib/merchant-auth';

export const runtime = 'nodejs';

type GoogleTokenResponse = { access_token?: string; error?: string };
type GoogleUserInfo = { email?: string; name?: string };

export async function GET(req: NextRequest) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${req.nextUrl.protocol}//${req.headers.get('host')}`;

  const loginUrl = `${appUrl}/merchant/login`;
  const code = req.nextUrl.searchParams.get('code');

  if (!code || req.nextUrl.searchParams.get('error')) {
    return NextResponse.redirect(`${loginUrl}?error=oauth_cancelled`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${loginUrl}?error=oauth_not_configured`);
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${appUrl}/api/merchant/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = (await tokenRes.json()) as GoogleTokenResponse;

    if (!tokenRes.ok || !tokens.access_token) {
      console.error('GOOGLE_TOKEN_ERROR', tokens);
      return NextResponse.redirect(`${loginUrl}?error=oauth_failed`);
    }

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const userInfo = (await userRes.json()) as GoogleUserInfo;

    if (!userInfo.email) {
      return NextResponse.redirect(`${loginUrl}?error=no_email`);
    }

    const email = userInfo.email.toLowerCase();

    // Find or create merchant
    let merchant = await queryOne<{ id: string; email: string }>(
      'SELECT id, email FROM merchants WHERE email = $1',
      [email]
    );

    if (!merchant) {
      const rows = await query<{ id: string; email: string }>(
        `INSERT INTO merchants (id, email, password_hash, business_name, is_active, created_at)
         VALUES ($1, $2, NULL, $3, true, NOW())
         RETURNING id, email`,
        [randomUUID(), email, userInfo.name ?? null]
      );
      merchant = rows[0] ?? null;
    }

    if (!merchant) {
      return NextResponse.redirect(`${loginUrl}?error=db_error`);
    }

    const token = await createSession({ id: merchant.id, email: merchant.email });
    const res = NextResponse.redirect(`${appUrl}/merchant/dashboard`);
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (err) {
    console.error('GOOGLE_OAUTH_ERROR', err);
    return NextResponse.redirect(`${loginUrl}?error=server_error`);
  }
}
