import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { callInternal } from '@/lib/payer-auth';
import { createSession, sessionCookieOptions } from '@/lib/merchant-auth';

/**
 * Set a new password from a reset link.
 *
 * The backend decides whether the link is real, unspent and unexpired, and says
 * whose it is. This route does the one thing that belongs here: hashing, with
 * the same bcrypt and the same cost as registration and login, so there is
 * exactly one place that knows how a HexaBee password is stored.
 *
 * The link is spent **before** the password is written. If that order were
 * reversed, a failure in between would leave a working link behind; this way
 * the worst case is a merchant who has to ask for a second one.
 *
 * A merchant who signed up with Google has no password at all. Setting one is
 * allowed and useful - it gives them a second way in - and costs nothing in
 * safety, because anyone who can read that mailbox could already sign in with
 * Google.
 */
export async function POST(req: NextRequest) {
  let token = '';
  let password = '';
  try {
    const body = await req.json();
    token = String(body?.token ?? '').trim();
    password = String(body?.password ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (!token) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  // The same rule registration applies. Checked before the link is spent, so a
  // password that was never going to be accepted does not cost the merchant
  // their link.
  if (password.length < 8) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
  }

  const { status, body } = await callInternal('/api/plugin/merchant/password-reset/consume', { token });
  if (status !== 200) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }
  const { merchant_id: merchantId, email } = (body ?? {}) as { merchant_id?: string; email?: string };
  if (!merchantId || !email) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await query('UPDATE merchants SET password_hash = $1 WHERE id = $2', [passwordHash, merchantId]);
  } catch (err) {
    console.error('RESET_PASSWORD_ERROR', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'reset_failed' }, { status: 500 });
  }

  // Signed in straight away. Someone who has just proved they control the
  // mailbox and chosen a password should not then be asked to type it.
  const sessionToken = await createSession({ id: merchantId, email });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieOptions(sessionToken));
  return res;
}
