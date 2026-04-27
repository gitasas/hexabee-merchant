import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { createSession, sessionCookieOptions } from '@/lib/merchant-auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password, businessName } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const existing = await queryOne('SELECT id FROM merchants WHERE email = $1', [email.toLowerCase()]);
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomUUID();

    const rows = await query<{ id: string; email: string }>(
      `INSERT INTO merchants (id, email, password_hash, business_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email`,
      [id, email.toLowerCase(), passwordHash, businessName ?? null]
    );

    const merchant = rows[0];
    const token = await createSession({ id: merchant.id, email: merchant.email });

    const res = NextResponse.json({ success: true });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('REGISTER_ERROR', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
