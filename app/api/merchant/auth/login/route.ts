import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/db';
import { createSession, sessionCookieOptions } from '@/lib/merchant-auth';

type MerchantRow = { id: string; email: string; password_hash: string };

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const merchant = await queryOne<MerchantRow>(
      'SELECT id, email, password_hash FROM merchants WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    if (!merchant) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, merchant.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = await createSession({ id: merchant.id, email: merchant.email });

    const res = NextResponse.json({ success: true });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (err) {
    console.error('LOGIN_ERROR', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
