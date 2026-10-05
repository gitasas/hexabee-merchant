import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '@/lib/db';
import { createSession, sessionCookieOptions } from '@/lib/merchant-auth';

type UserRow = {
  user_id: string;
  merchant_id: string;
  email: string;
  password_hash: string | null;
  role: string;
};

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    // merchant_users owns authentication since 2026-10-05; `merchants.email`
    // and `password_hash` are history and are not read here.
    let user = await queryOne<UserRow>(
      `SELECT u.id AS user_id, u.merchant_id, u.email, u.password_hash, u.role
         FROM merchant_users u
         JOIN merchants m ON m.id = u.merchant_id
        WHERE u.email = $1 AND m.is_active = true`,
      [email.toLowerCase()]
    );

    // Safety net, not a second source of truth. The owner rows are copied into
    // merchant_users at boot; if that backfill ever failed, without this nobody
    // could sign in at all - a total outage for a tidier story. Loud on
    // purpose, because a login arriving here means the backfill needs looking
    // at.
    if (!user) {
      const legacy = await queryOne<{ id: string; email: string; password_hash: string | null }>(
        'SELECT id, email, password_hash FROM merchants WHERE email = $1 AND is_active = true',
        [email.toLowerCase()]
      );
      if (legacy) {
        console.error('LOGIN_FELL_BACK_TO_MERCHANTS', legacy.id);
        user = {
          user_id: legacy.id,
          merchant_id: legacy.id,
          email: legacy.email,
          password_hash: legacy.password_hash,
          role: 'owner',
        };
      }
    }

    // A merchant who signed up with Google has no password hash at all, and
    // bcrypt.compare throws "Illegal arguments" on a null one - so this used to
    // answer a 500 "Login failed" where it meant "wrong password". Same 401 as
    // any other failed attempt: which of the two it was is not the browser's
    // business either way. Since 2026-10-05 such an account can give itself a
    // password through the reset link, so this path is reachable in normal use.
    if (!user || !user.password_hash) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Best effort: a failed timestamp is not a reason to refuse a good login.
    query('UPDATE merchant_users SET last_login_at = NOW() WHERE id = $1', [user.user_id])
      .catch(err => console.warn('[login] last_login_at update failed', String(err)));

    const token = await createSession({
      id: user.merchant_id,
      email: user.email,
      userId: user.user_id,
      role: user.role === 'staff' ? 'staff' : 'owner',
    });

    const res = NextResponse.json({ success: true });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (err) {
    console.error('LOGIN_ERROR', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
